// Automatic trade-up search (spec §5). Pure functions: runs in a Web Worker or in Node tests.
import { WEARS, analyze, marketName, normalizeFloat } from "./engine.js";

// Thin market: an output with no buy order near its listing, or any input/output with fewer than 5 listed.
export const LOW_LIQUIDITY = 5;

// Sort order for the Knife and Skin Hunters: chance of the target (default), cost per hit, EV, profit or profit chance.
export function huntComparator(sortBy = "chance") {
  const desc = (get) => (x, y) => (get(y) ?? -Infinity) - (get(x) ?? -Infinity) || x.costPerHit - y.costPerHit;
  if (sortBy === "costPerHit") return (x, y) => x.costPerHit - y.costPerHit || y.hitChance - x.hitChance;
  if (sortBy === "ev") return desc((r) => r.analysis.ev);
  if (sortBy === "profit") return desc((r) => r.analysis.profit);
  if (sortBy === "pProfit") return desc((r) => r.analysis.pProfit);
  return desc((r) => r.hitChance);
}

export function isLowLiquidity(analysis, legs) {
  const thinInput = legs.some((l) => Number.isFinite(l.option.listings) && l.option.listings < LOW_LIQUIDITY);
  return analysis.illiquid || thinInput || (analysis.minListings !== null && analysis.minListings < LOW_LIQUIDITY);
}
// Tier 5 = Covert -> knife/gloves (5-input contract, Oct 2025). Tiers 0-4 use 10 inputs.
export const KNIFE_TIER = 5;
export const contractSize = (tier) => (tier === KNIFE_TIER ? 5 : 10);

function wearAvailable(skin, wear) {
  return skin.min_float < wear.max && skin.max_float >= wear.min;
}

// Which float you get when buying the cheapest listing of a wear.
// "worst" (default, conservative, spec §4.4), "best" (optimistic, like most trade-up sites) or "middle".
function inputFloat(skin, wear, floatMode = "worst") {
  const worst = wear.code === "BS" ? skin.max_float : Math.min(skin.max_float, wear.max - 0.0001);
  const best = Math.max(skin.min_float, wear.min);
  if (floatMode === "best") return best;
  if (floatMode === "middle") return (best + worst) / 2;
  return worst;
}

// Knife/glove pool of a case collection; StatTrak contracts can only return knives.
export function specialPool(catalog, collectionName, stattrak) {
  return ((catalog.special_pools || {})[collectionName] || []).filter((s) => !stattrak || (s.kind === "knife" && s.stattrak_available));
}

export function hasOutputs(catalog, collectionName, tier, stattrak) {
  if (tier === KNIFE_TIER) return specialPool(catalog, collectionName, stattrak).length > 0;
  return skinsAt(catalog.collections[collectionName], tier + 1, stattrak).length > 0;
}

function skinsAt(collection, tier, stattrak) {
  return (collection[String(tier)] || []).filter((s) => !stattrak || s.stattrak_available);
}

export function inputOptions(catalog, lookup, tier, stattrak, floatMode = "worst") {
  const result = new Map();
  for (const [name, collection] of Object.entries(catalog.collections)) {
    const inputs = skinsAt(collection, tier, stattrak);
    if (!inputs.length || !hasOutputs(catalog, name, tier, stattrak)) continue;

    const cheapest = [];
    for (const wear of WEARS) {
      let best = null;
      for (const skin of inputs) {
        if (!wearAvailable(skin, wear)) continue;
        const quote = lookup(marketName(skin.market_base_name, wear.code, stattrak));
        if (!quote || !(quote.price > 0) || quote.listings === 0) continue;
        if (!best || quote.price < best.price) {
          const float = inputFloat(skin, wear, floatMode);
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

function specialName(entry, stattrak) {
  return stattrak ? `★ StatTrak™ ${entry.market_base_name.slice(2)}` : entry.market_base_name;
}

// Valve publishes no Doppler phase odds. Community estimates put each gem at ~0.4-2%;
// we use the cautious 0.5% per gem and split the rest evenly over the regular phases.
export const GEM_PHASE_ODDS = 0.005;
export const GEMS = new Set(["Ruby", "Sapphire", "Black Pearl", "Emerald"]);

// One quote for a whole Doppler-style finish at one wear: phase prices weighted by phase odds.
function phaseWeightedQuote(entries, quoteFor) {
  const quotes = entries.map((e) => ({ gem: GEMS.has(e.phase), q: quoteFor(e) })).filter((x) => x.q);
  const regular = quotes.filter((x) => !x.gem);
  if (!regular.length) return undefined;
  const gems = quotes.filter((x) => x.gem);
  const regularWeight = (1 - GEM_PHASE_ODDS * gems.length) / regular.length;
  const weighted = [...regular.map((x) => ({ ...x, w: regularWeight })), ...gems.map((x) => ({ ...x, w: GEM_PHASE_ODDS }))];
  const allOrders = weighted.every((x) => Number.isFinite(x.q.buy_order));
  return {
    price: weighted.reduce((sum, x) => sum + x.w * x.q.price, 0),
    buy_order: allOrders ? weighted.reduce((sum, x) => sum + x.w * x.q.buy_order, 0) : null,
    thin: regular.some((x) => x.q.thin),
    listings: null,
  };
}

export function outputPool(catalog, lookup, collectionName, tier, stattrak) {
  if (tier === KNIFE_TIER + 1) {
    // Group phases of the same finish (e.g. all "★ Karambit | Doppler" phases) into one outcome.
    const finishes = new Map();
    for (const entry of specialPool(catalog, collectionName, stattrak)) {
      if (!finishes.has(entry.market_base_name)) finishes.set(entry.market_base_name, []);
      finishes.get(entry.market_base_name).push(entry);
    }
    return [...finishes.values()].map((entries) => {
      const [first] = entries;
      const quoteFor = (wear) => (e) => lookup(marketName(e.market_base_name, wear, stattrak, { phase: e.phase, vanilla: e.vanilla }));
      const phased = entries.some((e) => e.phase);
      return {
        name: specialName(first, stattrak),
        minFloat: first.min_float,
        maxFloat: first.max_float,
        prices: Object.fromEntries(
          WEARS.map((w) => [w.code, phased ? phaseWeightedQuote(entries, quoteFor(w.code)) : quoteFor(w.code)(first)]).filter(([, q]) => q),
        ),
      };
    });
  }
  return skinsAt(catalog.collections[collectionName], tier, stattrak).map((skin) => ({
    name: `${stattrak ? "StatTrak™ " : ""}${skin.market_base_name}`,
    minFloat: skin.min_float,
    maxFloat: skin.max_float,
    prices: Object.fromEntries(WEARS.map((w) => [w.code, lookup(marketName(skin.market_base_name, w.code, stattrak))]).filter(([, q]) => q)),
  }));
}

const SORT_KEYS = { profit: "profit", roi: "roi", chance: "pProfit", jackpot: "bestProfit" };

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
  const {
    minProfitChance = 0, maxProfitChance = null, maxBudget = null, minBestProfit = null, minJackpot = null, minProfit = null, minRoi = null, hideLowLiquidity = false, collectionQuery = "",
    tiers = [0, 1, 2, 3, 4], stattrak = "normal", sortBy = "profit", limit = 50, feeRate = 0.15, fixedFee = 0,
    floatMode = "worst", thinValuation = "buy_order",
  } = opts;
  const query = String(collectionQuery || "").trim().toLowerCase();
  const modes = stattrak === "both" ? [false, true] : [stattrak === "stattrak"];
  const compare = comparator(sortBy);

  // Build every search space first so progress can be reported as a fraction.
  const spaces = [];
  let total = 0;
  for (const tier of tiers) {
    for (const st of modes) {
      const options = inputOptions(catalog, lookup, tier, st, floatMode);
      const groups = [...options.entries()];
      const pools = Object.fromEntries(groups.map(([name]) => [name, outputPool(catalog, lookup, name, tier + 1, st)]));
      let work = 0;
      for (let i = 0; i < groups.length; i++) {
        work += groups[i][1].length;
        for (let j = i + 1; j < groups.length; j++) work += groups[i][1].length * groups[j][1].length * (contractSize(tier) - 1);
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
    if (query && !legs.some((l) => l.option.collection.toLowerCase().includes(query))) return;
    const outputsByCollection = {};
    for (const l of legs) outputsByCollection[l.option.collection] = pools[l.option.collection];
    const analysis = analyze({ inputs: legsToInputs(legs), outputsByCollection, feeRate, fixedFee, thinValuation });
    if (!analysis.complete || analysis.pProfit < minProfitChance - 1e-12) return;
    if (maxProfitChance !== null && analysis.pProfit > maxProfitChance + 1e-12) return;
    if (minProfit !== null && analysis.profit < minProfit - 1e-9) return;
    if (minRoi !== null && (analysis.roi === null || analysis.roi < minRoi - 1e-12)) return;
    if (minBestProfit !== null && analysis.bestProfit < minBestProfit - 1e-9) return;
    if (minJackpot !== null && (analysis.jackpotMultiple === null || analysis.jackpotMultiple < minJackpot - 1e-12)) return;
    const lowLiquidity = isLowLiquidity(analysis, legs);
    if (hideLowLiquidity && lowLiquidity) return;
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
    const size = contractSize(tier);
    for (let i = 0; i < groups.length; i++) {
      for (const a of groups[i][1]) {
        consider(tier, st, [{ option: a, count: size }], pools);
        report();
      }
      for (let j = i + 1; j < groups.length; j++) {
        for (const a of groups[i][1]) {
          for (const b of groups[j][1]) {
            for (let k = 1; k < size; k++) consider(tier, st, [{ option: a, count: k }, { option: b, count: size - k }], pools);
            report();
          }
        }
      }
    }
  }

  onProgress(1);
  return kept.sort(compare).slice(0, limit);
}
