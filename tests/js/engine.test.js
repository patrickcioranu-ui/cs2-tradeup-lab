import { test } from "node:test";
import assert from "node:assert/strict";
import { WEARS, wearForFloat, normalizeFloat, outputFloat, netSale, marketName, analyze } from "../../site/engine.js";

const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
const allWears = (price, listings = 100) => Object.fromEntries(WEARS.map((w) => [w.code, { price, listings }]));
const tenOf = (collection, cost, float = 0.1, minFloat = 0, maxFloat = 1) =>
  Array.from({ length: 10 }, () => ({ collection, float, minFloat, maxFloat, cost }));

test("wearForFloat puts boundaries in the higher bucket", () => {
  const cases = [[0, "FN"], [0.0699, "FN"], [0.07, "MW"], [0.15, "FT"], [0.38, "WW"], [0.45, "BS"], [1, "BS"]];
  for (const [f, code] of cases) assert.equal(wearForFloat(f), code, `float ${f}`);
});

test("normalizeFloat handles zero range and capped range", () => {
  assert.equal(normalizeFloat(0.3, 0.3, 0.3), 0);
  close(normalizeFloat(0.15, 0, 0.5), 0.3);
});

test("outputFloat uses weighted float (Spectrogram example)", () => {
  const inputs = Array.from({ length: 10 }, () => ({ float: 0.15, minFloat: 0, maxFloat: 0.5 }));
  close(outputFloat(inputs, 0, 0.5), 0.15);
  close(outputFloat(inputs, 0, 0.6), 0.18);
  close(outputFloat(inputs, 0, 0.8), 0.24);
});

test("marketName builds exact Steam names", () => {
  assert.equal(marketName("AK-47 | Redline", "FT", true), "StatTrak™ AK-47 | Redline (Field-Tested)");
  assert.equal(marketName("AK-47 | Redline", "FT", false), "AK-47 | Redline (Field-Tested)");
});

test("netSale applies rate and fixed fee, floored at zero", () => {
  close(netSale(20, 0.15), 17);
  assert.equal(netSale(1, 0, 5), 0);
});

test("analyze matches Python EV/profit/chance example", () => {
  const result = analyze({
    inputs: tenOf("A", 1),
    outputsByCollection: {
      A: [
        { name: "good", minFloat: 0, maxFloat: 1, prices: allWears(30) },
        { name: "bad", minFloat: 0, maxFloat: 1, prices: allWears(2) },
      ],
    },
    feeRate: 0,
  });
  assert.equal(result.complete, true);
  close(result.cost, 10);
  close(result.ev, 16);
  close(result.profit, 6);
  close(result.roi, 0.6);
  close(result.pProfit, 0.5);
});

test("analyze applies the fee per output", () => {
  const result = analyze({
    inputs: tenOf("A", 1),
    outputsByCollection: { A: [{ name: "out", minFloat: 0, maxFloat: 1, prices: allWears(20) }] },
    feeRate: 0.15,
  });
  close(result.ev, 17);
});

test("analyze weights collections by input count", () => {
  const inputs = [...tenOf("A", 1).slice(0, 6), ...tenOf("B", 1).slice(0, 4)];
  const result = analyze({
    inputs,
    outputsByCollection: {
      A: [
        { name: "A1", minFloat: 0, maxFloat: 1, prices: allWears(5) },
        { name: "A2", minFloat: 0, maxFloat: 1, prices: allWears(5) },
      ],
      B: [{ name: "B1", minFloat: 0, maxFloat: 1, prices: allWears(5) }],
    },
    feeRate: 0,
  });
  const p = Object.fromEntries(result.outcomes.map((o) => [o.name, o.probability]));
  close(p.A1, 0.3);
  close(p.A2, 0.3);
  close(p.B1, 0.4);
});

test("analyze ignores missing listing counts and flags outputs with no 24h sales", () => {
  const prices = (sold) => Object.fromEntries(WEARS.map((w) => [w.code, { price: 5, listings: null, sold_24h: sold }]));
  const result = analyze({
    inputs: tenOf("A", 1),
    outputsByCollection: {
      A: [
        { name: "liquid", minFloat: 0, maxFloat: 1, prices: prices(true) },
        { name: "thin", minFloat: 0, maxFloat: 1, prices: prices(false) },
      ],
    },
    feeRate: 0,
  });
  assert.equal(result.minListings, null);
  assert.equal(result.illiquid, true);
  const liquidOnly = analyze({
    inputs: tenOf("A", 1),
    outputsByCollection: { A: [{ name: "liquid", minFloat: 0, maxFloat: 1, prices: allWears(5, 7) }] },
    feeRate: 0,
  });
  assert.equal(liquidOnly.minListings, 7);
  assert.equal(liquidOnly.illiquid, false);
});

test("analyze reports incomplete when an outcome's wear has no price", () => {
  const result = analyze({
    inputs: tenOf("A", 1, 0.01),
    outputsByCollection: { A: [{ name: "out", minFloat: 0, maxFloat: 1, prices: { MW: { price: 5, listings: 3 } } }] },
    feeRate: 0,
  });
  assert.equal(result.complete, false);
  assert.equal(result.ev, null);
  assert.equal(result.outcomes[0].wear, "FN");
  assert.equal(result.outcomes[0].net, null);
});
