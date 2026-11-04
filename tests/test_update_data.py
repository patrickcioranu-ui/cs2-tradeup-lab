import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from update_data import run  # noqa: E402

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)
SEEN = "2026-11-04T12:00:00Z"
CATALOG = {"generated_at": SEEN, "collections": {"X": {"2": []}}}
FRESH = {"StatTrak™ AK-47 | Redline (Field-Tested)": {"price": 9.5, "listings": 3, "seen_at": SEEN}}


def boom():
    raise OSError("network down")


class UpdateDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def read(self, name):
        return (self.dir / name).read_text(encoding="utf-8")

    def test_normal_run_writes_both_files_readably(self):
        code = run(self.dir, lambda: CATALOG, lambda: (FRESH, True, 1.1), NOW)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(self.read("catalog.json")), CATALOG)
        self.assertIn("StatTrak™", self.read("prices.json"))
        self.assertEqual(json.loads(self.read("prices.json"))["fx_rate"], 1.1)

    def test_catalog_failure_keeps_old_catalog_and_writes_prices(self):
        (self.dir / "catalog.json").write_text('{"old": true}', encoding="utf-8")
        code = run(self.dir, boom, lambda: (FRESH, True, 1.1), NOW)
        self.assertEqual(code, 0)
        self.assertEqual(self.read("catalog.json"), '{"old": true}')
        self.assertTrue((self.dir / "prices.json").exists())

    def test_catalog_failure_without_previous_catalog_fails(self):
        code = run(self.dir, boom, lambda: (FRESH, True, 1.1), NOW)
        self.assertEqual(code, 1)
        self.assertFalse((self.dir / "catalog.json").exists())

    def test_no_prices_fetched_keeps_old_prices_and_fails(self):
        (self.dir / "prices.json").write_text('{"old": true}', encoding="utf-8")
        code = run(self.dir, lambda: CATALOG, lambda: ({}, False, 1.1), NOW)
        self.assertEqual(code, 1)
        self.assertEqual(self.read("prices.json"), '{"old": true}')


if __name__ == "__main__":
    unittest.main()
