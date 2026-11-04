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
  return { catalog, prices, updatedAt, stale: !(Date.now() - updatedAt.getTime() < STALE_AFTER_MS) };
}

export function priceLookup(prices, source = "steam") {
  const table = prices?.sources?.[source]?.prices || {};
  return (marketName) => table[marketName];
}
