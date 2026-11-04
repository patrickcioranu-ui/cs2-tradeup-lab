// Runs the trade-up search off the main thread.
import { findTradeUps } from "./finder.js";
import { priceLookup } from "./data.js";

self.onmessage = ({ data }) => {
  if (data.type !== "search") return;
  try {
    let last = 0;
    const results = findTradeUps(data.catalog, priceLookup(data.prices), data.opts, (value) => {
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
