import unittest
from datetime import datetime, timezone

from cs2_tradeup.csfloat_prices import CSFLOAT_FEE_RATE, parse_csfloat
from cs2_tradeup.steam_prices import merge_prices

SEEN = "2026-11-05T06:00:00Z"
NOW = datetime(2026, 11, 5, 6, 0, tzinfo=timezone.utc)


class CsfloatParseTests(unittest.TestCase):
    def setUp(self):
        payload = {
            "AK-47 | Redline (Field-Tested)": {"price": 23.84, "starting_at": {"price": 23.84}, "highest_order": {"price": 23.4}},
            "P90 | Glacier Mesh (Battle-Scarred)": {"price": 11.21, "starting_at": {"price": 11.21}, "highest_order": {"price": 5.0}},
            "No Orders (Field-Tested)": {"price": 3.0, "starting_at": {"price": 3.0}, "highest_order": None},
            "Unlisted (Factory New)": {"price": None, "starting_at": None, "highest_order": {"price": 2.0}},
        }
        self.prices = parse_csfloat(payload, 0.5, SEEN)

    def test_uses_lowest_listing_converted(self):
        self.assertEqual(self.prices["AK-47 | Redline (Field-Tested)"]["price"], 11.92)
        self.assertEqual(self.prices["AK-47 | Redline (Field-Tested)"]["buy_order"], 11.7)

    def test_liquid_item_is_not_thin(self):
        self.assertFalse(self.prices["AK-47 | Redline (Field-Tested)"]["thin"])

    def test_wide_spread_is_thin(self):
        self.assertTrue(self.prices["P90 | Glacier Mesh (Battle-Scarred)"]["thin"])

    def test_no_buy_order_is_thin(self):
        entry = self.prices["No Orders (Field-Tested)"]
        self.assertTrue(entry["thin"])
        self.assertIsNone(entry["buy_order"])

    def test_unlisted_item_dropped(self):
        self.assertNotIn("Unlisted (Factory New)", self.prices)

    def test_merge_writes_csfloat_source(self):
        merged = merge_prices(None, self.prices, NOW, complete=True, fx_rate=1.1, source="csfloat",
                              fee_rate=CSFLOAT_FEE_RATE, via="prices.csgotrader.app (CSFloat)")
        self.assertEqual(list(merged["sources"]), ["csfloat"])
        self.assertEqual(merged["sources"]["csfloat"]["fee_rate"], 0.02)
        self.assertEqual(len(merged["sources"]["csfloat"]["prices"]), 3)


if __name__ == "__main__":
    unittest.main()
