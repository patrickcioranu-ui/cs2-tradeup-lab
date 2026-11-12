import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from update_ladders import run  # noqa: E402

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)


class UpdateLaddersTests(unittest.TestCase):
    def test_without_api_key_an_empty_ladders_file_is_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            code = run(Path(tmp), api_key="", targets=["A"], previous={}, getter_factory=None, now=NOW, budget=5, fx=1.0)
            self.assertEqual(code, 0)
            out = json.loads((Path(tmp) / "ladders.json").read_text(encoding="utf-8"))
            self.assertEqual(out["ladders"], {})
            self.assertEqual(out["stats"]["enabled"], False)

    def test_writes_ladders_with_metadata(self):
        def factory(key):
            self.assertEqual(key, "secret")
            return lambda name: {"data": [{"type": "buy_now", "price": 100, "item": {"float_value": 0.2}}]}

        with tempfile.TemporaryDirectory() as tmp:
            code = run(Path(tmp), api_key="secret", targets=["A", "B"], previous={}, getter_factory=factory, now=NOW, budget=5, fx=0.9, sleep=lambda s: None)
            self.assertEqual(code, 0)
            out = json.loads((Path(tmp) / "ladders.json").read_text(encoding="utf-8"))
            self.assertEqual(out["updated_at"], "2026-11-12T12:00:00Z")
            self.assertEqual(out["ladders"]["A"]["prices"], [0.9])
            self.assertEqual(out["stats"], {"fetched": 2, "kept": 0, "rate_limited": False, "targets": 2})


if __name__ == "__main__":
    unittest.main()
