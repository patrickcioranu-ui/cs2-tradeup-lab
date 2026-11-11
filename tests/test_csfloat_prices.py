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
            "★ Karambit | Doppler (Factory New)": {"price": 1080, "starting_at": {"price": 1080, "doppler": {"Phase 3": 1080, "Ruby": 6450}},
                                                     "highest_order": {"price": 990, "doppler": {"Phase 3": 1030}}},
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
        self.assertEqual(len(merged["sources"]["csfloat"]["prices"]), 6)

    def test_doppler_phases_get_their_own_entries(self):
        ruby = self.prices["★ Karambit | Doppler (Factory New) [Ruby]"]
        self.assertEqual((ruby["price"], ruby["buy_order"], ruby["thin"]), (3225.0, None, True))
        p3 = self.prices["★ Karambit | Doppler (Factory New) [Phase 3]"]
        self.assertEqual((p3["price"], p3["buy_order"], p3["thin"]), (540.0, 515.0, False))
        self.assertEqual(self.prices["★ Karambit | Doppler (Factory New)"]["price"], 540.0)


if __name__ == "__main__":
    unittest.main()


class CsfloatLiveTests(unittest.TestCase):
    def test_price_list_uses_min_price_cents_and_quantity(self):
        from cs2_tradeup.csfloat_prices import parse_price_list
        rows = [
            {"market_hash_name": "AK-47 | Redline (Field-Tested)", "quantity": 3749, "min_price": 2386},
            {"market_hash_name": "Gone (Factory New)", "quantity": 0, "min_price": 500},
            {"market_hash_name": "Free (Factory New)", "quantity": 3, "min_price": 0},
        ]
        prices = parse_price_list(rows, 0.5, SEEN)
        self.assertEqual(prices, {"AK-47 | Redline (Field-Tested)": {"price": 11.93, "listings": 3749, "seen_at": SEEN}})

    def test_csfloat_eur_rate(self):
        from cs2_tradeup.csfloat_prices import parse_exchange_rates
        self.assertEqual(parse_exchange_rates({"data": {"usd": 1, "eur": 0.897375}}), 0.897375)
        with self.assertRaises(ValueError):
            parse_exchange_rates({"data": {}})

    def test_combine_takes_live_prices_and_counts_with_dump_buy_orders_and_phases(self):
        from cs2_tradeup.csfloat_prices import combine_prices
        live = {
            "AK-47 | Redline (Field-Tested)": {"price": 21.4, "listings": 3749, "seen_at": SEEN},
            "Thin (Well-Worn)": {"price": 10.0, "listings": 2, "seen_at": SEEN},
            "No Orders (Battle-Scarred)": {"price": 3.0, "listings": 40, "seen_at": SEEN},
        }
        dump = {
            "AK-47 | Redline (Field-Tested)": {"price": 21.0, "buy_order": 20.9, "thin": False, "listings": None, "seen_at": SEEN},
            "Thin (Well-Worn)": {"price": 7.0, "buy_order": 5.0, "thin": False, "listings": None, "seen_at": SEEN},
            "Stale Only In Dump (Factory New)": {"price": 9.0, "buy_order": 8.0, "thin": False, "listings": None, "seen_at": SEEN},
            "★ Karambit | Doppler (Factory New) [Ruby]": {"price": 5800.0, "buy_order": 5200.0, "thin": False, "listings": None, "seen_at": SEEN},
        }
        out = combine_prices(live, dump)
        self.assertEqual(out["AK-47 | Redline (Field-Tested)"], {"price": 21.4, "buy_order": 20.9, "thin": False, "listings": 3749, "seen_at": SEEN})
        self.assertTrue(out["Thin (Well-Worn)"]["thin"])  # buy order 5 < 70% of live 10
        self.assertEqual(out["No Orders (Battle-Scarred)"]["buy_order"], None)
        self.assertTrue(out["No Orders (Battle-Scarred)"]["thin"])
        self.assertNotIn("Stale Only In Dump (Factory New)", out)  # not listed on CSFloat now
        self.assertEqual(out["★ Karambit | Doppler (Factory New) [Ruby]"]["price"], 5800.0)  # phases from the dump
