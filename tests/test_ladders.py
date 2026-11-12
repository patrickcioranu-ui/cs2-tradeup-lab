import unittest
from datetime import datetime, timedelta, timezone

from cs2_tradeup.ladders import parse_listings, refresh_ladders
from cs2_tradeup.steam_prices import RateLimited

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)
ISO = "%Y-%m-%dT%H:%M:%SZ"


def listing(cents, float_value, kind="buy_now"):
    return {"type": kind, "price": cents, "item": {"float_value": float_value, "market_hash_name": "X"}}


class ParseListingsTests(unittest.TestCase):
    def test_buy_now_prices_in_euros_cheapest_first_with_floats(self):
        payload = {"data": [listing(55, 0.31), listing(50, 0.37), listing(9999, 0.2, "auction"), listing(61, 0.16)], "cursor": "abc"}
        ladder = parse_listings(payload, 0.9)
        self.assertEqual(ladder["prices"], [0.45, 0.5, 0.55])
        self.assertEqual(ladder["floats"], [0.37, 0.31, 0.16])

    def test_plain_list_response_also_works(self):
        self.assertEqual(parse_listings([listing(100, 0.1)], 1.0)["prices"], [1.0])


class RefreshLaddersTests(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def get(self, name):
        self.calls.append(name)
        return {"data": [listing(100, 0.2), listing(110, 0.3)]}

    def test_fetches_missing_then_oldest_first_within_budget(self):
        old = (NOW - timedelta(hours=5)).strftime(ISO)
        older = (NOW - timedelta(hours=9)).strftime(ISO)
        previous = {
            "A": {"prices": [1], "floats": [0.1], "fetched_at": old},
            "B": {"prices": [1], "floats": [0.1], "fetched_at": older},
            "Gone": {"prices": [1], "floats": [0.1], "fetched_at": old},
        }
        ladders, stats = refresh_ladders(["A", "B", "C"], previous, self.get, NOW, budget=2, fx=1.0, sleep=lambda s: None)
        self.assertEqual(self.calls, ["C", "B"])  # never-fetched first, then the oldest
        self.assertEqual(ladders["C"]["prices"], [1.0, 1.1])
        self.assertEqual(ladders["C"]["fetched_at"], NOW.strftime(ISO))
        self.assertEqual(ladders["A"]["fetched_at"], old)  # kept from before
        self.assertNotIn("Gone", ladders)  # no longer an input the finder uses
        self.assertEqual(stats, {"fetched": 2, "kept": 1, "rate_limited": False})

    def test_stops_on_rate_limit_and_keeps_what_it_has(self):
        def limited(name):
            self.calls.append(name)
            if len(self.calls) > 1:
                raise RateLimited()
            return {"data": [listing(100, 0.2)]}

        ladders, stats = refresh_ladders(["A", "B", "C"], {}, limited, NOW, budget=10, fx=1.0, sleep=lambda s: None)
        self.assertEqual(list(ladders), ["A"])
        self.assertEqual(stats, {"fetched": 1, "kept": 0, "rate_limited": True})

    def test_failed_item_keeps_its_previous_ladder(self):
        previous = {"A": {"prices": [2], "floats": [0.1], "fetched_at": (NOW - timedelta(hours=1)).strftime(ISO)}}

        def broken(name):
            raise ValueError("bad response")

        ladders, stats = refresh_ladders(["A"], previous, broken, NOW, budget=5, fx=1.0, sleep=lambda s: None)
        self.assertEqual(ladders["A"]["prices"], [2])
        self.assertEqual(stats["fetched"], 0)


if __name__ == "__main__":
    unittest.main()
