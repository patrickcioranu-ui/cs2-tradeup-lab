import { test } from "node:test";
import assert from "node:assert/strict";
import { loadData, priceLookup, DataLoadError } from "../../site/data.js";

const catalog = { generated_at: "x", collections: {} };
const pricesAt = (updatedAt) => ({
  updated_at: updatedAt,
  currency: "EUR",
  sources: { steam: { fee_rate: 0.15, prices: { "StatTrak™ AK-47 | Redline (Field-Tested)": { price: 9.5, listings: null, sold_24h: true } } } },
});
const stubFetch = (files) => async (url) => {
  const name = url.split("/").pop();
  if (!(name in files)) return { ok: false, status: 404, json: async () => { throw new Error("no body"); } };
  return { ok: true, status: 200, json: async () => files[name] };
};
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

test("loadData returns catalog, prices and freshness", async () => {
  const data = await loadData(stubFetch({ "catalog.json": catalog, "prices.json": pricesAt(hoursAgo(1)) }));
  assert.deepEqual(data.catalog, catalog);
  assert.equal(data.stale, false);
  assert.ok(data.updatedAt instanceof Date);
});

test("loadData marks prices older than 24h as stale", async () => {
  const data = await loadData(stubFetch({ "catalog.json": catalog, "prices.json": pricesAt(hoursAgo(25)) }));
  assert.equal(data.stale, true);
});

test("loadData rejects with DataLoadError on 404", async () => {
  await assert.rejects(loadData(stubFetch({ "catalog.json": catalog })), DataLoadError);
});

test("priceLookup finds exact names and misses unknown ones", () => {
  const lookup = priceLookup(pricesAt(hoursAgo(1)));
  assert.equal(lookup("StatTrak™ AK-47 | Redline (Field-Tested)").price, 9.5);
  assert.equal(lookup("AK-47 | Redline (Field-Tested)"), undefined);
});
