import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cs2_tradeup.steam_prices import (
    RateLimited,
    fetch_all,
    fetch_ecb_usd_per_eur,
    merge_prices,
    parse_search_page,
)

FIXTURE = Path(__file__).parent / "fixtures" / "steam_search_page.json"
SEEN = "2026-11-04T12:00:00Z"
NOW = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)


def page(start, total, n):
    return {
        "success": True,
        "start": start,
        "pagesize": 10,
        "total_count": total,
        "results": [
            {"hash_name": f"Item {start + i}", "sell_price": 100, "sell_listings": 5}
            for i in range(n)
        ],
    }


class Recorder:
    def __init__(self):
        self.sleeps = []

    def __call__(self, seconds):
        self.sleeps.append(seconds)


class ParseTests(unittest.TestCase):
    def test_parse_converts_cents_with_fx_and_rounds(self):
        payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
        prices = parse_search_page(payload, 0.5, SEEN)
        self.assertEqual(prices["AK-47 | Aphrodite (Field-Tested)"], {"price": 8.72, "listings": 791, "seen_at": SEEN})
        self.assertEqual(parse_search_page(payload, 1.0, SEEN)["AK-47 | Aphrodite (Factory New)"]["price"], 273.82)
        self.assertEqual(len(prices), 3)

    def test_ecb_rate_parsed(self):
        xml = "<Cube><Cube time='2026-11-04'><Cube currency='USD' rate='1.1267'/><Cube currency='JPY' rate='178.30'/></Cube></Cube>"
        self.assertAlmostEqual(fetch_ecb_usd_per_eur(lambda url: xml), 1.1267)


class FetchTests(unittest.TestCase):
    def test_pages_until_total_and_sleeps_between(self):
        pages = {0: page(0, 15, 10), 10: page(10, 15, 5)}
        sleep = Recorder()
        prices, complete = fetch_all(lambda start: pages[start], sleep, 1.0, SEEN)
        self.assertEqual(len(prices), 15)
        self.assertTrue(complete)
        self.assertEqual(sleep.sleeps, [3])

    def test_mid_run_failure_keeps_fetched_pages(self):
        responses = {0: page(0, 30, 10), 10: {"success": False}}
        prices, complete = fetch_all(lambda start: responses[start], Recorder(), 1.0, SEEN)
        self.assertEqual(len(prices), 10)
        self.assertFalse(complete)

    def test_empty_results_mid_run_is_incomplete(self):
        responses = {0: page(0, 30, 10), 10: page(10, 30, 0)}
        prices, complete = fetch_all(lambda start: responses[start], Recorder(), 1.0, SEEN)
        self.assertEqual(len(prices), 10)
        self.assertFalse(complete)

    def test_rate_limit_backs_off_then_gives_up(self):
        calls = {"n": 0}

        def get(start):
            if start == 0:
                return page(0, 30, 10)
            calls["n"] += 1
            raise RateLimited()

        sleep = Recorder()
        prices, complete = fetch_all(get, sleep, 1.0, SEEN)
        self.assertEqual(len(prices), 10)
        self.assertFalse(complete)
        self.assertEqual(calls["n"], 6)
        self.assertEqual(sleep.sleeps, [3, 3, 6, 12, 24, 48])

    def test_rate_limit_recovers(self):
        state = {"failed": False}

        def get(start):
            if start == 10 and not state["failed"]:
                state["failed"] = True
                raise RateLimited()
            return page(start, 20, 10)

        prices, complete = fetch_all(get, Recorder(), 1.0, SEEN)
        self.assertEqual(len(prices), 20)
        self.assertTrue(complete)


class MergeTests(unittest.TestCase):
    def test_merge_expires_old_and_overwrites(self):
        iso = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        previous = {
            "sources": {"steam": {"fee_rate": 0.15, "prices": {
                "old": {"price": 1.0, "listings": 1, "seen_at": iso(NOW - timedelta(hours=73))},
                "recent": {"price": 2.0, "listings": 1, "seen_at": iso(NOW - timedelta(hours=71))},
                "updated": {"price": 3.0, "listings": 1, "seen_at": iso(NOW - timedelta(hours=1))},
            }}}
        }
        fresh = {"updated": {"price": 4.0, "listings": 9, "seen_at": SEEN}}
        merged = merge_prices(previous, fresh, NOW, complete=False, fx_rate=1.1267)
        steam = merged["sources"]["steam"]
        self.assertEqual(set(steam["prices"]), {"recent", "updated"})
        self.assertEqual(steam["prices"]["updated"]["price"], 4.0)
        self.assertEqual(steam["fee_rate"], 0.15)
        self.assertEqual(merged["updated_at"], SEEN)
        self.assertEqual(merged["currency"], "EUR")
        self.assertEqual(merged["fx_rate"], 1.1267)
        self.assertFalse(merged["complete"])

    def test_merge_without_previous(self):
        merged = merge_prices(None, {"a": {"price": 1.0, "listings": 1, "seen_at": SEEN}}, NOW, complete=True)
        self.assertEqual(list(merged["sources"]["steam"]["prices"]), ["a"])
        self.assertTrue(merged["complete"])


if __name__ == "__main__":
    unittest.main()
