"""Refresh site/data/catalog.json and site/data/prices.json.

Run from the repository root: ``python scripts/update_data.py``.
Prices are CSFloat lowest listings from the prices.csgotrader.app dump (one download).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from cs2_tradeup.catalog import SKINS_URL, build_catalog  # noqa: E402
from cs2_tradeup.csfloat_prices import CSFLOAT_FEE_RATE, CSFLOAT_URL, CSFLOAT_VIA, parse_csfloat  # noqa: E402
from cs2_tradeup.steam_prices import fetch_ecb_usd_per_eur, http_get_text, merge_prices  # noqa: E402

ISO = "%Y-%m-%dT%H:%M:%SZ"


def _write(path: Path, data: dict) -> None:
    # Compact JSON: prices.json holds ~30k entries and is loaded by the browser.
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def run(data_dir: Path, fetch_catalog: Callable[[], dict], fetch_prices: Callable[[], tuple], now: datetime) -> int:
    """Refresh both data files. Returns 1 only when no prices at all could be fetched."""
    data_dir.mkdir(parents=True, exist_ok=True)
    try:
        _write(data_dir / "catalog.json", fetch_catalog())
    except Exception as err:  # keep the previous catalog, if there is one
        if not (data_dir / "catalog.json").exists():
            print(f"catalog refresh failed and no previous catalog exists: {err}", file=sys.stderr)
            return 1
        print(f"catalog refresh failed, keeping previous file: {err}", file=sys.stderr)

    try:
        fresh, complete, fx_rate = fetch_prices()
    except Exception as err:
        print(f"price refresh failed: {err}", file=sys.stderr)
        return 1
    if not fresh:
        print("no prices fetched; keeping previous prices.json", file=sys.stderr)
        return 1

    prices_path = data_dir / "prices.json"
    previous = json.loads(prices_path.read_text(encoding="utf-8")) if prices_path.exists() else None
    _write(prices_path, merge_prices(previous, fresh, now, complete=complete, fx_rate=fx_rate,
                                     source="csfloat", fee_rate=CSFLOAT_FEE_RATE, via=CSFLOAT_VIA))
    print(f"wrote {len(fresh)} fresh prices (complete={complete})")
    return 0


def main() -> int:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    seen_at = now.strftime(ISO)

    def fetch_catalog() -> dict:
        return build_catalog(json.loads(http_get_text(SKINS_URL)), seen_at)

    def fetch_prices() -> tuple:
        usd_per_eur = fetch_ecb_usd_per_eur(http_get_text)
        prices = parse_csfloat(json.loads(http_get_text(CSFLOAT_URL)), 1 / usd_per_eur, seen_at)
        return prices, bool(prices), usd_per_eur

    return run(ROOT / "site" / "data", fetch_catalog, fetch_prices, now)


if __name__ == "__main__":
    sys.exit(main())
