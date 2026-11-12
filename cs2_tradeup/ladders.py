"""Real price ladders: the cheapest few CSFloat "buy now" listings per input skin.

Buying 10 copies of a skin rarely costs 10x the single cheapest listing: each next
copy is the next-cheapest listing. CSFloat's public price list only has the minimum,
so with the user's API key (GitHub secret CSFLOAT_API_KEY) we read the cheapest
listings per input skin. Requests are rate-limited, so each run refreshes a batch,
oldest first, and keeps the rest from the previous deploy.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Callable

from cs2_tradeup.steam_prices import RateLimited, decode_body

LISTINGS_URL = "https://csfloat.com/api/v1/listings"
LADDER_DEPTH = 10
ISO = "%Y-%m-%dT%H:%M:%SZ"


def parse_listings(payload, fx: float) -> dict:
    """Cheapest buy-now listings -> {"prices": [EUR, ascending], "floats": [...]} (prices are USD cents)."""
    rows = payload.get("data", []) if isinstance(payload, dict) else payload or []
    pairs = sorted(
        (row["price"], (row.get("item") or {}).get("float_value"))
        for row in rows
        if row.get("type", "buy_now") == "buy_now" and isinstance(row.get("price"), (int, float))
    )
    return {"prices": [round(cents / 100 * fx, 2) for cents, _ in pairs], "floats": [f for _, f in pairs]}


def refresh_ladders(
    names: list[str],
    previous: dict,
    get_listings: Callable[[str], object],
    now: datetime,
    budget: int,
    fx: float,
    sleep: Callable[[float], None],
    pause: float = 1.0,
) -> tuple[dict, dict]:
    """Refresh up to ``budget`` ladders (never-fetched first, then oldest); keep the rest.

    Ladders for names no longer in ``names`` are dropped. A 429 stops the run early.
    """
    wanted = set(names)
    ladders = {name: entry for name, entry in previous.items() if name in wanted}
    order = sorted(names, key=lambda n: (n in ladders, ladders.get(n, {}).get("fetched_at", "")))
    fetched, rate_limited = 0, False
    stamp = now.strftime(ISO)
    for i, name in enumerate(order[:budget]):
        if i:
            sleep(pause)
        try:
            ladder = parse_listings(get_listings(name), fx)
        except RateLimited:
            rate_limited = True
            break
        except Exception:
            continue  # keep whatever we had for this item
        ladders[name] = {**ladder, "fetched_at": stamp}
        fetched += 1
    kept = sum(1 for name in ladders if ladders[name].get("fetched_at") != stamp)
    return ladders, {"fetched": fetched, "kept": kept, "rate_limited": rate_limited}


def csfloat_listings_getter(api_key: str) -> Callable[[str], object]:
    """GET /listings for one item, cheapest buy-now first, authenticated with the user's key."""
    def get(name: str):
        query = urllib.parse.urlencode({"market_hash_name": name, "sort_by": "lowest_price", "type": "buy_now", "limit": LADDER_DEPTH})
        req = urllib.request.Request(f"{LISTINGS_URL}?{query}", headers={"Authorization": api_key, "User-Agent": "TradeUpLab-data-refresh/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(decode_body(resp.read()).decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 429:
                raise RateLimited() from err
            raise
    return get
