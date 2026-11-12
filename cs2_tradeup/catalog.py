"""Build the trade-up skin catalog from the public ByMykel CSGO-API dataset."""

from __future__ import annotations

SKINS_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json"
CRATES_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json"

RARITY_TIERS = {
    "rarity_common_weapon": 0,     # Consumer
    "rarity_uncommon_weapon": 1,   # Industrial
    "rarity_rare_weapon": 2,       # Mil-Spec
    "rarity_mythical_weapon": 3,   # Restricted
    "rarity_legendary_weapon": 4,  # Classified
    "rarity_ancient_weapon": 5,    # Covert
}

EXCLUDED_CATEGORIES = {"Knives", "Gloves"}
# Armory "Limited Edition Item" skins are not part of a real collection, so they cannot be traded up.
EXCLUDED_COLLECTIONS = {"Limited Edition Item"}


def build_catalog(raw_skins: list[dict], generated_at: str, raw_crates: list[dict] | None = None) -> dict:
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
        if collection in EXCLUDED_COLLECTIONS:
            continue
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
    special = build_special_pools(raw_skins, raw_crates) if raw_crates else {}
    return {"generated_at": generated_at, "collections": ordered, "special_pools": special}


def build_special_pools(raw_skins: list[dict], raw_crates: list[dict]) -> dict:
    """Knife/glove pool for each case collection (5-Covert trade-ups, Oct 2025).

    Each weapon case lists its rare special items; Doppler-style phases are
    separate outcomes. Vanilla knives have no float range: they get 0..1 and
    ``vanilla: True`` so their price ignores wear.
    """
    skins = {s["id"]: s for s in raw_skins}
    pools: dict[str, dict[tuple, dict]] = {}
    for crate in raw_crates:
        if crate.get("type") != "Case" or not crate.get("contains_rare"):
            continue
        collection = next(
            (c["name"] for item in crate.get("contains") or [] for c in (skins.get(item["id"], {}).get("collections") or [])),
            None,
        )
        if collection is None:
            continue
        pool = pools.setdefault(collection, {})
        for item in crate["contains_rare"]:
            skin = skins.get(item["id"])
            if not skin:
                continue
            vanilla = skin.get("min_float") is None
            key = (skin["name"], skin.get("phase") or "")
            pool[key] = {
                "id": skin["id"],
                "market_base_name": skin["name"],
                "phase": skin.get("phase"),
                "kind": "glove" if (skin.get("category") or {}).get("name") == "Gloves" else "knife",
                "vanilla": vanilla,
                "min_float": 0.0 if vanilla else skin["min_float"],
                "max_float": 1.0 if vanilla else skin["max_float"],
                "stattrak_available": bool(skin.get("stattrak")),
            }
    return {name: [pool[k] for k in sorted(pool)] for name, pool in sorted(pools.items())}
