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
