"""Build the trade-up skin catalog from the public ByMykel CSGO-API dataset."""

from __future__ import annotations

SKINS_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json"

RARITY_TIERS = {
    "rarity_common_weapon": 0,     # Consumer
    "rarity_uncommon_weapon": 1,   # Industrial
    "rarity_rare_weapon": 2,       # Mil-Spec
    "rarity_mythical_weapon": 3,   # Restricted
    "rarity_legendary_weapon": 4,  # Classified
    "rarity_ancient_weapon": 5,    # Covert
}

EXCLUDED_CATEGORIES = {"Knives", "Gloves"}


def build_catalog(raw_skins: list[dict], generated_at: str) -> dict:
    """Group trade-up eligible skins by collection and rarity tier."""
    collections: dict[str, dict[str, list[dict]]] = {}
    for raw in raw_skins:
        if (raw.get("category") or {}).get("name") in EXCLUDED_CATEGORIES:
            continue
        tier = RARITY_TIERS.get((raw.get("rarity") or {}).get("id"))
        skin_collections = raw.get("collections") or []
        if tier is None or not skin_collections:
            continue
        collection = skin_collections[0]["name"]
        collections.setdefault(collection, {}).setdefault(str(tier), []).append({
            "id": raw["id"],
            "market_base_name": raw["name"],
            "rarity": tier,
            "min_float": raw["min_float"],
            "max_float": raw["max_float"],
            "stattrak_available": bool(raw.get("stattrak")),
        })

    ordered = {}
    for name in sorted(collections):
        tiers = collections[name]
        ordered[name] = {
            key: sorted(tiers[key], key=lambda s: (s["market_base_name"], s["id"]))
            for key in sorted(tiers, key=int)
        }
    return {"generated_at": generated_at, "collections": ordered}
