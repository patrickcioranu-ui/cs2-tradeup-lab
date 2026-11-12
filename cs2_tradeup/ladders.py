"""Float-aware listing samples: real CSFloat listings (price + float) per input skin.

The price of an input depends on its float, not just its wear (the cheapest Factory New
may be 0.068 for EUR 1.11 while the cheapest under 0.03 costs EUR 2), and buying several
copies walks up the listings. CSFloat's public price list has neither, so with the user's
API key (GitHub secret CSFLOAT_API_KEY) we read, per input skin and wear, its 50 cheapest
listings and its 50 lowest-float listings. Together they give a price-by-float curve.
Requests are rate-limited, so each run refreshes a batch, oldest first, and keeps the rest.
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
SAMPLE_SIZE = 50
SORTS = ("lowest_price", "lowest_float")
ISO = "%Y-%m-%dT%H:%M:%SZ"


def parse_listings(payload, fx: float) -> dict[str, list]:
    """Buy-now listings -> {listing id: [price EUR, float]} (CSFloat prices are USD cents)."""
    rows = payload.get("data", []) if isinstance(payload, dict) else payload or []
    out = {}
    for row in rows:
        float_value = (row.get("item") or {}).get("float_value")
        if row.get("type", "buy_now") != "buy_now" or not isinstance(row.get("price"), (int, float)) or float_value is None:
            continue
        out[str(row.get("id") or f"{row['price']}-{float_value}")] = [round(row["price"] / 100 * fx, 2), float_value]
    return out


def fetch_sample(get_listings: Callable[[str, str], object], name: str, fx: float) -> list[list]:
    """Cheapest and lowest-float listings for one item, deduplicated, sorted by float."""
    merged = {}
    for sort_by in SORTS:
        merged.update(parse_listings(get_listings(name, sort_by), fx))
    return sorted(merged.values(), key=lambda pair: (pair[1], pair[0]))


def refresh_ladders(
    names: list[str],
    previous: dict,
    get_listings: Callable[[str, str], object],
    now: datetime,
    budget: int,
    fx: float,
    sleep: Callable[[float], None],
    pause: float = 1.0,
) -> tuple[dict, dict]:
    """Refresh up to ``budget`` items (never-fetched first, then oldest); keep the rest.

    Items no longer in ``names`` are dropped. A 429 stops the run early.
    """
    wanted = set(names)
    samples = {name: entry for name, entry in previous.items() if name in wanted and "listings" in entry}
    order = sorted(names, key=lambda n: (n in samples, samples.get(n, {}).get("fetched_at", "")))
    fetched, rate_limited = 0, False
    stamp = now.strftime(ISO)

    def paced(name, sort_by):
        sleep(pause)
        return get_listings(name, sort_by)

    for name in order[:budget]:
        try:
            listings = fetch_sample(paced, name, fx)
        except RateLimited:
            rate_limited = True
            break
        except Exception:
            continue  # keep whatever we had for this item
        samples[name] = {"listings": listings, "fetched_at": stamp}
        fetched += 1
    kept = sum(1 for name in samples if samples[name].get("fetched_at") != stamp)
    return samples, {"fetched": fetched, "kept": kept, "rate_limited": rate_limited}


def csfloat_listings_getter(api_key: str) -> Callable[[str, str], object]:
    """GET /listings for one item and sort order, authenticated with the user's key."""
    def get(name: str, sort_by: str):
        query = urllib.parse.urlencode({"market_hash_name": name, "sort_by": sort_by, "type": "buy_now", "limit": SAMPLE_SIZE})
        req = urllib.request.Request(f"{LISTINGS_URL}?{query}", headers={"Authorization": api_key, "User-Agent": "TradeUpLab-data-refresh/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(decode_body(resp.read()).decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code == 429:
                raise RateLimited() from err
            raise
    return get
