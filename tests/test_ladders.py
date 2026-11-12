import unittest
from datetime import datetime, timedelta, timezone

from cs2_tradeup.ladders import fetch_sample, parse_listings, refresh_ladders
from cs2_tradeup.steam_prices import RateLimited

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
ISO = "%Y-%m-%dT%H:%M:%SZ"


def listing(cents, float_value, kind="buy_now", id_=None):
    return {"id": id_ or f"{cents}-{float_value}", "type": kind, "price": cents, "item": {"float_value": float_value}}


class ParseListingsTests(unittest.TestCase):
    def test_buy_now_listings_as_price_float_pairs_in_euros(self):
        payload = {"data": [listing(55, 0.31), listing(50, 0.37), listing(9999, 0.2, "auction"), listing(61, 0.16)], "cursor": "abc"}
        self.assertEqual(parse_listings(payload, 0.9), {"55-0.31": [0.5, 0.31], "50-0.37": [0.45, 0.37], "61-0.16": [0.55, 0.16]})

    def test_plain_list_and_missing_float(self):
        self.assertEqual(parse_listings([listing(100, None, id_="a")], 1.0), {})
        self.assertEqual(parse_listings([listing(100, 0.1, id_="a")], 1.0), {"a": [1.0, 0.1]})


class FetchSampleTests(unittest.TestCase):
    def test_cheapest_and_lowest_float_listings_merged_by_float(self):
        calls = []

        def get(name, sort_by):
            calls.append(sort_by)
            if sort_by == "lowest_price":
                return {"data": [listing(100, 0.06, id_="x"), listing(110, 0.05, id_="y")]}
            return {"data": [listing(400, 0.001, id_="z"), listing(110, 0.05, id_="y")]}

        sample = fetch_sample(get, "Item (Factory New)", 1.0)
        self.assertEqual(calls, ["lowest_price", "lowest_float"])
        self.assertEqual(sample, [[4.0, 0.001], [1.1, 0.05], [1.0, 0.06]])  # deduplicated, sorted by float


class RefreshLaddersTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def get(self, name, sort_by):
        self.calls.append(name)
        return {"data": [listing(100, 0.2, id_=f"{name}{sort_by}a"), listing(110, 0.3, id_=f"{name}{sort_by}b")]}

    def test_fetches_missing_then_oldest_first_within_budget(self):
        old = (NOW - timedelta(hours=5)).strftime(ISO)
        older = (NOW - timedelta(hours=9)).strftime(ISO)
        previous = {
            "A": {"listings": [[1, 0.1]], "fetched_at": old},
            "B": {"listings": [[1, 0.1]], "fetched_at": older},
            "Gone": {"listings": [[1, 0.1]], "fetched_at": old},
        }
        ladders, stats = refresh_ladders(["A", "B", "C"], previous, self.get, NOW, budget=2, fx=1.0, sleep=lambda s: None)
        self.assertEqual(self.calls, ["C", "C", "B", "B"])  # never-fetched first, then the oldest; 2 requests each
        self.assertEqual(ladders["C"]["listings"][0], [1.0, 0.2])
        self.assertEqual(ladders["C"]["fetched_at"], NOW.strftime(ISO))
        self.assertEqual(ladders["A"]["fetched_at"], old)
        self.assertNotIn("Gone", ladders)
        self.assertEqual(stats, {"fetched": 2, "kept": 1, "rate_limited": False})

    def test_stops_on_rate_limit_and_keeps_what_it_has(self):
        def limited(name, sort_by):
            self.calls.append(name)
            if len(self.calls) > 2:
                raise RateLimited()
            return {"data": [listing(100, 0.2, id_=sort_by)]}

        ladders, stats = refresh_ladders(["A", "B", "C"], {}, limited, NOW, budget=10, fx=1.0, sleep=lambda s: None)
        self.assertEqual(list(ladders), ["A"])
        self.assertEqual(stats, {"fetched": 1, "kept": 0, "rate_limited": True})

    def test_failed_item_keeps_its_previous_sample(self):
        previous = {"A": {"listings": [[2, 0.1]], "fetched_at": (NOW - timedelta(hours=1)).strftime(ISO)}}

        def broken(name, sort_by):
            raise ValueError("bad response")

        ladders, stats = refresh_ladders(["A"], previous, broken, NOW, budget=5, fx=1.0, sleep=lambda s: None)
        self.assertEqual(ladders["A"]["listings"], [[2, 0.1]])
        self.assertEqual(stats["fetched"], 0)


if __name__ == "__main__":
    unittest.main()
