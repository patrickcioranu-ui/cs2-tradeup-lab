// Trade-up maths shared by the calculator and the finder.
// Mirrors cs2_tradeup/core.py. Output float uses CS2's weighted-float formula.

export const WEARS = [
  { code: "FN", name: "Factory New", min: 0, max: 0.07 },
  { code: "MW", name: "Minimal Wear", min: 0.07, max: 0.15 },
  { code: "FT", name: "Field-Tested", min: 0.15, max: 0.38 },
  { code: "WW", name: "Well-Worn", min: 0.38, max: 0.45 },
  { code: "BS", name: "Battle-Scarred", min: 0.45, max: 1 },
];

const WEAR_BY_CODE = Object.fromEntries(WEARS.map((w) => [w.code, w]));

export function wearForFloat(f) {
  for (const wear of WEARS) if (f < wear.max) return wear.code;
  return "BS";
}

export function normalizeFloat(f, min, max) {
  const span = max - min;
  return span === 0 ? 0 : (f - min) / span;
}

export function outputFloat(inputs, outMin, outMax) {
  const weighted = inputs.reduce((sum, i) => sum + normalizeFloat(i.float, i.minFloat, i.maxFloat), 0) / inputs.length;
  return outMin + weighted * (outMax - outMin);
}

export function netSale(gross, feeRate, fixedFee = 0) {
  return Math.max(0, gross * (1 - feeRate) - fixedFee);
}

export function marketName(baseName, wearCode, stattrak) {
  return `${stattrak ? "StatTrak™ " : ""}${baseName} (${WEAR_BY_CODE[wearCode].name})`;
}

export function analyze({ inputs, outputsByCollection, feeRate = 0, fixedFee = 0 }) {
  const cost = inputs.reduce((sum, i) => sum + i.cost, 0);
  const collections = [...new Set(inputs.map((i) => i.collection))];
  const outcomes = [];
  let complete = true;

  for (const collection of collections) {
    const eligible = outputsByCollection[collection] || [];
    if (!eligible.length) {
      complete = false;
      continue;
    }
    const share = inputs.filter((i) => i.collection === collection).length / inputs.length;
    for (const out of eligible) {
      const float = outputFloat(inputs, out.minFloat, out.maxFloat);
      const wear = wearForFloat(float);
      const quote = out.prices?.[wear];
      const gross = quote && Number.isFinite(quote.price) ? quote.price : null;
      if (gross === null) complete = false;
      outcomes.push({
        name: out.name,
        collection,
        probability: share / eligible.length,
        float,
        wear,
        gross,
        net: gross === null ? null : netSale(gross, feeRate, fixedFee),
        listings: quote ? quote.listings ?? null : null,
      });
    }
  }

  const minListings = outcomes.reduce((m, o) => Math.min(m, o.listings ?? 0), Infinity);
  const base = { complete, cost, outcomes, minListings: Number.isFinite(minListings) ? minListings : 0 };
  if (!complete) return { ...base, ev: null, profit: null, roi: null, pProfit: null, risk: null };

  const ev = outcomes.reduce((s, o) => s + o.probability * o.net, 0);
  const profit = ev - cost;
  const risk = Math.sqrt(outcomes.reduce((s, o) => s + o.probability * (o.net - ev) ** 2, 0));
  const pProfit = outcomes.filter((o) => o.net > cost).reduce((s, o) => s + o.probability, 0);
  return { ...base, ev, profit, roi: cost > 0 ? profit / cost : null, pProfit, risk };
}
