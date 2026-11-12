"""Refresh site/data/ladders.json: the cheapest CSFloat listings per input skin.

Needs the CSFLOAT_API_KEY environment variable (a GitHub Actions secret). Without it,
nothing is written and the site prices every copy at the cheapest listing as before.

Usage: node scripts/ladder_targets.mjs > targets.json
       python scripts/update_ladders.py targets.json
Env:   CSFLOAT_API_KEY, LADDER_BUDGET (items per run, default 300),
       LADDERS_PREVIOUS_URL (last deployed ladders.json, to carry unrefreshed items)
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from cs2_tradeup.ladders import ISO, csfloat_listings_getter, refresh_ladders  # noqa: E402
from cs2_tradeup.steam_prices import decode_body  # noqa: E402

DEFAULT_PREVIOUS = "https://patrickcioranu-ui.github.io/cs2-tradeup-lab/data/ladders.json"


def run(
    data_dir: Path,
    api_key: str,
    targets: list[str],
    previous: dict,
    getter_factory: Callable[[str], Callable],
    now: datetime,
    budget: int,
    fx: float,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    if not api_key:
        print("CSFLOAT_API_KEY not set: skipping price ladders (site uses cheapest-listing prices).")
        empty = {"updated_at": now.strftime(ISO), "stats": {"enabled": False}, "ladders": {}}
        (data_dir / "ladders.json").write_text(json.dumps(empty) + "\n", encoding="utf-8")
        return 0
    ladders, stats = refresh_ladders(targets, previous, getter_factory(api_key), now, budget, fx, sleep)
    stats = {**stats, "targets": len(targets)}
    out = {"updated_at": now.strftime(ISO), "currency": "EUR", "depth": 10, "stats": stats, "ladders": ladders}
    (data_dir / "ladders.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"ladders: fetched {stats['fetched']}, kept {stats['kept']}, targets {stats['targets']}, rate limited: {stats['rate_limited']}")
    return 0


def _previous_ladders(url: str) -> dict:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TradeUpLab-data-refresh/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(decode_body(resp.read()).decode("utf-8")).get("ladders", {})
    except Exception as err:  # first run, or the site has no ladders yet
        print(f"no previous ladders ({err})")
        return {}


def main() -> int:
    targets = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    data_dir = ROOT / "site" / "data"
    prices = json.loads((data_dir / "prices.json").read_text(encoding="utf-8"))
    fx = 1 / prices["fx_rate"]  # fx_rate is USD per EUR
    api_key = os.environ.get("CSFLOAT_API_KEY", "").strip()
    previous = _previous_ladders(os.environ.get("LADDERS_PREVIOUS_URL", DEFAULT_PREVIOUS)) if api_key else {}
    budget = int(os.environ.get("LADDER_BUDGET", "300"))
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return run(data_dir, api_key, targets, previous, csfloat_listings_getter, now, budget, fx)


if __name__ == "__main__":
    sys.exit(main())
