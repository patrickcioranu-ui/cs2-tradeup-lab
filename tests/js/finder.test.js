import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inputOptions, findTradeUps } from "../../site/finder.js";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const catalog = load("mini-catalog.json");
const prices = load("mini-prices.json");
// Local stand-in for data.js priceLookup (Task 8), see ledger pre-flight ruling.
const lookup = (name) => prices.sources.steam.prices[name];
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const base = { minProfitChance: 0, maxBudget: null, tiers: [2], stattrak: "normal", sortBy: "profit", limit: 50, feeRate: 0, fixedFee: 0 };
const run = (opts) => findTradeUps(catalog, lookup, { ...base, ...opts });
const legKey = (r) => r.legs.map((l) => `${l.count}x${l.option.skin.market_base_name}:${l.option.wear}`).sort().join("+");

test("inputOptions keeps cheapest per wear and prunes dominated / unlisted options", () => {
  const options = inputOptions(catalog, lookup, 2, false);
  assert.deepEqual(options.get("Alpha").map((o) => `${o.skin.market_base_name}:${o.wear}`), ["A-cheap:MW"]);
  assert.deepEqual(options.get("Beta").map((o) => `${o.skin.market_base_name}:${o.wear}`).sort(), ["B-cheap:FN", "B-cheap:FT"]);
  assert.equal(options.has("Gamma"), false, "collection without next tier skipped");
  const mw = options.get("Alpha")[0];
  close(mw.float, 0.1499);
  close(mw.norm, 0.1499);
  assert.equal(mw.price, 1);
});

test("best trade-up by profit matches hand calculation", () => {
  const [best, second] = run({});
  assert.equal(legKey(best), "10xA-cheap:MW");
  close(best.analysis.cost, 10);
  close(best.analysis.profit, 25);
  close(best.analysis.pProfit, 1);
  assert.equal(best.lowLiquidity, false);
  assert.equal(legKey(second), "1xB-cheap:FN+9xA-cheap:MW");
  close(second.analysis.profit, 20.9);
  close(second.analysis.pProfit, 0.9);
});

test("candidate landing on an unpriced FN output is never returned", () => {
  const keys = run({}).map(legKey);
  assert.ok(!keys.includes("10xB-cheap:FN"));
  assert.ok(keys.includes("10xB-cheap:FT"));
});

test("minProfitChance filters", () => {
  const results = run({ minProfitChance: 0.95 });
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.analysis.pProfit >= 0.95));
  assert.ok(!results.map(legKey).includes("1xB-cheap:FN+9xA-cheap:MW"));
});

test("maxBudget filters", () => {
  const keys = run({ maxBudget: 10.5 }).map(legKey);
  assert.ok(keys.includes("10xA-cheap:MW"));
  assert.ok(!keys.includes("1xB-cheap:FN+9xA-cheap:MW"));
});

test("stattrak mode only returns StatTrak trade-ups from collections that have them", () => {
  const results = run({ stattrak: "stattrak" });
  assert.equal(results.length, 1);
  assert.equal(results[0].stattrak, true);
  assert.equal(legKey(results[0]), "10xA-cheap:MW");
  close(results[0].analysis.profit, 70);
  assert.equal(results[0].lowLiquidity, true);
  assert.equal(run({ stattrak: "both" }).filter((r) => r.stattrak).length, 1);
});

test("sortBy reorders results", () => {
  const ftK9 = "1xB-cheap:FT+9xA-cheap:MW";
  const fnK4 = "4xA-cheap:MW+6xB-cheap:FN";
  const byProfit = run({ sortBy: "profit" }).map(legKey);
  const byChance = run({ sortBy: "chance" }).map(legKey);
  assert.ok(byProfit.indexOf(fnK4) < byProfit.indexOf(ftK9));
  assert.ok(byChance.indexOf(ftK9) < byChance.indexOf(fnK4));
  const byRoi = run({ sortBy: "roi" });
  for (let i = 1; i < byRoi.length; i++) assert.ok(byRoi[i - 1].analysis.roi >= byRoi[i].analysis.roi);
});

test("quotes without listing counts are usable; an output with no 24h sales marks low liquidity", () => {
  const medianLookup = (name) => {
    const q = lookup(name);
    if (!q || q.listings === 0) return q;
    return { price: q.price, listings: null, sold_24h: name !== "A-out2 (Minimal Wear)" };
  };
  const [best] = findTradeUps(catalog, medianLookup, base);
  assert.equal(legKey(best), "10xA-cheap:MW");
  assert.equal(best.analysis.minListings, null);
  assert.equal(best.lowLiquidity, true);
});

test("limit caps results and progress ends at 1", () => {
  const progress = [];
  const results = findTradeUps(catalog, lookup, { ...base, limit: 3 }, (p) => progress.push(p));
  assert.equal(results.length, 3);
  assert.equal(progress.at(-1), 1);
});

test("minProfit keeps only trade-ups with at least that expected profit", () => {
  const keys = run({ minProfit: 21 }).map(legKey);
  assert.deepEqual(keys, ["10xA-cheap:MW"]);
});

test("minRoi keeps only trade-ups with at least that return", () => {
  const results = run({ minRoi: 2 });
  assert.deepEqual(results.map(legKey), ["10xA-cheap:MW"]);
  assert.ok(results.every((r) => r.analysis.roi >= 2));
});

test("hideLowLiquidity drops thin-market trade-ups", () => {
  assert.equal(run({ stattrak: "stattrak" }).length, 1);
  assert.equal(run({ stattrak: "stattrak", hideLowLiquidity: true }).length, 0);
});

test("collectionQuery keeps trade-ups using a matching collection, case-insensitive", () => {
  const beta = run({ collectionQuery: "BET" });
  assert.ok(beta.length > 0);
  assert.ok(beta.every((r) => r.legs.some((l) => l.option.collection === "Beta")));
  assert.ok(!beta.map(legKey).includes("10xA-cheap:MW"));
  assert.equal(run({ collectionQuery: "  " }).length, run({}).length);
});

// Doppler phases are one outcome, valued by phase odds: each gem 0.5%, regular phases share the rest.
const DOPPLER = 0.995 * 200 + 0.005 * 1000;
const ST_DOPPLER = 0.995 * 300 + 0.005 * 1500;

test("knife tier: 5 Covert inputs; a Doppler finish is one outcome weighted by phase odds; gloves for normal inputs", () => {
  const [best] = run({ tiers: [5] });
  assert.equal(legKey(best), "5xA-covert:MW");
  assert.equal(best.legs[0].count, 5);
  close(best.analysis.cost, 50);
  assert.deepEqual(best.analysis.outcomes.map((o) => o.name).sort(), ["★ G-gloves | Vice", "★ K-knife | Doppler", "★ K-vanilla"]);
  close(best.analysis.outcomes[0].probability, 1 / 3);
  close(best.analysis.ev, (DOPPLER + 150 + 40) / 3); // thin gloves valued at their buy order
});

test("knife tier StatTrak returns knives only, priced as StatTrak knives", () => {
  const [best] = run({ tiers: [5], stattrak: "stattrak" });
  assert.equal(best.stattrak, true);
  assert.deepEqual(best.analysis.outcomes.map((o) => o.name).sort(), ["★ StatTrak™ K-knife | Doppler", "★ StatTrak™ K-vanilla"]);
  close(best.analysis.ev, (ST_DOPPLER + 200) / 2);
});

test("thinValuation 'listing' values thin outputs at the listing when within 2x the buy order", () => {
  const [best] = run({ tiers: [5], thinValuation: "listing" });
  close(best.analysis.ev, (DOPPLER + 150 + 80) / 3);
});

test("floatMode picks worst, middle or best float inside the bought wear", () => {
  const float = (floatMode) => inputOptions(catalog, lookup, 2, false, floatMode).get("Alpha")[0].float;
  close(float("worst"), 0.1499);
  close(float("best"), 0.07);
  close(float("middle"), (0.07 + 0.1499) / 2);
  close(float(undefined), 0.1499);
});

test("maxProfitChance keeps only trade-ups at or below that chance", () => {
  const results = run({ maxProfitChance: 0.95 });
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.analysis.pProfit <= 0.95 + 1e-12));
  assert.ok(!results.map(legKey).includes("10xA-cheap:MW"));
});

test("sortBy 'jackpot' ranks by best-case profit", () => {
  const results = run({ sortBy: "jackpot" });
  assert.ok(results.length > 1);
  for (let i = 1; i < results.length; i++) assert.ok(results[i - 1].analysis.bestProfit >= results[i].analysis.bestProfit);
  close(results[0].analysis.bestProfit, 40); // 10x A-cheap MW: A-out1 MW 50 - cost 10
});

test("minBestProfit and minJackpot filter by the size of the best case", () => {
  const big = run({ minBestProfit: 35 });
  assert.ok(big.length > 0 && big.every((r) => r.analysis.bestProfit >= 35));
  const keys = run({ minJackpot: 4.5 }).map(legKey);
  assert.ok(keys.includes("10xA-cheap:MW")); // 50 / 10 = 5x
  assert.ok(keys.includes("1xB-cheap:FN+9xA-cheap:MW")); // 50 / 11 = 4.55x
  assert.ok(!keys.includes("2xB-cheap:FN+8xA-cheap:MW")); // 50 / 12 = 4.17x
});

test("low liquidity uses real listing counts: any input or output with fewer than 5 listed", () => {
  const withCounts = (counts) => (name) => {
    const q = lookup(name);
    return q && name in counts ? { ...q, listings: counts[name] } : q;
  };
  const best = (counts) => findTradeUps(catalog, withCounts(counts), base).find((r) => legKey(r) === "10xA-cheap:MW");
  assert.equal(best({}).lowLiquidity, false);
  assert.equal(best({ "A-cheap (Minimal Wear)": 3 }).lowLiquidity, true); // thin input
  assert.equal(best({ "A-out2 (Minimal Wear)": 4 }).lowLiquidity, true); // thin output
  assert.equal(best({ "A-out2 (Minimal Wear)": 8 }).lowLiquidity, false); // 8 listed is enough
});

const fresh = () => new Date().toISOString();
const singleA = (ladders) => findTradeUps(catalog, lookup, { ...base, ladders }).find((r) => legKey(r) === "10xA-cheap:MW");

test("price ladders: 10 copies cost the sum of the 10 cheapest real listings", () => {
  const prices = [1, 1, 1.1, 1.1, 1.2, 1.2, 1.3, 1.3, 1.4, 1.5];
  const r = singleA({ "A-cheap (Minimal Wear)": { prices, fetched_at: fresh() } });
  close(r.analysis.cost, 12.1);
  assert.deepEqual(r.legs[0].costs, prices);
  assert.equal(r.legs[0].priced, "ladder");
});

test("price ladders: too few listings fills the rest at the last price and says so", () => {
  const r = singleA({ "A-cheap (Minimal Wear)": { prices: [1, 1.2], fetched_at: fresh() } });
  close(r.analysis.cost, 1 + 1.2 * 9);
  assert.equal(r.legs[0].priced, "ladder-short");
});

test("price ladders: stale or missing ladders fall back to the cheapest listing", () => {
  const old = new Date(Date.now() - 30 * 3600_000).toISOString();
  const stale = singleA({ "A-cheap (Minimal Wear)": { prices: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], fetched_at: old } });
  close(stale.analysis.cost, 10);
  assert.equal(stale.legs[0].priced, "estimated");
  close(singleA(undefined).analysis.cost, 10);
});
