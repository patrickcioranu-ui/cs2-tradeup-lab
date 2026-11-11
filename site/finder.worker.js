// Runs the Finder search, Knife Hunter and Skin Hunter off the main thread.
import { findTradeUps } from "./finder.js";
import { findHunts } from "./hunter.js";
import { findSkinHunts } from "./skinhunter.js";
import { priceLookup } from "./data.js";

self.onmessage = ({ data }) => {
  const search = { search: findTradeUps, hunt: findHunts, skinhunt: findSkinHunts }[data.type];
  if (!search) return;
  try {
    let last = 0;
    const results = search(data.catalog, priceLookup(data.prices), data.opts, (value) => {
      if (value - last >= 0.01 || value === 1) {
        last = value;
        self.postMessage({ type: "progress", value });
      }
    });
    self.postMessage({ type: "done", results });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
