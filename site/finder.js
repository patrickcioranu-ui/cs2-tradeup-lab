// Automatic trade-up search (spec §5). Pure functions: runs in a Web Worker or in Node tests.
import { WEARS, analyze, marketName, normalizeFloat } from "./engine.js";

const LOW_LIQUIDITY = 10;

function wearAvailable(skin, wear) {
  return skin.min_float < wear.max && skin.max_float >= wear.min;
}

// Conservative assumption (spec §4.4): you get the worst float inside the wear you buy.
function worstFloat(skin, wear) {
  return wear.code === "BS" ? skin.max_float : Math.min(skin.max_float, wear.max - 0.0001);
}

function skinsAt(collection, tier, stattrak) {
  return (collection[String(tier)] || []).filter((s) => !stattrak || s.stattrak_available);
}

export function inputOptions(catalog, lookup, tier, stattrak) {
  const result = new Map();
  for (const [name, collection] of Object.entries(catalog.collections)) {
    const inputs = skinsAt(collection, tier, stattrak);
    if (!inputs.length || !skinsAt(collection, tier + 1, stattrak).length) continue;

    const cheapest = [];
    for (const wear of WEARS) {
      let best = null;
      for (const skin of inputs) {
        if (!wearAvailable(skin, wear)) continue;
        const quote = lookup(marketName(skin.market_base_name, wear.code, stattrak));
        if (!quote || !(quote.price > 0) || quote.listings === 0) continue;
        if (!best || quote.price < best.price) {
          const float = worstFloat(skin, wear);
          best = { collection: name, skin, wear: wear.code, float, norm: normalizeFloat(float, skin.min_float, skin.max_float), price: quote.price, listings: quote.listings };
        }
      }
      if (best) cheapest.push(best);
    }

    const kept = cheapest.filter((x) => !cheapest.some((y) => y !== x && y.price <= x.price && y.norm <= x.norm && (y.price < x.price || y.norm < x.norm)));
    if (kept.length) result.set(name, kept);
  }
  return result;
}

function outputPool(catalog, lookup, collectionName, tier, stattrak) {
  return skinsAt(catalog.collections[collectionName], tier, stattrak).map((skin) => ({
    name: `${stattrak ? "StatTrak™ " : ""}${skin.market_base_name}`,
    minFloat: skin.min_float,
    maxFloat: skin.max_float,
    prices: Object.fromEntries(WEARS.map((w) => [w.code, lookup(marketName(skin.market_base_name, w.code, stattrak))]).filter(([, q]) => q)),
  }));
}

const SORT_KEYS = { profit: "profit", roi: "roi", chance: "pProfit" };

function comparator(sortBy) {
  const key = SORT_KEYS[sortBy] || "profit";
  return (a, b) => (b.analysis[key] ?? -Infinity) - (a.analysis[key] ?? -Infinity) || a.analysis.cost - b.analysis.cost;
}

function legsToInputs(legs) {
  const inputs = [];
  for (const { option, count } of legs) {
    for (let i = 0; i < count; i++) {
      inputs.push({ collection: option.collection, float: option.float, minFloat: option.skin.min_float, maxFloat: option.skin.max_float, cost: option.price });
    }
  }
  return inputs;
}

export function findTradeUps(catalog, lookup, opts, onProgress = () => {}) {
  const { minProfitChance = 0, maxBudget = null, tiers = [0, 1, 2, 3, 4], stattrak = "normal", sortBy = "profit", limit = 50, feeRate = 0.15, fixedFee = 0 } = opts;
  const modes = stattrak === "both" ? [false, true] : [stattrak === "stattrak"];
  const compare = comparator(sortBy);

  // Build every search space first so progress can be reported as a fraction.
  const spaces = [];
  let total = 0;
  for (const tier of tiers) {
    for (const st of modes) {
      const options = inputOptions(catalog, lookup, tier, st);
      const groups = [...options.entries()];
      const pools = Object.fromEntries(groups.map(([name]) => [name, outputPool(catalog, lookup, name, tier + 1, st)]));
      let work = 0;
      for (let i = 0; i < groups.length; i++) {
        work += groups[i][1].length;
        for (let j = i + 1; j < groups.length; j++) work += groups[i][1].length * groups[j][1].length * 9;
      }
      spaces.push({ tier, st, groups, pools });
      total += work;
    }
  }

  let kept = [];
  let done = 0;
  let lastReport = 0;
  const consider = (tier, st, legs, pools) => {
    done++;
    const cost = legs.reduce((s, l) => s + l.option.price * l.count, 0);
    if (maxBudget !== null && cost > maxBudget + 1e-9) return;
    const outputsByCollection = {};
    for (const l of legs) outputsByCollection[l.option.collection] = pools[l.option.collection];
    const analysis = analyze({ inputs: legsToInputs(legs), outputsByCollection, feeRate, fixedFee });
    if (!analysis.complete || analysis.pProfit < minProfitChance - 1e-12) return;
    const lowLiquidity = analysis.illiquid || (analysis.minListings !== null && analysis.minListings < LOW_LIQUIDITY);
    kept.push({ tier, stattrak: st, legs, analysis, lowLiquidity });
    if (kept.length > limit * 20) kept = kept.sort(compare).slice(0, limit);
  };
  const report = () => {
    if (total && done - lastReport >= total / 100) {
      lastReport = done;
      onProgress(done / total);
    }
  };

  for (const { tier, st, groups, pools } of spaces) {
    for (let i = 0; i < groups.length; i++) {
      for (const a of groups[i][1]) {
        consider(tier, st, [{ option: a, count: 10 }], pools);
        report();
      }
      for (let j = i + 1; j < groups.length; j++) {
        for (const a of groups[i][1]) {
          for (const b of groups[j][1]) {
            for (let k = 1; k <= 9; k++) consider(tier, st, [{ option: a, count: k }, { option: b, count: 10 - k }], pools);
            report();
          }
        }
      }
    }
  }

  onProgress(1);
  return kept.sort(compare).slice(0, limit);
}
