import unittest

from cs2_tradeup import InputItem, OutputSkin, analyze_trade_up, enumerate_outcomes, output_float
from cs2_tradeup.core import normalized_float


def make_inputs():
    return [
        InputItem(f"A{i}", "A" if i < 6 else "B", 0.1, 1.0)
        for i in range(10)
    ]


class TradeUpCoreTests(unittest.TestCase):
    def test_output_float_formula(self):
        inputs = [InputItem(str(i), "A", 0.2, 1.0) for i in range(10)]
        output = OutputSkin("out", "A", 0.10, 0.60, 10.0, 8.0)
        self.assertAlmostEqual(output_float(inputs, output), 0.20)

    def test_weighted_float_spectrogram(self):
        # Spec §4.2 example: 10x M249 | Spectrogram (0-0.50) at 0.15 -> W = 0.30
        inputs = [InputItem(str(i), "A", 0.15, 1.0, min_float=0.0, max_float=0.50) for i in range(10)]
        self.assertAlmostEqual(output_float(inputs, OutputSkin("Crossfade", "A", 0.0, 0.50, 1.0, 1.0)), 0.15)
        self.assertAlmostEqual(output_float(inputs, OutputSkin("Halftone", "A", 0.0, 0.60, 1.0, 1.0)), 0.18)
        self.assertAlmostEqual(output_float(inputs, OutputSkin("Berry", "A", 0.0, 0.80, 1.0, 1.0)), 0.24)

    def test_zero_range_input_normalises_to_zero(self):
        item = InputItem("fixed", "A", 0.3, 1.0, min_float=0.3, max_float=0.3)
        self.assertEqual(normalized_float(item), 0.0)

    def test_input_outside_own_range_rejected(self):
        with self.assertRaises(ValueError):
            InputItem("bad", "A", 0.6, 1.0, min_float=0.0, max_float=0.5)

    def test_collection_weight_and_output_probability(self):
        outputs = {
            "A": [
                OutputSkin("A1", "A", 0.0, 1.0, 10.0, 8.0),
                OutputSkin("A2", "A", 0.0, 1.0, 10.0, 8.0),
            ],
            "B": [OutputSkin("B1", "B", 0.0, 1.0, 10.0, 8.0)],
        }
        outcomes = enumerate_outcomes(make_inputs(), outputs)
        probabilities = {outcome.output.name: outcome.probability for outcome in outcomes}
        self.assertAlmostEqual(probabilities["A1"], 0.30)
        self.assertAlmostEqual(probabilities["A2"], 0.30)
        self.assertAlmostEqual(probabilities["B1"], 0.40)

    def test_expected_value_and_profit_probability(self):
        inputs = [InputItem(str(i), "A", 0.1, 1.0) for i in range(10)]
        outputs = {
            "A": [
                OutputSkin("good", "A", 0.0, 1.0, 30.0, 20.0),
                OutputSkin("bad", "A", 0.0, 1.0, 2.0, 1.0),
            ]
        }
        analysis = analyze_trade_up(inputs, outputs)
        self.assertAlmostEqual(analysis.expected_steam_net, 16.0)
        self.assertAlmostEqual(analysis.steam_expected_profit, 6.0)
        self.assertAlmostEqual(analysis.probability_of_profit("steam"), 0.5)

    def test_fees_are_applied_per_output(self):
        inputs = [InputItem(str(i), "A", 0.1, 1.0) for i in range(10)]
        outputs = {"A": [OutputSkin("out", "A", 0.0, 1.0, 20.0, 20.0)]}
        analysis = analyze_trade_up(inputs, outputs, steam_fee_rate=0.15)
        self.assertAlmostEqual(analysis.expected_steam_net, 17.0)


if __name__ == "__main__":
    unittest.main()
