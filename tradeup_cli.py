#!/usr/bin/env python3
"""Run the offline CS2 trade-up analysis demo."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from cs2_tradeup import InputItem, OutputSkin, analyze_trade_up


def load_case(path: Path) -> tuple[list[InputItem], dict[str, list[OutputSkin]], dict[str, float]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    inputs = [InputItem(**item) for item in payload["inputs"]]
    outputs = {
        collection: [OutputSkin(**item) for item in collection_outputs]
        for collection, collection_outputs in payload["outputs_by_collection"].items()
    }
    fees = payload.get("fees", {})
    return inputs, outputs, fees


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyse a CS2 trade-up contract")
    parser.add_argument("case", type=Path, help="Path to a trade-up JSON case")
    args = parser.parse_args()

    inputs, outputs, fees = load_case(args.case)
    analysis = analyze_trade_up(inputs, outputs, **fees)

    print(f"Input cost: €{analysis.input_cost:.2f}")
    print()
    for route in ("steam", "instant"):
        expected = (
            analysis.expected_steam_net
            if route == "steam"
            else analysis.expected_instant_net
        )
        profit = expected - analysis.input_cost
        print(f"{route.title()} exit")
        print(f"  Expected net proceeds: €{expected:.2f}")
        print(f"  Expected profit:       €{profit:.2f}")
        print(f"  P(profit):              {analysis.probability_of_profit(route):.1%}")
        print(f"  Proceeds std. dev.:     €{analysis.standard_deviation(route):.2f}")

    print("\nOutcomes")
    for outcome in sorted(analysis.outcomes, key=lambda item: item.probability, reverse=True):
        print(
            f"  {outcome.output.name}: {outcome.probability:.1%} | "
            f"float {outcome.output_float:.4f} | "
            f"Steam €{outcome.steam_net:.2f} | "
            f"Instant €{outcome.instant_net:.2f}"
        )


if __name__ == "__main__":
    main()
