import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDetails, csfloatUrl, detailsText, atCheapestListings } from "../../site/details.js";
import { analyze, WEARS } from "../../site/engine.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const allWears = (price) => Object.fromEntries(WEARS.map((w) => [w.code, { price, buy_order: price, thin: false }]));
const inputs = [
  ...Array.from({ length: 9 }, () => ({ collection: "A", label: "AUG | Syd Mead", float: 0.3799, minFloat: 0, maxFloat: 1, cost: 7 })),
  { collection: "B", label: "Zeus x27 | Olympus", float: 0.1, minFloat: 0, maxFloat: 1, cost: 5 },
];
const outputsByCollection = {
  A: [{ name: "AK-47 | Big", minFloat: 0, maxFloat: 1, prices: allWears(200) }, { name: "AK-47 | Small", minFloat: 0, maxFloat: 1, prices: allWears(20) }],
  B: [{ name: "★ Karambit", minFloat: 0, maxFloat: 1, prices: allWears(900) }],
};
const analysis = analyze({ inputs, outputsByCollection, feeRate: 0.02 });
const details = buildDetails({ inputs, analysis, stattrak: false });

test("shopping list groups identical inputs with wear, float limit, price and subtotal", () => {
  assert.equal(details.shopping.length, 2);
  const [aug, zeus] = details.shopping;
  assert.deepEqual([aug.count, aug.marketName, aug.wear, aug.maxFloat, aug.price, aug.subtotal], [9, "AUG | Syd Mead (Field-Tested)", "FT", 0.3799, 7, 63]);
  assert.deepEqual([zeus.count, zeus.marketName, zeus.wear], [1, "Zeus x27 | Olympus (Minimal Wear)", "MW"]);
});

test("outcomes are sorted by value with profit per outcome and best/worst flags", () => {
  const names = details.outcomes.map((o) => o.name);
  assert.deepEqual(names, ["★ Karambit", "AK-47 | Big", "AK-47 | Small"]);
  close(details.outcomes[0].profit, 900 * 0.98 - 68);
  assert.equal(details.outcomes[0].best, true);
  assert.equal(details.outcomes.at(-1).worst, true);
  assert.equal(details.outcomes[0].marketName, "★ Karambit"); // vanilla knife: no wear
  assert.match(details.outcomes[1].marketName, /^AK-47 \| Big \((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/);
});

test("csfloatUrl searches the exact item with a float limit", () => {
  const url = new URL(csfloatUrl("AUG | Syd Mead (Field-Tested)", 0.3799));
  assert.equal(url.origin + url.pathname, "https://csfloat.com/search");
  assert.equal(url.searchParams.get("market_hash_name"), "AUG | Syd Mead (Field-Tested)");
  assert.equal(url.searchParams.get("max_float"), "0.3799");
  assert.equal(url.searchParams.get("sort_by"), "lowest_price");
  assert.equal(new URL(csfloatUrl("★ Karambit")).searchParams.get("max_float"), null);
});

test("StatTrak inputs get the StatTrak market name", () => {
  const st = buildDetails({ inputs, analysis, stattrak: true });
  assert.equal(st.shopping[0].marketName, "StatTrak™ AUG | Syd Mead (Field-Tested)");
});

test("detailsText is a plain summary with totals, shopping list and outcomes", () => {
  const text = detailsText(details);
  assert.match(text, /Cost: €68\.00/);
  assert.match(text, /9× AUG \| Syd Mead \(Field-Tested\), float ≤ 0\.3799, €7\.00 each/);
  assert.match(text, /★ Karambit/);
});

test("atCheapestListings reprices each input at its wear's cheapest listing and rescores", () => {
  const listings = { "AUG | Syd Mead (Field-Tested)": 9, "Zeus x27 | Olympus (Minimal Wear)": 4 };
  const real = atCheapestListings(details, (name) => listings[name]);
  close(real.cost, 9 * 9 + 4);
  close(real.costDelta, 85 - 68);
  close(real.ev, analysis.ev);
  close(real.profit, analysis.ev - 85);
  close(real.roi, (analysis.ev - 85) / 85);
  const nets = analysis.outcomes.map((o) => o.net);
  close(real.pProfit, analysis.outcomes.filter((o) => o.net > 85).reduce((s, o) => s + o.probability, 0));
  close(real.bestProfit, Math.max(...nets) - 85);
  assert.equal(real.changed, true);
  assert.deepEqual(real.missing, []);
  assert.deepEqual(real.unitPrices, [9, 4]);
});

test("atCheapestListings keeps the used price when an item has no listing, and reports no change when equal", () => {
  const partial = atCheapestListings(details, (name) => (name.startsWith("AUG") ? 7 : undefined));
  close(partial.cost, 68);
  assert.deepEqual(partial.missing, ["Zeus x27 | Olympus (Minimal Wear)"]);
  assert.equal(partial.changed, false);
});

test("outcomes carry their listing counts for the popup", () => {
  const counted = analyze({
    inputs,
    outputsByCollection: { A: [{ name: "AK-47 | Big", minFloat: 0, maxFloat: 1, prices: Object.fromEntries(WEARS.map((w) => [w.code, { price: 200, listings: 7 }])) }], B: outputsByCollection.B },
    feeRate: 0.02,
  });
  const d = buildDetails({ inputs, analysis: counted });
  assert.equal(d.outcomes.find((o) => o.name === "AK-47 | Big").listings, 7);
});

test("ladder-priced copies of one skin are one shopping line with the real subtotal and price range", () => {
  const laddered = [
    ...[0.5, 0.5, 0.52, 0.55, 0.61].map((cost) => ({ collection: "A", label: "AUG | Syd Mead", float: 0.3799, minFloat: 0, maxFloat: 1, cost })),
    ...inputs.slice(5),
  ];
  const a2 = analyze({ inputs: laddered, outputsByCollection, feeRate: 0.02 });
  const d = buildDetails({ inputs: laddered, analysis: a2, priced: { "AUG | Syd Mead (Field-Tested)": "listings" } });
  const aug = d.shopping.find((s) => s.label === "AUG | Syd Mead");
  assert.equal(aug.count, 9);
  close(aug.subtotal, 0.5 + 0.5 + 0.52 + 0.55 + 0.61 + 4 * 7);
  assert.equal(aug.minPrice, 0.5);
  assert.equal(aug.maxPrice, 7);
  assert.equal(aug.priced, "listings");
  const real = atCheapestListings(d, () => 0.4);
  close(real.cost - a2.cost, (0.4 - 5) * 1); // only the non-ladder Zeus line is repriced (5 -> 0.4)
});
