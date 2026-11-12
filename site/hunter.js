// Knife Hunter: rank 5-Covert trade-ups by the chance of hitting a chosen knife/gloves target.
import { analyze, marketName, normalizeFloat, saleValue, wearForFloat } from "./engine.js";
import { GEMS, GEM_PHASE_ODDS, KNIFE_TIER, huntComparator, inputOptions, isLowLiquidity, legsToInputs, outputPool, priceLegs, specialPool } from "./finder.js";

const SIZE = 5;

// Chance of a given phase within its finish (phase odds as in finder.phaseWeightedQuote).
function phaseOdds(entry, finishEntries) {
  if (!entry.phase) return 1;
  if (GEMS.has(entry.phase)) return GEM_PHASE_ODDS;
  const gems = finishEntries.filter((e) => GEMS.has(e.phase)).length;
  const regular = finishEntries.filter((e) => e.phase && !GEMS.has(e.phase)).length;
  return (1 - GEM_PHASE_ODDS * gems) / regular;
}

// "\u2605 Karambit | Doppler" -> type "Karambit", finish "Doppler"; vanilla "\u2605 Karambit" -> finish "Vanilla".
export function knifeType(entry) {
  return entry.market_base_name.replace(/^\u2605 /, "").split(" | ")[0];
}

export function knifeFinish(entry) {
  const parts = entry.market_base_name.split(" | ");
  return parts.length > 1 ? parts.slice(1).join(" | ") : "Vanilla";
}

// Every knife type, then every glove type, each with its skins, from all case pools.
export function knifeTypes(catalog) {
  const types = new Map();
  for (const pool of Object.values(catalog.special_pools || {})) {
    for (const e of pool) {
      const type = knifeType(e);
      if (!types.has(type)) types.set(type, { type, kind: e.kind, finishes: new Set() });
      types.get(type).finishes.add(knifeFinish(e));
    }
  }
  const order = { knife: 0, glove: 1 };
  return [...types.values()]
    .map((t) => ({ type: t.type, kind: t.kind, finishes: [...t.finishes].sort() }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.type.localeCompare(b.type));
}

function displayName(entry, stattrak) {
  return stattrak ? `★ StatTrak™ ${entry.market_base_name.slice(2)}` : entry.market_base_name;
}

export function findHunts(catalog, lookup, opts, onProgress = () => {}) {
  const {
    query = "", itemType = null, finish = null, phase = null, minValue = null, wear = null, stattrak = false, maxBudget = null, limit = 50,
    feeRate = 0.02, fixedFee = 0, floatMode = "worst", thinValuation = "buy_order", ladders = null,
  } = opts;
  const q = String(query || "").trim().toLowerCase();
  if (!q && !itemType && !finish && !phase && minValue === null) return [];

  // Per case: its finishes (phases grouped) and the entries that could be the target.
  const cases = new Map();
  for (const name of Object.keys(catalog.special_pools || {})) {
    const pool = specialPool(catalog, name, stattrak);
    const finishes = new Map();
    for (const e of pool) (finishes.get(e.market_base_name) || finishes.set(e.market_base_name, []).get(e.market_base_name)).push(e);
    const candidates = pool.filter((e) =>
      (!q || e.market_base_name.toLowerCase().includes(q))
      && (!itemType || knifeType(e) === itemType)
      && (!finish || knifeFinish(e) === finish)
      && (!phase || e.phase === phase)
      && !(wear && e.vanilla));
    cases.set(name, { finishes, finishCount: finishes.size, candidates });
  }

  const options = inputOptions(catalog, lookup, KNIFE_TIER, stattrak, floatMode);
  const groups = [...options.entries()];
  const hasTarget = (name) => (cases.get(name)?.candidates.length || 0) > 0;
  const pools = Object.fromEntries(groups.map(([name]) => [name, outputPool(catalog, lookup, name, KNIFE_TIER + 1, stattrak)]));

  const results = [];
  const now = Date.now();
  const consider = (rawLegs) => {
    const legs = priceLegs(rawLegs, ladders, now);
    if (!legs.some((l) => hasTarget(l.option.collection))) return;
    const cost = legs.reduce((s, l) => s + l.costs.reduce((a, c) => a + c, 0), 0);
    if (maxBudget !== null && cost > maxBudget + 1e-9) return;
    const w = legs.reduce((s, l) => s + l.count * normalizeFloat(l.option.float, l.option.skin.min_float, l.option.skin.max_float), 0) / SIZE;

    let hitChance = 0;
    const targets = [];
    for (const l of legs) {
      const info = cases.get(l.option.collection);
      if (!info) continue;
      for (const e of info.candidates) {
        const float = e.min_float + w * (e.max_float - e.min_float);
        const landed = e.vanilla ? null : wearForFloat(float);
        if (wear && landed !== wear) continue;
        const quote = lookup(marketName(e.market_base_name, landed || "FN", stattrak, { phase: e.phase, vanilla: e.vanilla }));
        const value = saleValue(quote, thinValuation);
        if (minValue !== null && !(value >= minValue)) continue;
        const chance = (l.count / SIZE) * (1 / info.finishCount) * phaseOdds(e, info.finishes.get(e.market_base_name));
        hitChance += chance;
        targets.push({ name: displayName(e, stattrak), phase: e.phase, wear: landed, value, chance });
      }
    }
    if (hitChance <= 0) return;

    const inputs = legsToInputs(legs);
    const outputsByCollection = Object.fromEntries(legs.map((l) => [l.option.collection, pools[l.option.collection]]));
    const analysis = analyze({ inputs, outputsByCollection, feeRate, fixedFee, thinValuation });
    results.push({ tier: KNIFE_TIER, stattrak, legs, analysis, hitChance, costPerHit: cost / hitChance, targets, lowLiquidity: isLowLiquidity(analysis, legs) });
  };

  for (let i = 0; i < groups.length; i++) {
    for (const a of groups[i][1]) consider([{ option: a, count: SIZE }]);
    for (let j = i + 1; j < groups.length; j++) {
      for (const a of groups[i][1]) for (const b of groups[j][1]) {
        for (let k = 1; k < SIZE; k++) consider([{ option: a, count: k }, { option: b, count: SIZE - k }]);
      }
    }
    onProgress((i + 1) / groups.length);
  }
  onProgress(1);
  return results
    .sort(huntComparator(opts.sortBy))
    .slice(0, limit);
}
