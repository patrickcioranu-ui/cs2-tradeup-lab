// Float scan: for one trade-up, which input floats change the outcome, and what each range is worth.
//
// Output float = out_min + W * (out_max - out_min), where W is the average of the inputs'
// normalised floats. An output only changes wear when its float crosses a wear boundary, so the
// W values where that happens split 0..1 into ranges with a fixed set of outcomes.
import { WEARS, analyze, normalizeFloat } from "./engine.js";

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

export function floatScan({ inputs, outputsByCollection, feeRate = 0, fixedFee = 0, thinValuation = "buy_order" }) {
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
    const mid = (minW + maxW) / 2;
    const scanned = inputs.map((i) => ({ ...i, float: i.minFloat + mid * (i.maxFloat - i.minFloat) }));
    const last = k === edges.length - 2;
    rows.push({
      minW,
      maxW,
      current: currentW >= minW - 1e-12 && (last ? currentW <= maxW + 1e-12 : currentW < maxW - 1e-12),
      limits: [...skins.values()].map((i) => ({ label: i.label, maxFloat: i.minFloat + maxW * (i.maxFloat - i.minFloat) })),
      analysis: analyze({ inputs: scanned, outputsByCollection: used, feeRate, fixedFee, thinValuation }),
    });
  }
  return rows;
}
