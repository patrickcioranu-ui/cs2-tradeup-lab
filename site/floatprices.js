// Float-aware input prices from real CSFloat listing samples (price + float per listing).
// A sample is the 50 cheapest and 50 lowest-float listings of one market name (skin + wear).

const MAX_SAMPLE_AGE_MS = 24 * 3600 * 1000;
const WEAR_BOUNDARIES = [0.07, 0.15, 0.38, 0.45];

// Listings [[price, float], ...] for a market name, or null when missing or older than 24 h.
export function freshSample(samples, name, now = Date.now()) {
  const entry = samples?.[name];
  if (!entry?.listings?.length || !(now - Date.parse(entry.fetched_at) <= MAX_SAMPLE_AGE_MS)) return null;
  return entry.listings;
}

// The k cheapest listings with a float below maxFloat (or at most, when inclusive), cheapest
// first. When fewer exist, the remaining copies are priced at the most expensive one found.
export function cheapestUnder(listings, maxFloat, k, inclusive = false) {
  const prices = listings
    .filter(([, f]) => (inclusive ? f <= maxFloat : f < maxFloat))
    .map(([p]) => p)
    .sort((a, b) => a - b);
  if (!prices.length) return { costs: [], available: 0, sorted: [] };
  const n = Number.isFinite(k) ? k : prices.length;
  const costs = Array.from({ length: n }, (_, i) => prices[Math.min(i, prices.length - 1)]);
  return { costs, available: prices.length, sorted: prices };
}

// Input float limits worth trying for one skin in one wear: every float where an output of
// its collection would change wear (for a contract of only this skin), inside the wear, plus
// the top of the wear ("any float in this wear"). Ascending.
export function floatLevels(skin, wear, outputs) {
  const top = Math.min(skin.max_float, wear.max);
  const bottom = Math.max(skin.min_float, wear.min);
  const levels = new Set([top]);
  const span = skin.max_float - skin.min_float;
  for (const out of outputs) {
    const outSpan = out.max_float - out.min_float;
    if (!(outSpan > 0) || !(span > 0)) continue;
    for (const b of WEAR_BOUNDARIES) {
      const w = (b - out.min_float) / outSpan;
      if (!(w > 0 && w < 1)) continue;
      const x = skin.min_float + w * span;
      if (x > bottom + 1e-9 && x < top - 1e-9) levels.add(Math.round(x * 1e6) / 1e6);
    }
  }
  return [...levels].sort((a, b) => a - b);
}
