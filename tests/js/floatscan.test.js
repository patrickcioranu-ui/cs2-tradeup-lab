import { test } from "node:test";
import assert from "node:assert/strict";
import { floatScan } from "../../site/floatscan.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const prices = { FN: { price: 100 }, MW: { price: 50 }, FT: { price: 10 }, WW: { price: 5 }, BS: { price: 1 } };
const inputsAt = (float, minFloat = 0, maxFloat = 1, label = "In") =>
  Array.from({ length: 10 }, () => ({ collection: "A", label, float, minFloat, maxFloat, cost: 2 }));
const scan = (inputs, outMin = 0, outMax = 1, outPrices = prices) =>
  floatScan({ inputs, outputsByCollection: { A: [{ name: "Out", minFloat: outMin, maxFloat: outMax, prices: outPrices }] }, feeRate: 0 });

test("one row per wear the output can land in, best floats first", () => {
  const rows = scan(inputsAt(0.2));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.analysis.outcomes[0].wear), ["FN", "MW", "FT", "WW", "BS"]);
  close(rows[0].minW, 0);
  close(rows[0].maxW, 0.07);
  close(rows[0].analysis.profit, 80);
  close(rows[0].analysis.pProfit, 1);
  close(rows[2].analysis.profit, -10);
  close(rows[4].maxW, 1);
});

test("marks the row matching the current input floats", () => {
  const rows = scan(inputsAt(0.2));
  assert.deepEqual(rows.map((r) => r.current), [false, false, true, false, false]);
  assert.equal(scan(inputsAt(1)).at(-1).current, true);
});

test("gives each input skin its own maximum float from its own range", () => {
  const [first] = scan(inputsAt(0.2, 0, 0.5, "Capped"));
  assert.equal(first.limits.length, 1);
  assert.equal(first.limits[0].label, "Capped");
  close(first.limits[0].maxFloat, 0.035); // 0 + 0.07 * 0.5
});

test("breakpoints come from the output's own float range", () => {
  const rows = scan(inputsAt(0.2), 0.1, 0.6);
  assert.equal(rows.length, 4); // 0.07 is below the range, so MW, FT, WW, BS
  close(rows[0].maxW, 0.1);
  assert.equal(rows[0].analysis.outcomes[0].wear, "MW");
});

test("rows with a missing output price are kept but incomplete", () => {
  const rows = scan(inputsAt(0.2), 0, 1, { FN: { price: 100 }, FT: { price: 10 } });
  assert.equal(rows[1].analysis.complete, false);
  assert.equal(rows[1].analysis.profit, null);
});

test("each row carries the inputs at the float you'd buy: just under the range's limit", () => {
  const [first] = scan(inputsAt(0.2));
  assert.equal(first.inputs.length, 10);
  assert.ok(first.inputs[0].float < 0.07 && first.inputs[0].float > 0.069);
  assert.equal(first.inputs[0].label, "In");
});

const listingByWear = { FN: 10, MW: 5, FT: 2, WW: 1.5, BS: 1 };
const scanPriced = (priceFor) =>
  floatScan({ inputs: inputsAt(0.2), outputsByCollection: { A: [{ name: "Out", minFloat: 0, maxFloat: 1, prices }] }, feeRate: 0, priceFor });

test("rows that need a different input wear are priced at that wear's cheapest listing", () => {
  const rows = scanPriced((input, wear) => listingByWear[wear]);
  close(rows[0].analysis.cost, 100); // FN inputs at 10 each
  close(rows[0].analysis.profit, 0); // FN output 100
  close(rows[1].analysis.cost, 50); // MW at 5
  close(rows[2].analysis.cost, 20); // same wear as now (FT): keeps the cost-column price, 2
  close(rows[4].analysis.cost, 10); // BS at 1
  assert.deepEqual(rows[0].fallbacks, []);
});

test("an input with no listing for that wear keeps its cost-column price and is reported", () => {
  const rows = scanPriced((input, wear) => (wear === "FN" ? undefined : listingByWear[wear]));
  close(rows[0].analysis.cost, 20);
  assert.deepEqual(rows[0].fallbacks, ["In"]);
});

test("without priceFor, every row uses the cost column", () => {
  close(scan(inputsAt(0.2))[0].analysis.cost, 20);
});

test("the 'your floats' row uses your actual inputs: their floats and cost-column prices", () => {
  const rows = scanPriced((input, wear) => listingByWear[wear]);
  const current = rows.find((r) => r.current);
  close(current.analysis.cost, 20);
  close(current.inputs[0].float, 0.2);
});

test("priceFor gets the float limit and which copy it is, so copies walk up real listings", () => {
  const seen = [];
  const rows = scanPriced((input, wear, maxFloat, copy) => {
    seen.push([wear, +maxFloat.toFixed(4), copy]);
    return 10 + copy; // each next copy one euro dearer
  });
  close(rows[0].analysis.cost, 10 * 10 + 45); // 10 FN copies: 10, 11, ..., 19
  assert.deepEqual(seen.filter(([w]) => w === "FN").slice(0, 3), [["FN", 0.07, 0], ["FN", 0.07, 1], ["FN", 0.07, 2]]);
});
