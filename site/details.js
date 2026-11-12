// Data for the "Trade-up details" popup: shopping list, every outcome, links and a copyable summary.
import { WEARS, marketName, wearForFloat } from "./engine.js";

const WEAR_NAME = Object.fromEntries(WEARS.map((w) => [w.code, w.name]));
const eur = (value) => `€${value.toFixed(2)}`;

// CSFloat market search for one item, cheapest first, optionally capped at a float.
export function csfloatUrl(marketHashName, maxFloat = null) {
  const url = new URL("https://csfloat.com/search");
  url.searchParams.set("market_hash_name", marketHashName);
  if (maxFloat !== null) url.searchParams.set("max_float", String(maxFloat));
  url.searchParams.set("sort_by", "lowest_price");
  return url.toString();
}

// Vanilla knives ("★ Karambit") have no wear in their market name.
function outcomeMarketName(name, wear) {
  return name.startsWith("★") && !name.includes(" | ") ? name : `${name} (${WEAR_NAME[wear]})`;
}

// `priced` maps an input's market name to how its copies were priced: "ladder" / "ladder-short"
// (each copy at the next-cheapest real listing) or "estimated" (every copy at the cheapest listing).
export function buildDetails({ inputs, analysis, stattrak = false, priced = {} }) {
  const groups = new Map();
  for (const input of inputs) {
    const wear = wearForFloat(input.float);
    const key = `${input.label}|${wear}|${input.float}`;
    if (!groups.has(key)) {
      const name = marketName(input.label, wear, stattrak);
      groups.set(key, { count: 0, costs: [], label: input.label, collection: input.collection, marketName: name, wear, maxFloat: input.float, priced: priced[name] || "estimated", url: csfloatUrl(name, +input.float.toFixed(4)) });
    }
    const g = groups.get(key);
    g.count += 1;
    g.costs.push(input.cost);
  }
  const shopping = [...groups.values()].map((g) => {
    const known = g.costs.every((c) => Number.isFinite(c));
    const subtotal = known ? g.costs.reduce((a, c) => a + c, 0) : null;
    return { ...g, subtotal, price: known ? subtotal / g.count : null, minPrice: known ? Math.min(...g.costs) : null, maxPrice: known ? Math.max(...g.costs) : null };
  });

  const cost = analysis.cost;
  const outcomes = analysis.outcomes
    .map((o) => {
      const name = outcomeMarketName(o.name, o.wear);
      return {
        name: o.name, marketName: name, collection: o.collection, probability: o.probability, float: o.float, wear: o.wear,
        value: o.gross, net: o.net, profit: o.net === null || cost === null ? null : o.net - cost, thin: o.thin, listings: o.listings, url: csfloatUrl(name),
      };
    })
    .sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity));
  if (outcomes.length) {
    outcomes[0].best = true;
    outcomes[outcomes.length - 1].worst = outcomes.length > 1;
  }
  return { shopping, outcomes, analysis, stattrak };
}

export function detailsText(details) {
  const a = details.analysis;
  const pct = (p) => `${(p * 100).toFixed(1)}%`;
  const lines = [
    "CS2 trade-up (TradeUp Lab)",
    `Cost: ${eur(a.cost ?? 0)} | EV: ${a.ev === null ? "n/a" : eur(a.ev)} | Profit: ${a.profit === null ? "n/a" : eur(a.profit)} | Chance of profit: ${a.pProfit === null ? "n/a" : pct(a.pProfit)}`,
    "",
    "Buy:",
    ...details.shopping.map((s) => `- ${s.count}× ${s.marketName}, float ≤ ${s.maxFloat.toFixed(4)}, ${Number.isFinite(s.price) ? eur(s.price) : "price?"} each`),
    "",
    "Possible outcomes:",
    ...details.outcomes.map((o) => `- ${pct(o.probability)} ${o.marketName} (float ${o.float.toFixed(4)}) → ${o.net === null ? "no price" : `${eur(o.net)} after fees`}`),
  ];
  return lines.join("\n");
}

// Re-cost the trade-up at the cheapest current listing for each input's wear (any float in that wear).
// Outcomes are unchanged, so EV stays the same; cost, profit, ROI, chance and best case move.
// `cheapest(marketName)` returns a price or undefined; unlisted items keep the price used.
export function atCheapestListings(details, cheapest) {
  const a = details.analysis;
  const missing = [];
  const unitPrices = details.shopping.map((s) => {
    if (s.priced?.startsWith("ladder")) return s.price; // already priced at the real listings, copy by copy
    const price = cheapest(s.marketName);
    if (!Number.isFinite(price)) {
      missing.push(s.marketName);
      return s.price;
    }
    return price;
  });
  const cost = details.shopping.reduce((sum, s, i) => sum + s.count * unitPrices[i], 0);
  const nets = a.outcomes.map((o) => o.net);
  const complete = a.ev !== null && nets.every((n) => n !== null);
  const bestNet = complete ? Math.max(...nets) : null;
  return {
    unitPrices,
    missing,
    cost,
    costDelta: a.cost === null ? null : cost - a.cost,
    changed: a.cost === null || Math.abs(cost - a.cost) > 0.005,
    ev: a.ev,
    profit: complete ? a.ev - cost : null,
    roi: complete && cost > 0 ? (a.ev - cost) / cost : null,
    pProfit: complete ? a.outcomes.filter((o) => o.net > cost).reduce((s, o) => s + o.probability, 0) : null,
    bestProfit: complete ? bestNet - cost : null,
    jackpotMultiple: complete && cost > 0 ? bestNet / cost : null,
  };
}
