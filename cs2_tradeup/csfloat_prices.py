"""CSFloat lowest-listing prices from the public prices.csgotrader.app dump.

Each entry carries CSFloat's lowest listing (``starting_at``) and best buy
order (``highest_order``) in USD. We keep the listing as the price, the buy
order for reference, and flag thin markets: no buy order, or a buy order
below 70% of the listing (selling near the listing price is unlikely).
"""

from __future__ import annotations

CSFLOAT_URL = "https://prices.csgotrader.app/latest/csfloat.json"
CSFLOAT_VIA = "prices.csgotrader.app (CSFloat)"
CSFLOAT_FEE_RATE = 0.02
THIN_SPREAD = 0.7


def _price(field) -> float | None:
    value = field.get("price") if isinstance(field, dict) else None
    return value if isinstance(value, (int, float)) and value > 0 else None


def parse_csfloat(payload: dict, fx: float, seen_at: str) -> dict[str, dict]:
    """Map market name -> {price, buy_order (EUR or None), thin, listings: None, seen_at}; ``fx`` is EUR per USD."""
    prices = {}
    for name, entry in payload.items():
        if not isinstance(entry, dict):
            continue
        listing = _price(entry.get("starting_at"))
        if listing is None:
            continue
        order = _price(entry.get("highest_order"))
        prices[name] = _entry(listing, order, fx, seen_at)
        # Doppler-style finishes: one entry per phase, keyed "<name> [<phase>]".
        phase_listings = (entry.get("starting_at") or {}).get("doppler") or {}
        phase_orders = (entry.get("highest_order") or {}).get("doppler") or {}
        for phase, phase_listing in phase_listings.items():
            if isinstance(phase_listing, (int, float)) and phase_listing > 0:
                phase_order = phase_orders.get(phase)
                phase_order = phase_order if isinstance(phase_order, (int, float)) and phase_order > 0 else None
                prices[f"{name} [{phase}]"] = _entry(phase_listing, phase_order, fx, seen_at)
    return prices


def _entry(listing: float, order: float | None, fx: float, seen_at: str) -> dict:
    return {
        "price": round(listing * fx, 2),
        "buy_order": None if order is None else round(order * fx, 2),
        "thin": order is None or order < THIN_SPREAD * listing,
        "listings": None,
        "seen_at": seen_at,
    }


# CSFloat's own live data (no login needed): every item's lowest listing in USD cents and listing count.
PRICE_LIST_URL = "https://csfloat.com/api/v1/listings/price-list"
RATES_URL = "https://csfloat.com/api/v1/meta/exchange-rates"


def parse_price_list(rows: list[dict], fx: float, seen_at: str) -> dict[str, dict]:
    """Map market name -> {price (EUR), listings, seen_at}; skips items with nothing listed. ``fx`` is EUR per USD."""
    prices = {}
    for row in rows:
        cents, quantity = row.get("min_price"), row.get("quantity")
        if not cents or not quantity:
            continue
        prices[row["market_hash_name"]] = {"price": round(cents / 100 * fx, 2), "listings": quantity, "seen_at": seen_at}
    return prices


def parse_exchange_rates(payload: dict) -> float:
    """CSFloat's own EUR per USD rate, so euro prices match what CSFloat shows."""
    rate = (payload.get("data") or {}).get("eur")
    if not isinstance(rate, (int, float)) or rate <= 0:
        raise ValueError("EUR rate missing from CSFloat exchange rates")
    return float(rate)


def combine_prices(live: dict[str, dict], dump: dict[str, dict]) -> dict[str, dict]:
    """Live CSFloat prices and listing counts, plus buy orders and Doppler phase prices from the dump.

    Items not listed on CSFloat right now are dropped (the dump can lag); phase entries
    ("<name> [<phase>]") only exist in the dump and are kept as they are.
    """
    combined = {}
    for name, entry in live.items():
        order = (dump.get(name) or {}).get("buy_order")
        combined[name] = {
            "price": entry["price"],
            "buy_order": order,
            "thin": order is None or order < THIN_SPREAD * entry["price"],
            "listings": entry["listings"],
            "seen_at": entry["seen_at"],
        }
    for name, entry in dump.items():
        if name.endswith("]") and " [" in name:
            combined[name] = entry
    return combined
