// Float scan: for one trade-up, which input floats change the outcome, and what each range is worth.
//
// Output float = out_min + W * (out_max - out_min), where W is the average of the inputs'
// normalised floats. An output only changes wear when its float crosses a wear boundary, so the
// W values where that happens split 0..1 into ranges with a fixed set of outcomes.
import { WEARS, analyze, normalizeFloat, wearForFloat } from "./engine.js";

const BOUNDARIES = WEARS.slice(1).map((w) => w.min); // 0.07, 0.15, 0.38, 0.45

function breakpoints(outputsByCollection) {
  const points = [];
  for (const outputs of Object.values(outputsByCollection)) {
    for (const out of outputs || []) {
      const span = out.maxFloat - out.minFloat;
      if (!(span > 0)) continue;
      for (const b of BOUNDARIES) {
        const w = (b - out.minFloat) / span;
        if (w > 1e-12 && w < 1 - 1e-12) points.push(w);
      }
    }
  }
  return [...new Set(points.map((w) => Math.round(w * 1e9) / 1e9))].sort((a, b) => a - b);
}

// priceFor(input, wearCode) -> cheapest listing for that input skin in that wear (or undefined).
// When given, an input whose wear changes in a row is priced at that wear's cheapest listing;
// inputs that stay in their current wear keep the cost-column price.
export function floatScan({ inputs, outputsByCollection, feeRate = 0, fixedFee = 0, thinValuation = "buy_order", priceFor = null }) {
  const used = Object.fromEntries([...new Set(inputs.map((i) => i.collection))].map((c) => [c, outputsByCollection[c] || []]));
  const edges = [0, ...breakpoints(used), 1];
  const currentW = inputs.reduce((s, i) => s + normalizeFloat(i.float, i.minFloat, i.maxFloat), 0) / inputs.length;

  // One float limit per distinct input skin.
  const skins = new Map();
  for (const i of inputs) skins.set(`${i.label}|${i.minFloat}|${i.maxFloat}`, i);

  const rows = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const minW = edges[k];
    const maxW = edges[k + 1];
    // Buy as cheaply as the range allows: just under its upper limit (outcomes are the same anywhere in it).
    const buyW = maxW - Math.min(1e-4, (maxW - minW) / 2);
    const last = k === edges.length - 2;
    const current = currentW >= minW - 1e-12 && (last ? currentW <= maxW + 1e-12 : currentW < maxW - 1e-12);
    const fallbacks = new Set();
    // Your own range shows exactly what you entered; other ranges are re-bought just under their limit.
    const scanned = current ? inputs.map((i) => ({ ...i })) : inputs.map((i) => {
      const float = i.minFloat + buyW * (i.maxFloat - i.minFloat);
      const wear = wearForFloat(float);
      if (!priceFor || wear === wearForFloat(i.float)) return { ...i, float };
      const listing = priceFor(i, wear);
      if (!Number.isFinite(listing)) {
        fallbacks.add(i.label);
        return { ...i, float };
      }
      return { ...i, float, cost: listing };
    });
    rows.push({
      minW,
      maxW,
      current,
      limits: [...skins.values()].map((i) => ({ label: i.label, maxFloat: i.minFloat + maxW * (i.maxFloat - i.minFloat) })),
      inputs: scanned,
      fallbacks: [...fallbacks],
      analysis: analyze({ inputs: scanned, outputsByCollection: used, feeRate, fixedFee, thinValuation }),
    });
  }
  return rows;
}
