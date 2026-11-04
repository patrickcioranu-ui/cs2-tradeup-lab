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
