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

export function buildDetails({ inputs, analysis, stattrak = false }) {
  const groups = new Map();
  for (const input of inputs) {
    const wear = wearForFloat(input.float);
    const key = `${input.label}|${wear}|${input.float}|${input.cost}`;
    if (!groups.has(key)) {
      const name = marketName(input.label, wear, stattrak);
      groups.set(key, { count: 0, label: input.label, collection: input.collection, marketName: name, wear, maxFloat: input.float, price: input.cost, url: csfloatUrl(name, +input.float.toFixed(4)) });
    }
    groups.get(key).count += 1;
  }
  const shopping = [...groups.values()].map((g) => ({ ...g, subtotal: Number.isFinite(g.price) ? g.price * g.count : null }));

  const cost = analysis.cost;
  const outcomes = analysis.outcomes
    .map((o) => {
      const name = outcomeMarketName(o.name, o.wear);
      return {
        name: o.name, marketName: name, collection: o.collection, probability: o.probability, float: o.float, wear: o.wear,
        value: o.gross, net: o.net, profit: o.net === null || cost === null ? null : o.net - cost, thin: o.thin, url: csfloatUrl(name),
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
