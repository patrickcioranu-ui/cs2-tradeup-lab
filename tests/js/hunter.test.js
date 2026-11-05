import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHunts } from "../../site/hunter.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const catalog = load("mini-catalog.json");
const prices = load("mini-prices.json");
const lookup = (name) => prices.sources.steam.prices[name];
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const base = { query: "", phase: null, minValue: null, wear: null, stattrak: false, maxBudget: null, limit: 50, feeRate: 0, fixedFee: 0 };
const hunt = (opts) => findHunts(catalog, lookup, { ...base, ...opts });
const legKey = (r) => r.legs.map((l) => `${l.count}x${l.option.skin.market_base_name}`).sort().join("+");

// Alpha's pool has 3 finishes (vanilla, Doppler, gloves); Beta's has 1 (wraps).
test("chance of a finish = share of inputs from its case / finishes in that case", () => {
  const results = hunt({ query: "k-knife" });
  assert.equal(legKey(results[0]), "5xA-covert");
  close(results[0].hitChance, 1 / 3);
  close(results[0].costPerHit, 50 / (1 / 3));
  const mixed = results.find((r) => legKey(r) === "1xB-covert+4xA-covert");
  close(mixed.hitChance, (4 / 5) * (1 / 3));
  close(mixed.analysis.cost, 43);
  assert.ok(results.every((r, i) => i === 0 || results[i - 1].hitChance >= r.hitChance));
});

test("a specific phase multiplies by its phase odds (gems 0.5%)", () => {
  close(hunt({ query: "doppler", phase: "Ruby" })[0].hitChance, (1 / 3) * 0.005);
  close(hunt({ query: "doppler", phase: "Phase 1" })[0].hitChance, (1 / 3) * 0.995);
});

test("minValue alone targets everything worth at least that much at its landed wear", () => {
  const [best] = hunt({ minValue: 500 });
  close(best.hitChance, (1 / 3) * 0.005);
  assert.deepEqual(best.targets.map((t) => [t.name, t.phase, t.wear]), [["★ K-knife | Doppler", "Ruby", "FN"]]);
});

test("wear filter keeps only targets landing in that wear; vanilla has no wear", () => {
  assert.equal(hunt({ query: "k-knife", wear: "MW" }).length, 0);
  close(hunt({ query: "k-knife", wear: "FN" })[0].hitChance, 1 / 3);
  assert.equal(hunt({ query: "k-vanilla", wear: "FN" }).length, 0);
  close(hunt({ query: "k-vanilla" })[0].hitChance, 1 / 3);
});

test("StatTrak hunts never target gloves", () => {
  assert.equal(hunt({ query: "g-gloves", stattrak: true }).length, 0);
  assert.ok(hunt({ query: "k-knife", stattrak: true }).length > 0);
});

test("maxBudget, and the full trade-up analysis matches the finder's", () => {
  const keys = hunt({ query: "k-knife", maxBudget: 45 }).map(legKey);
  assert.ok(!keys.includes("5xA-covert"));
  assert.ok(keys.includes("1xB-covert+4xA-covert"));
  const [best] = hunt({ query: "k-knife" });
  close(best.analysis.ev, (0.995 * 200 + 0.005 * 1000 + 150 + 40) / 3);
});

test("no query, phase or value means no target", () => {
  assert.equal(hunt({}).length, 0);
});
