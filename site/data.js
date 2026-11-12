// Loads the catalog and price files produced by scripts/update_data.py.

const STALE_AFTER_MS = 24 * 3600 * 1000;

export class DataLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "DataLoadError";
  }
}

async function getJson(fetchFn, url) {
  let response;
  try {
    response = await fetchFn(url);
  } catch (error) {
    throw new DataLoadError(`Could not reach ${url}: ${error.message}`);
  }
  if (!response.ok) throw new DataLoadError(`${url} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new DataLoadError(`${url} is not valid JSON`);
  }
}

export async function loadData(fetchFn = fetch, base = "data/") {
  const [catalog, prices] = await Promise.all([getJson(fetchFn, `${base}catalog.json`), getJson(fetchFn, `${base}prices.json`)]);
  const updatedAt = new Date(prices.updated_at);
  // Optional: real price ladders (only when the site has a CSFloat API key configured).
  let ladders = null;
  try {
    const found = (await getJson(fetchFn, `${base}ladders.json`)).ladders;
    ladders = found && Object.keys(found).length ? found : null;
  } catch {
    ladders = null;
  }
  return { catalog, prices, ladders, updatedAt, stale: !(Date.now() - updatedAt.getTime() < STALE_AFTER_MS) };
}

// The file names its price source (e.g. "csfloat"); default to the first one.
function defaultSource(prices) {
  return Object.keys(prices?.sources || {})[0];
}

export function priceLookup(prices, source = defaultSource(prices)) {
  const table = prices?.sources?.[source]?.prices || {};
  return (marketName) => table[marketName];
}

export function priceSource(prices) {
  const name = defaultSource(prices);
  return { name, feeRate: prices?.sources?.[name]?.fee_rate ?? null };
}
