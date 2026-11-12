// Skin Hunter: rank normal 10-input trade-ups by the chance of getting one chosen weapon skin.
import { analyze, normalizeFloat, wearForFloat } from "./engine.js";
import { huntComparator, inputOptions, isLowLiquidity, legsToInputs, outputPool, priceLegs } from "./finder.js";

const SIZE = 10;

function skinsAt(collection, tier, stattrak) {
  return (collection?.[String(tier)] || []).filter((s) => !stattrak || s.stattrak_available);
}

// Every weapon skin a trade-up can produce: Industrial..Covert with lower-tier skins in its collection.
export function huntableSkins(catalog) {
  const names = new Set();
  for (const collection of Object.values(catalog.collections)) {
    for (let tier = 1; tier <= 5; tier++) {
      if (!skinsAt(collection, tier - 1, false).length) continue;
      for (const skin of skinsAt(collection, tier, false)) names.add(skin.market_base_name);
    }
  }
  return [...names].sort();
}

function findTarget(catalog, name) {
  for (const [collectionName, collection] of Object.entries(catalog.collections)) {
    for (let tier = 1; tier <= 5; tier++) {
      const skin = skinsAt(collection, tier, false).find((s) => s.market_base_name === name);
      if (skin) return { collectionName, tier, skin };
    }
  }
  return null;
}

export function findSkinHunts(catalog, lookup, opts, onProgress = () => {}) {
  const {
    skin = "", wear = null, stattrak = false, maxBudget = null, limit = 50,
    feeRate = 0.02, fixedFee = 0, floatMode = "worst", thinValuation = "buy_order", ladders = null,
  } = opts;
  const target = skin ? findTarget(catalog, skin) : null;
  if (!target || (stattrak && !target.skin.stattrak_available)) return [];
  const inputTier = target.tier - 1;
  const pool = skinsAt(catalog.collections[target.collectionName], target.tier, stattrak);
  if (!pool.length) return [];

  const options = inputOptions(catalog, lookup, inputTier, stattrak, floatMode, ladders);
  const own = options.get(target.collectionName) || [];
  const fillers = [...options.entries()].filter(([name]) => name !== target.collectionName);
  const pools = Object.fromEntries([...options.keys()].map((name) => [name, outputPool(catalog, lookup, name, target.tier, stattrak)]));
  const displayName = `${stattrak ? "StatTrak™ " : ""}${target.skin.market_base_name}`;

  const results = [];
  const consider = (rawLegs) => {
    const legs = priceLegs(rawLegs);
    const cost = legs.reduce((s, l) => s + l.costs.reduce((a, c) => a + c, 0), 0);
    if (maxBudget !== null && cost > maxBudget + 1e-9) return;
    const w = legs.reduce((s, l) => s + l.count * normalizeFloat(l.option.float, l.option.skin.min_float, l.option.skin.max_float), 0) / SIZE;
    const float = target.skin.min_float + w * (target.skin.max_float - target.skin.min_float);
    const landed = wearForFloat(float);
    if (wear && landed !== wear) return;
    const ownCount = legs.filter((l) => l.option.collection === target.collectionName).reduce((s, l) => s + l.count, 0);
    const hitChance = (ownCount / SIZE) / pool.length;
    if (hitChance <= 0) return;

    const inputs = legsToInputs(legs);
    const outputsByCollection = Object.fromEntries(legs.map((l) => [l.option.collection, pools[l.option.collection]]));
    const analysis = analyze({ inputs, outputsByCollection, feeRate, fixedFee, thinValuation });
    const outcome = analysis.outcomes.find((o) => o.name === displayName && o.collection === target.collectionName);
    results.push({
      tier: inputTier, stattrak, legs, analysis, hitChance, costPerHit: cost / hitChance,
      targets: [{ name: displayName, phase: null, wear: landed, value: outcome?.gross ?? null, chance: hitChance }],
      lowLiquidity: isLowLiquidity(analysis, legs),
    });
  };

  for (const a of own) {
    consider([{ option: a, count: SIZE }]);
    for (const [, fillerOptions] of fillers) {
      for (const b of fillerOptions) {
        for (let k = 1; k < SIZE; k++) consider([{ option: a, count: k }, { option: b, count: SIZE - k }]);
      }
    }
  }
  onProgress(1);
  return results.sort(huntComparator(opts.sortBy)).slice(0, limit);
}
