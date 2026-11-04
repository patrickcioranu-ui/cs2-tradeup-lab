"""Steam Market helpers, price merging and ECB conversion.

Production prices are CSFloat listings (see csfloat_prices.py). The direct
Steam search crawl (``fetch_all``) is kept for a possible future Steam source. Findings (2026-11-04): Steam's search endpoint
ignores ``currency`` (always USD cents), caps pages at 10 results, and answers
HTTP 429 for minutes after ~18 anonymous pages, so a full crawl every 6 h is not
workable. Prices are converted to EUR with the ECB daily reference rate.
"""

from __future__ import annotations

import gzip
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Callable

USER_AGENT = "TradeUpLab-data-refresh/1.0"
SEARCH_URL = "https://steamcommunity.com/market/search/render/"
ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
PRICE_VIA = "prices.csgotrader.app"
WEAPON_TYPES = (
    "tag_CSGO_Type_Rifle", "tag_CSGO_Type_Pistol", "tag_CSGO_Type_SMG", "tag_CSGO_Type_Shotgun",
    "tag_CSGO_Type_SniperRifle", "tag_CSGO_Type_Machinegun", "tag_CSGO_Type_Equipment",
)
BASE_PARAMS = [
    ("appid", "730"), ("norender", "1"), ("count", "100"), ("sort_column", "name"), ("sort_dir", "asc"),
    *[("category_730_Type[]", t) for t in WEAPON_TYPES],
]
PAGE_PAUSE = 3.0
MAX_RETRIES = 5
EXPIRY = timedelta(hours=72)
STEAM_FEE_RATE = 0.15
ISO = "%Y-%m-%dT%H:%M:%SZ"


class RateLimited(Exception):
    """Steam answered HTTP 429."""


def parse_search_page(payload: dict, fx: float, seen_at: str) -> dict[str, dict]:
    """Map hash_name -> {price (EUR), listings, seen_at}; ``fx`` is EUR per USD."""
    return {
        r["hash_name"]: {"price": round(r["sell_price"] / 100 * fx, 2), "listings": r["sell_listings"], "seen_at": seen_at}
        for r in payload.get("results") or []
    }


def fetch_all(get_json: Callable[[int], dict], sleep: Callable[[float], None], fx: float, seen_at: str) -> tuple[dict, bool]:
    """Page through all results. Returns (prices, complete); never raises on Steam failures."""
    prices: dict[str, dict] = {}
    start = 0
    while True:
        if start:
            sleep(PAGE_PAUSE)
        payload = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                payload = get_json(start)
                break
            except RateLimited:
                if attempt == MAX_RETRIES:
                    return prices, False
                sleep(PAGE_PAUSE * 2 ** attempt)
        if not payload or not payload.get("success") or not payload.get("results"):
            return prices, False
        prices.update(parse_search_page(payload, fx, seen_at))
        start += len(payload["results"])
        if start >= payload.get("total_count", 0):
            return prices, True


def fetch_ecb_usd_per_eur(get_text: Callable[[str], str]) -> float:
    match = re.search(r"currency=['\"]USD['\"]\s+rate=['\"]([\d.]+)['\"]", get_text(ECB_URL))
    if not match:
        raise ValueError("USD rate not found in ECB feed")
    return float(match.group(1))


def merge_prices(
    previous: dict | None,
    fresh: dict,
    now: datetime,
    complete: bool,
    fx_rate: float | None = None,
    *,
    source: str = "steam",
    fee_rate: float = STEAM_FEE_RATE,
    via: str = PRICE_VIA,
) -> dict:
    """Merge fresh prices over previous ones for ``source``, dropping items unseen for 72 hours."""
    old = ((previous or {}).get("sources") or {}).get(source, {}).get("prices", {})
    cutoff = now - EXPIRY
    kept = {
        name: entry for name, entry in old.items()
        if datetime.strptime(entry["seen_at"], ISO).replace(tzinfo=now.tzinfo) >= cutoff
    }
    kept.update(fresh)
    return {
        "updated_at": now.strftime(ISO),
        "currency": "EUR",
        "fx_rate": fx_rate,
        "complete": complete,
        "sources": {source: {"fee_rate": fee_rate, "via": via, "prices": dict(sorted(kept.items()))}},
    }


def decode_body(raw: bytes) -> bytes:
    """Some hosts gzip responses even without Accept-Encoding; detect by magic bytes."""
    return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw


def _request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return decode_body(resp.read())
    except urllib.error.HTTPError as err:
        if err.code == 429:
            raise RateLimited() from err
        raise


def steam_get_json(start: int) -> dict:
    query = urllib.parse.urlencode([*BASE_PARAMS, ("start", str(start))])
    return json.loads(_request(f"{SEARCH_URL}?{query}").decode("utf-8"))


def http_get_text(url: str) -> str:
    return _request(url).decode("utf-8")
