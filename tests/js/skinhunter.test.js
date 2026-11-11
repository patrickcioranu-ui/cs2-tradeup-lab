import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findSkinHunts, huntableSkins } from "../../site/skinhunter.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const catalog = load("mini-catalog.json");
const prices = load("mini-prices.json");
const lookup = (name) => prices.sources.steam.prices[name];
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const base = { skin: "", wear: null, stattrak: false, maxBudget: null, limit: 50, feeRate: 0, fixedFee: 0 };
const hunt = (opts) => findSkinHunts(catalog, lookup, { ...base, ...opts });
const legKey = (r) => r.legs.map((l) => `${l.count}x${l.option.skin.market_base_name}:${l.option.wear}`).sort().join("+");

test("huntableSkins lists skins that some trade-up can produce", () => {
  const skins = huntableSkins(catalog);
  assert.ok(skins.includes("A-out1") && skins.includes("B-out2"));
  assert.ok(!skins.includes("A-cheap")); // Consumer-level inputs here have no lower tier
  assert.ok(!skins.includes("A-covert")); // no Classified inputs in its collection
});

test("chance = share of inputs from the skin's collection / skins at that rarity there", () => {
  const results = hunt({ skin: "A-out1" });
  assert.equal(legKey(results[0]), "10xA-cheap:MW");
  close(results[0].hitChance, 0.5);
  close(results[0].costPerHit, 10 / 0.5);
  assert.equal(results[0].tier, 2);
  const mixed = results.find((r) => legKey(r) === "1xB-cheap:FN+9xA-cheap:MW");
  close(mixed.hitChance, 0.45);
  assert.ok(results.every((r) => r.legs.some((l) => l.option.collection === "Alpha")));
  assert.equal(results[0].targets[0].wear, "MW");
});

test("wear filter keeps only trade-ups where the skin lands in that wear", () => {
  const mw = hunt({ skin: "A-out1", wear: "MW" }).map(legKey);
  assert.ok(mw.includes("10xA-cheap:MW") && mw.includes("1xB-cheap:FN+9xA-cheap:MW"));
  assert.ok(!mw.includes("1xB-cheap:FT+9xA-cheap:MW")); // lands Field-Tested
  assert.equal(hunt({ skin: "A-out1", wear: "FN" }).length, 0);
});

test("StatTrak: only skins that exist in StatTrak, chance among StatTrak outputs", () => {
  assert.equal(hunt({ skin: "A-out2", stattrak: true }).length, 0);
  const [st] = hunt({ skin: "A-out1", stattrak: true });
  assert.equal(st.stattrak, true);
  close(st.hitChance, 1); // A-out1 is the only StatTrak Restricted in Alpha
});

test("budget and unknown skins", () => {
  assert.ok(hunt({ skin: "A-out1", maxBudget: 10.5 }).every((r) => r.analysis.cost <= 10.5));
  assert.equal(hunt({ skin: "Nope" }).length, 0);
  assert.equal(hunt({}).length, 0);
});
