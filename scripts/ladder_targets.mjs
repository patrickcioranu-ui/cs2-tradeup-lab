// Print (JSON) every input skin market name the finder can use, so the ladder refresh
// fetches exactly those. Reuses the site's own finder code. Usage: node scripts/ladder_targets.mjs
import { readFileSync } from "node:fs";
import { inputOptions } from "../site/finder.js";
import { marketName } from "../site/engine.js";

const catalog = JSON.parse(readFileSync(new URL("../site/data/catalog.json", import.meta.url), "utf8"));
const prices = JSON.parse(readFileSync(new URL("../site/data/prices.json", import.meta.url), "utf8"));
const table = Object.values(prices.sources)[0].prices;
const names = new Set();
for (const floatMode of ["worst", "middle", "best"]) {
  for (const tier of [0, 1, 2, 3, 4, 5]) {
    for (const st of [false, true]) {
      for (const options of inputOptions(catalog, (n) => table[n], tier, st, floatMode).values()) {
        for (const o of options) names.add(marketName(o.skin.market_base_name, o.wear, st));
      }
    }
  }
}
process.stdout.write(JSON.stringify([...names].sort()));
