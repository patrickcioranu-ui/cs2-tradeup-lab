"""Deterministic trade-up calculations.

This module intentionally has no marketplace/network code. Keeping the math
separate makes it possible to test the model with saved quotes before adding
live data adapters.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Iterable, Mapping


@dataclass(frozen=True)
class InputItem:
    """One item used in a ten-item trade-up contract."""

    name: str
    collection: str
    float_value: float
    acquisition_cost: float

    def __post_init__(self) -> None:
        if not 0.0 <= self.float_value <= 1.0:
            raise ValueError("Input float must be between 0 and 1")
        if self.acquisition_cost < 0.0:
            raise ValueError("Acquisition cost cannot be negative")


@dataclass(frozen=True)
class OutputSkin:
    """An eligible output skin and its current exit quotes."""

    name: str
    collection: str
    min_float: float
    max_float: float
    steam_price: float
    instant_sell_price: float

    def __post_init__(self) -> None:
        if not 0.0 <= self.min_float <= self.max_float <= 1.0:
            raise ValueError("Output float range must be inside [0, 1]")
        if self.steam_price < 0.0 or self.instant_sell_price < 0.0:
            raise ValueError("Output prices cannot be negative")


@dataclass(frozen=True)
class TradeUpOutcome:
    """One possible output, including its probability and computed float."""

    output: OutputSkin
    probability: float
    output_float: float
    steam_net: float
    instant_net: float


@dataclass(frozen=True)
class Analysis:
    """Summary statistics for one trade-up under two exit routes."""

    input_cost: float
    outcomes: tuple[TradeUpOutcome, ...]
    steam_fee_rate: float
    instant_fee_rate: float

    @property
    def expected_steam_net(self) -> float:
        return sum(outcome.probability * outcome.steam_net for outcome in self.outcomes)

    @property
    def expected_instant_net(self) -> float:
        return sum(outcome.probability * outcome.instant_net for outcome in self.outcomes)

    @property
    def steam_expected_profit(self) -> float:
        return self.expected_steam_net - self.input_cost

    @property
    def instant_expected_profit(self) -> float:
        return self.expected_instant_net - self.input_cost

    def probability_of_profit(self, route: str) -> float:
        """Return P(net proceeds > input cost) for ``steam`` or ``instant``."""
        proceeds = self._proceeds(route)
        return sum(
            outcome.probability
            for outcome, net in zip(self.outcomes, proceeds)
            if net > self.input_cost
        )

    def standard_deviation(self, route: str) -> float:
        """Weighted population standard deviation of net proceeds."""
        proceeds = self._proceeds(route)
        mean = sum(outcome.probability * net for outcome, net in zip(self.outcomes, proceeds))
        variance = sum(
            outcome.probability * (net - mean) ** 2
            for outcome, net in zip(self.outcomes, proceeds)
        )
        return sqrt(variance)

    def _proceeds(self, route: str) -> tuple[float, ...]:
        if route == "steam":
            return tuple(outcome.steam_net for outcome in self.outcomes)
        if route == "instant":
            return tuple(outcome.instant_net for outcome in self.outcomes)
        raise ValueError("route must be 'steam' or 'instant'")


def output_float(inputs: Iterable[InputItem], output: OutputSkin) -> float:
    """Calculate the output float using the standard trade-up formula."""
    inputs = tuple(inputs)
    if not inputs:
        raise ValueError("At least one input is required")
    average_input_float = sum(item.float_value for item in inputs) / len(inputs)
    return output.min_float + average_input_float * (output.max_float - output.min_float)


def net_sale_price(gross_price: float, fee_rate: float, fixed_fee: float = 0.0) -> float:
    """Apply a configurable fee model to a gross sale quote."""
    if gross_price < 0.0:
        raise ValueError("Gross price cannot be negative")
    if not 0.0 <= fee_rate < 1.0:
        raise ValueError("Fee rate must be in [0, 1)")
    if fixed_fee < 0.0:
        raise ValueError("Fixed fee cannot be negative")
    return max(0.0, gross_price * (1.0 - fee_rate) - fixed_fee)


def enumerate_outcomes(
    inputs: Iterable[InputItem],
    outputs_by_collection: Mapping[str, Iterable[OutputSkin]],
    *,
    steam_fee_rate: float = 0.0,
    instant_fee_rate: float = 0.0,
    steam_fixed_fee: float = 0.0,
    instant_fixed_fee: float = 0.0,
) -> tuple[TradeUpOutcome, ...]:
    """Enumerate outcomes and probabilities for a ten-item contract.

    Each input contributes one tenth of the collection-selection probability.
    Eligible outputs within the selected collection are treated as equally
    likely, which matches the basic trade-up model. A later data adapter can
    replace this assumption if the game rules change.
    """
    inputs = tuple(inputs)
    if len(inputs) != 10:
        raise ValueError("A trade-up contract must contain exactly 10 inputs")
    if len({item.collection for item in inputs}) == 0:
        raise ValueError("Inputs must contain at least one collection")

    output_lists = {collection: tuple(items) for collection, items in outputs_by_collection.items()}
    outcomes: list[TradeUpOutcome] = []
    for collection in sorted({item.collection for item in inputs}):
        eligible = output_lists.get(collection, ())
        if not eligible:
            raise ValueError(f"No eligible outputs supplied for collection: {collection}")
        collection_probability = sum(item.collection == collection for item in inputs) / 10.0
        output_probability = collection_probability / len(eligible)
        for output in eligible:
            outcomes.append(
                TradeUpOutcome(
                    output=output,
                    probability=output_probability,
                    output_float=output_float(inputs, output),
                    steam_net=net_sale_price(output.steam_price, steam_fee_rate, steam_fixed_fee),
                    instant_net=net_sale_price(
                        output.instant_sell_price,
                        instant_fee_rate,
                        instant_fixed_fee,
                    ),
                )
            )
    probability_total = sum(outcome.probability for outcome in outcomes)
    if abs(probability_total - 1.0) > 1e-9:
        raise ValueError(f"Outcome probabilities sum to {probability_total}, not 1")
    return tuple(outcomes)


def analyze_trade_up(
    inputs: Iterable[InputItem],
    outputs_by_collection: Mapping[str, Iterable[OutputSkin]],
    *,
    steam_fee_rate: float = 0.0,
    instant_fee_rate: float = 0.0,
    steam_fixed_fee: float = 0.0,
    instant_fixed_fee: float = 0.0,
) -> Analysis:
    """Build an analysis for one contract."""
    inputs = tuple(inputs)
    outcomes = enumerate_outcomes(
        inputs,
        outputs_by_collection,
        steam_fee_rate=steam_fee_rate,
        instant_fee_rate=instant_fee_rate,
        steam_fixed_fee=steam_fixed_fee,
        instant_fixed_fee=instant_fixed_fee,
    )
    return Analysis(
        input_cost=sum(item.acquisition_cost for item in inputs),
        outcomes=outcomes,
        steam_fee_rate=steam_fee_rate,
        instant_fee_rate=instant_fee_rate,
    )
