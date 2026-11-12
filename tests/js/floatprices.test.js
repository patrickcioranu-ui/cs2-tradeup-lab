import { test } from "node:test";
import assert from "node:assert/strict";
import { cheapestUnder, floatLevels, freshSample } from "../../site/floatprices.js";
import { findTradeUps, inputOptions } from "../../site/finder.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const MW = { code: "MW", min: 0.07, max: 0.15 };

test("cheapestUnder: the k cheapest listings below a float, filled at the last price when short", () => {
  const listings = [[5, 0.08], [4, 0.12], [1, 0.149]];
  const pick = ({ costs, available }) => ({ costs, available });
  assert.deepEqual(pick(cheapestUnder(listings, 0.14, 2)), { costs: [4, 5], available: 2 });
  assert.deepEqual(pick(cheapestUnder(listings, 0.14, 4)), { costs: [4, 5, 5, 5], available: 2 });
  assert.deepEqual(pick(cheapestUnder(listings, 0.15, 3)), { costs: [1, 4, 5], available: 3 });
  assert.deepEqual(pick(cheapestUnder(listings, 0.05, 2)), { costs: [], available: 0 });
  assert.deepEqual(cheapestUnder(listings, 0.14, Infinity).sorted, [4, 5]);
});

test("floatLevels: the input floats where an output changes wear, inside the bought wear, plus the wear's top", () => {
  const skin = { min_float: 0, max_float: 1 };
  const outputs = [{ min_float: 0, max_float: 0.5 }]; // wear boundaries at W = 0.14, 0.30, 0.76, 0.90
  assert.deepEqual(floatLevels(skin, MW, outputs).map((x) => +x.toFixed(4)), [0.14, 0.15]);
});

test("freshSample ignores missing or old samples", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const samples = { a: { listings: [[1, 0.1]], fetched_at: "2026-11-12T01:00:00Z" }, b: { listings: [[1, 0.1]], fetched_at: "2026-11-10T01:00:00Z" } };
  assert.deepEqual(freshSample(samples, "a", now), [[1, 0.1]]);
  assert.equal(freshSample(samples, "b", now), null);
  assert.equal(freshSample(null, "a", now), null);
});

// One collection: input S (Mil-Spec, 0..1), output O (Restricted, 0..0.5). Buying S below 0.14
// makes O land Factory New (EUR 100) instead of Minimal Wear (EUR 10).
const catalog = {
  collections: {
    C: {
      2: [{ id: "s", market_base_name: "S", min_float: 0, max_float: 1, stattrak_available: false }],
      3: [{ id: "o", market_base_name: "O", min_float: 0, max_float: 0.5, stattrak_available: false }],
    },
  },
};
const table = {
  "S (Minimal Wear)": { price: 1, listings: 3, thin: false },
  "O (Factory New)": { price: 100, listings: 50, thin: false },
  "O (Minimal Wear)": { price: 10, listings: 50, thin: false },
  "O (Field-Tested)": { price: 1, listings: 50, thin: false },
};
const lookup = (n) => table[n];
const samples = { "S (Minimal Wear)": { listings: [[5, 0.08], [4, 0.12], [1, 0.149]], fetched_at: new Date().toISOString() } };

test("with listing samples, input options are real float levels priced from listings", () => {
  const options = inputOptions(catalog, lookup, 2, false, "worst", samples).get("C");
  const levels = options.map((o) => [+o.maxFloat.toFixed(4), o.price, o.priced]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(levels, [[0.14, 4, "listings"], [0.15, 1, "listings"]]);
});

test("the finder picks the low-float level when it pays, costing each copy from real listings", () => {
  const [best] = findTradeUps(catalog, lookup, { tiers: [2], minProfitChance: 0, limit: 5, feeRate: 0, ladders: samples });
  close(best.legs[0].option.maxFloat, 0.14);
  assert.equal(best.analysis.outcomes[0].wear, "FN");
  assert.deepEqual(best.legs[0].costs, [4, 5, 5, 5, 5, 5, 5, 5, 5, 5]); // only 2 listings below 0.14
  assert.equal(best.legs[0].priced, "listings-short");
  close(best.analysis.profit, 100 - 49);
});

test("without samples the finder still uses the cheapest listing per wear", () => {
  const [best] = findTradeUps(catalog, lookup, { tiers: [2], minProfitChance: 0, limit: 5, feeRate: 0 });
  assert.equal(best.legs[0].priced, "estimated");
  close(best.analysis.cost, 10);
});
