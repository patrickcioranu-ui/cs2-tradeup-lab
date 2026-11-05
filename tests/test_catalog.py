import json
import unittest
from pathlib import Path

from cs2_tradeup.catalog import build_catalog

FIXTURE = Path(__file__).parent / "fixtures" / "bymykel_skins_sample.json"


def load():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def all_names(catalog):
    return {
        skin["market_base_name"]
        for tiers in catalog["collections"].values()
        for skins in tiers.values()
        for skin in skins
    }


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = build_catalog(load(), "2026-11-04T00:00:00Z")

    def test_generated_at_recorded(self):
        self.assertEqual(self.catalog["generated_at"], "2026-11-04T00:00:00Z")

    def test_excludes_knives_gloves_and_collectionless(self):
        names = all_names(self.catalog)
        self.assertFalse(any("Bayonet" in n or "Hand Wraps" in n or "Howl" in n for n in names))
        self.assertEqual(len(names), 5)

    def test_tiers_placed_by_rarity(self):
        phoenix = self.catalog["collections"]["The Phoenix Collection"]
        self.assertEqual([s["market_base_name"] for s in phoenix["2"]], ["MAG-7 | Heaven Guard", "Negev | Terrain"])
        self.assertEqual([s["market_base_name"] for s in phoenix["3"]], ["FAMAS | Sergeant"])
        self.assertEqual(self.catalog["collections"]["The Shattered Web Collection"]["3"][0]["rarity"], 3)

    def test_floats_and_stattrak_mapped(self):
        famas = self.catalog["collections"]["The Phoenix Collection"]["3"][0]
        self.assertEqual((famas["min_float"], famas["max_float"], famas["stattrak_available"]), (0.1, 1, True))
        crossfade = self.catalog["collections"]["The Graphic Design Collection"]["2"][0]
        self.assertFalse(crossfade["stattrak_available"])
        self.assertEqual(set(crossfade), {"id", "market_base_name", "rarity", "min_float", "max_float", "stattrak_available"})

    def test_output_is_deterministic(self):
        reversed_catalog = build_catalog(list(reversed(load())), "2026-11-04T00:00:00Z")
        self.assertEqual(json.dumps(self.catalog, sort_keys=True), json.dumps(reversed_catalog, sort_keys=True))


if __name__ == "__main__":
    unittest.main()


SPECIAL_SKINS = [
    {"id": "cov", "name": "AWP | Test", "category": {"name": "Sniper Rifles"}, "rarity": {"id": "rarity_ancient_weapon"},
     "min_float": 0.0, "max_float": 1.0, "stattrak": True, "collections": [{"name": "Case Collection"}]},
    {"id": "k-p1", "name": "★ Karambit | Doppler", "phase": "Phase 1", "category": {"name": "Knives"},
     "rarity": {"id": "rarity_ancient_weapon"}, "min_float": 0.0, "max_float": 0.08, "stattrak": True, "collections": []},
    {"id": "k-ruby", "name": "★ Karambit | Doppler", "phase": "Ruby", "category": {"name": "Knives"},
     "rarity": {"id": "rarity_ancient_weapon"}, "min_float": 0.0, "max_float": 0.08, "stattrak": True, "collections": []},
    {"id": "k-van", "name": "★ Karambit", "category": {"name": "Knives"}, "rarity": {"id": "rarity_ancient_weapon"},
     "min_float": None, "max_float": None, "stattrak": True, "collections": []},
    {"id": "g-1", "name": "★ Sport Gloves | Vice", "category": {"name": "Gloves"}, "rarity": {"id": "rarity_ancient"},
     "min_float": 0.06, "max_float": 0.8, "stattrak": False, "collections": []},
]
SPECIAL_CRATES = [
    {"name": "Test Case", "type": "Case", "contains": [{"id": "cov"}],
     "contains_rare": [{"id": "k-p1"}, {"id": "k-ruby"}, {"id": "k-van"}, {"id": "g-1"}, {"id": "k-p1"}]},
    {"name": "Sticker Capsule", "type": "Sticker Capsule", "contains": [], "contains_rare": [{"id": "g-1"}]},
]


class SpecialPoolTests(unittest.TestCase):
    def setUp(self):
        from cs2_tradeup.catalog import build_special_pools
        self.pools = build_special_pools(SPECIAL_SKINS, SPECIAL_CRATES)

    def test_pool_keyed_by_the_cases_collection(self):
        self.assertEqual(list(self.pools), ["Case Collection"])

    def test_phases_are_separate_outcomes_and_duplicates_removed(self):
        names = [(e["market_base_name"], e["phase"]) for e in self.pools["Case Collection"]]
        self.assertEqual(names, [
            ("★ Karambit", None),
            ("★ Karambit | Doppler", "Phase 1"),
            ("★ Karambit | Doppler", "Ruby"),
            ("★ Sport Gloves | Vice", None),
        ])

    def test_kinds_floats_vanilla_and_stattrak(self):
        by = {(e["market_base_name"], e["phase"]): e for e in self.pools["Case Collection"]}
        vanilla = by[("★ Karambit", None)]
        self.assertTrue(vanilla["vanilla"])
        self.assertEqual((vanilla["min_float"], vanilla["max_float"]), (0.0, 1.0))
        glove = by[("★ Sport Gloves | Vice", None)]
        self.assertEqual((glove["kind"], glove["stattrak_available"], glove["vanilla"]), ("glove", False, False))
        ruby = by[("★ Karambit | Doppler", "Ruby")]
        self.assertEqual((ruby["kind"], ruby["stattrak_available"], ruby["max_float"]), ("knife", True, 0.08))

    def test_build_catalog_attaches_special_pools(self):
        catalog = build_catalog(SPECIAL_SKINS, "t", raw_crates=SPECIAL_CRATES)
        self.assertIn("Case Collection", catalog["special_pools"])
        self.assertEqual(build_catalog(SPECIAL_SKINS, "t")["special_pools"], {})
