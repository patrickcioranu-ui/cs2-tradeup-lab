import { WEARS, analyze, marketName, wearForFloat } from "./engine.js";
import { loadData, priceLookup, priceSource } from "./data.js";
import { contractSize, hasOutputs, outputPool } from "./finder.js";

const TIER_NAMES = ["Consumer", "Industrial", "Mil-Spec", "Restricted", "Classified", "Covert", "Knife/Gloves"];
const WEAR_NAME = Object.fromEntries(WEARS.map((w) => [w.code, w.name]));
const currency = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const percent = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 1 });
const $ = (selector) => document.querySelector(selector);

let data = null; // { catalog, prices, lookup }
let worker = null;
let lastResults = [];
const calc = { tier: 2, stattrak: false, rows: [], overrides: {} };

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}

function fees() {
  const rate = Number($("#steamFee").value) / 100;
  const fixed = Number($("#fixedFee").value);
  return { feeRate: Number.isFinite(rate) && rate >= 0 && rate < 1 ? rate : 0.02, fixedFee: Number.isFinite(fixed) && fixed >= 0 ? fixed : 0 };
}

const signed = (value) => `${value >= 0 ? "+" : ""}${currency.format(value)}`;

// ---------- Finder ----------

function finderOptions() {
  const minChance = Number($("#minChance").value);
  const budgetRaw = $("#maxBudget").value.trim();
  const tier = $("#tierSelect").value;
  const optionalNumber = (id) => {
    const raw = $(id).value.trim();
    const value = Number(raw);
    return raw === "" || !Number.isFinite(value) ? null : value;
  };
  const minRoi = optionalNumber("#minRoi");
  const maxChance = optionalNumber("#maxChance");
  return {
    maxProfitChance: maxChance === null ? null : Math.min(Math.max(maxChance, 0), 100) / 100,
    minProfit: optionalNumber("#minProfit"),
    minRoi: minRoi === null ? null : minRoi / 100,
    minBestProfit: optionalNumber("#minBestProfit"),
    minJackpot: optionalNumber("#minJackpot"),
    hideLowLiquidity: $("#hideLowLiquidity").checked,
    collectionQuery: $("#collectionQuery").value,
    minProfitChance: Number.isFinite(minChance) ? Math.min(Math.max(minChance, 0), 100) / 100 : 0.5,
    maxBudget: budgetRaw === "" ? null : Number(budgetRaw),
    tiers: tier === "all" ? [0, 1, 2, 3, 4, 5] : [Number(tier)],
    floatMode: $("#floatMode").value,
    thinValuation: $("#thinValuation").value,
    stattrak: $("#stattrakSelect").value,
    sortBy: $("#sortSelect").value,
    limit: Number($("#limitSelect").value) || 50,
    ...fees(),
  };
}

function runFinder() {
  if (!data) return;
  if (worker) worker.terminate();
  $("#topPill").textContent = `Top ${Number($("#limitSelect").value) || 50}`;
  worker = new Worker(new URL("finder.worker.js", import.meta.url), { type: "module" });
  $("#progress").hidden = false;
  $("#progressBar").style.width = "0%";
  $("#finderMessage").hidden = true;
  let relaxed = false;
  worker.onmessage = ({ data: msg }) => {
    if (msg.type === "progress") $("#progressBar").style.width = `${Math.round(msg.value * 100)}%`;
    if (msg.type === "done") {
      // Nothing met the profit filters: search again without them and show the best anyway.
      const strict = opts.minProfitChance > 0 || opts.minProfit !== null || opts.minRoi !== null || opts.minBestProfit !== null || opts.minJackpot !== null || opts.hideLowLiquidity;
      if (!msg.results.length && !relaxed && strict) {
        relaxed = true;
        $("#progressBar").style.width = "0%";
        worker.postMessage({ type: "search", catalog: data.catalog, prices: data.prices, opts: { ...opts, minProfitChance: 0, minProfit: null, minRoi: null, minBestProfit: null, minJackpot: null, hideLowLiquidity: false } });
        return;
      }
      $("#progress").hidden = true;
      renderFinderResults(msg.results);
      if (relaxed && msg.results.length) {
        $("#finderMessage").textContent = "No trade-ups meet your profit chance, minimum profit, ROI, best-case or liquidity filters. Showing the best ones anyway; check the profit and chance columns.";
        $("#finderMessage").hidden = false;
      }
      worker.terminate();
      worker = null;
    }
    if (msg.type === "error") {
      $("#progress").hidden = true;
      showFinderMessage(`Search failed: ${msg.message}`);
    }
  };
  const opts = finderOptions();
  const floatLabel = { worst: "worst float in each wear (safe)", middle: "middle float of each wear", best: "best float in each wear (optimistic)" }[opts.floatMode];
  const thinLabel = opts.thinValuation === "listing" ? "listing when within 2× the buy order" : "best buy order (safe)";
  $("#finderMode").textContent = `Assumptions: inputs bought at the cheapest listing with the ${floatLabel}; thin-market outputs valued at the ${thinLabel}.`;
  $("#finderMode").hidden = false;
  worker.postMessage({ type: "search", catalog: data.catalog, prices: data.prices, opts });
}

// ---------- Knife Hunter ----------

let huntWorker = null;
let lastHunts = [];

function oneIn(chance) {
  const n = 1 / chance;
  return n < 10 ? `${percent.format(chance)}` : `${percent.format(chance)} · 1 in ${Math.round(n).toLocaleString("en-GB")}`;
}

function huntOptions() {
  const number = (id) => {
    const raw = $(id).value.trim();
    const value = Number(raw);
    return raw === "" || !Number.isFinite(value) ? null : value;
  };
  return {
    query: $("#huntQuery").value,
    phase: $("#huntPhase").value || null,
    minValue: number("#huntMinValue"),
    wear: $("#huntWear").value || null,
    stattrak: $("#huntStattrak").checked,
    maxBudget: number("#huntBudget"),
    limit: Number($("#huntLimit").value) || 50,
    floatMode: $("#floatMode").value,
    thinValuation: $("#thinValuation").value,
    ...fees(),
  };
}

function showHuntMessage(text) {
  $("#huntMessage").textContent = text;
  $("#huntMessage").hidden = false;
  $("#huntTableWrap").hidden = true;
}

function runHunt() {
  if (!data) return;
  const opts = huntOptions();
  if (!opts.query.trim() && !opts.phase && opts.minValue === null) {
    showHuntMessage("Choose a target: type a knife or gloves name, pick a phase, or set a minimum value.");
    return;
  }
  if (huntWorker) huntWorker.terminate();
  $("#hunterPill").textContent = `Top ${opts.limit}`;
  huntWorker = new Worker(new URL("finder.worker.js", import.meta.url), { type: "module" });
  $("#huntProgress").hidden = false;
  $("#huntProgressBar").style.width = "0%";
  $("#huntMessage").hidden = true;
  huntWorker.onmessage = ({ data: msg }) => {
    if (msg.type === "progress") $("#huntProgressBar").style.width = `${Math.round(msg.value * 100)}%`;
    if (msg.type === "done") {
      $("#huntProgress").hidden = true;
      renderHuntResults(msg.results);
      huntWorker.terminate();
      huntWorker = null;
    }
    if (msg.type === "error") {
      $("#huntProgress").hidden = true;
      showHuntMessage(`Hunt failed: ${msg.message}`);
    }
  };
  huntWorker.postMessage({ type: "hunt", catalog: data.catalog, prices: data.prices, opts });
}

function renderHuntResults(results) {
  lastHunts = results;
  if (!results.length) {
    showHuntMessage("No trade-up can reach that target — check the spelling, or loosen the phase, wear, value or budget.");
    return;
  }
  $("#huntTableWrap").hidden = false;
  $("#huntResults").innerHTML = results.map((r, i) => {
    const a = r.analysis;
    const lands = [...new Set(r.targets.map((t) => `${t.name}${t.phase ? ` (${t.phase})` : ""}${t.wear ? ` ${t.wear}` : ""}`))];
    const landsText = lands.slice(0, 3).join(", ") + (lands.length > 3 ? ` +${lands.length - 3} more` : "");
    return `
      <tr class="clickable" data-hunt="${i}" tabindex="0">
        <td>${i + 1}</td>
        <td class="legs">${escapeHtml(legsLabel(r))}</td>
        <td class="probability">${oneIn(r.hitChance)}</td>
        <td>${currency.format(a.cost)}</td>
        <td>${currency.format(r.costPerHit)}</td>
        <td>${a.ev === null ? "—" : currency.format(a.ev)}</td>
        <td class="${(a.profit ?? 0) >= 0 ? "positive" : "negative"}">${a.profit === null ? "—" : signed(a.profit)}</td>
        <td>${a.pProfit === null ? "—" : percent.format(a.pProfit)}</td>
        <td class="targets">${escapeHtml(landsText)}</td>
        <td>${r.lowLiquidity ? '<span class="badge" title="At least one output has no CSFloat buy order near its listing price">low liquidity</span>' : ""}</td>
      </tr>`;
  }).join("");
}

function onHuntActivate(event) {
  const row = event.target.closest("tr[data-hunt]");
  if (!row) return;
  if (event.type === "keydown" && event.key !== "Enter") return;
  loadIntoCalculator(lastHunts[Number(row.dataset.hunt)]);
}

function showTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  $("#finder").hidden = name !== "finder";
  $("#hunter").hidden = name !== "hunter";
}

function showFinderMessage(text) {
  $("#finderMessage").textContent = text;
  $("#finderMessage").hidden = false;
  $("#finderTableWrap").hidden = true;
}

function legsLabel(result) {
  const st = result.stattrak ? "StatTrak™ " : "";
  return result.legs.map((l) => `${l.count}× ${st}${l.option.skin.market_base_name} (${l.option.wear})`).join(" + ");
}

function renderFinderResults(results) {
  lastResults = results;
  if (!results.length) {
    showFinderMessage("No trade-ups match — try lowering the profit chance, minimum profit or ROI, or raising the budget");
    return;
  }
  $("#finderTableWrap").hidden = false;
  $("#finderResults").innerHTML = results.map((r, i) => {
    const a = r.analysis;
    return `
      <tr class="clickable" data-result="${i}" tabindex="0">
        <td>${i + 1}</td>
        <td class="legs">${escapeHtml(legsLabel(r))}</td>
        <td>${TIER_NAMES[r.tier]} → ${TIER_NAMES[r.tier + 1]}</td>
        <td>${currency.format(a.cost)}</td>
        <td>${currency.format(a.ev)}</td>
        <td class="${a.profit >= 0 ? "positive" : "negative"}">${signed(a.profit)}</td>
        <td>${a.roi === null ? "—" : percent.format(a.roi)}</td>
        <td class="probability">${percent.format(a.pProfit)}</td>
        <td class="${a.bestProfit >= 0 ? "positive" : "negative"}" title="${a.jackpotMultiple === null ? "" : `${a.jackpotMultiple.toFixed(1)}× your inputs`}">${signed(a.bestProfit)} (${percent.format(a.bestChance)})</td>
        <td>${r.lowLiquidity ? '<span class="badge" title="At least one output has no CSFloat buy order near its listing price">low liquidity</span>' : ""}</td>
      </tr>`;
  }).join("");
}

function onResultActivate(event) {
  const row = event.target.closest("tr[data-result]");
  if (!row) return;
  if (event.type === "keydown" && event.key !== "Enter") return;
  loadIntoCalculator(lastResults[Number(row.dataset.result)]);
}

// ---------- Calculator ----------

function skinsAt(collectionName, tier, stattrak) {
  const collection = data.catalog.collections[collectionName] || {};
  return (collection[String(tier)] || []).filter((s) => !stattrak || s.stattrak_available);
}

function eligibleCollections() {
  return Object.keys(data.catalog.collections).filter(
    (name) => skinsAt(name, calc.tier, calc.stattrak).length && hasOutputs(data.catalog, name, calc.tier, calc.stattrak),
  );
}

function findSkin(row) {
  return skinsAt(row.collection, calc.tier, calc.stattrak).find((s) => s.id === row.skinId);
}

function quotePrice(skin, float) {
  return data.lookup(marketName(skin.market_base_name, wearForFloat(float), calc.stattrak))?.price;
}

function clampFloat(skin, float) {
  const f = Number.isFinite(float) ? float : (skin.min_float + skin.max_float) / 2;
  return Math.min(Math.max(f, skin.min_float), skin.max_float);
}

function resetRow(row, collection) {
  const skin = skinsAt(collection, calc.tier, calc.stattrak)[0];
  row.collection = collection;
  row.skinId = skin.id;
  row.float = clampFloat(skin, row.float);
  row.cost = quotePrice(skin, row.float) ?? null;
}

function resetCalculator() {
  const collections = eligibleCollections();
  calc.overrides = {};
  calc.rows = Array.from({ length: contractSize(calc.tier) }, () => {
    const row = { float: 0.2 };
    if (collections.length) resetRow(row, collections[0]);
    return row;
  });
}

function loadIntoCalculator(result) {
  calc.tier = result.tier;
  calc.stattrak = result.stattrak;
  calc.overrides = {};
  calc.rows = result.legs.flatMap((l) =>
    Array.from({ length: l.count }, () => ({ collection: l.option.collection, skinId: l.option.skin.id, float: l.option.float, cost: l.option.price })),
  );
  $("#calcTier").value = String(calc.tier);
  $("#calcStattrak").checked = calc.stattrak;
  renderCalculator();
  $("#calculator").scrollIntoView({ behavior: "smooth" });
}

function renderInputs() {
  const collections = eligibleCollections();
  if (!collections.length) {
    $("#inputRows").innerHTML = '<p class="panel-description">No collections have skins for this tier/StatTrak combination.</p>';
    return;
  }
  $("#inputRows").innerHTML = calc.rows.map((row, index) => {
    const skins = skinsAt(row.collection, calc.tier, calc.stattrak);
    const skin = findSkin(row);
    return `
      <div class="input-row calc-row" data-row="${index}">
        <span class="input-index">${String(index + 1).padStart(2, "0")}</span>
        <select data-field="collection" aria-label="Input ${index + 1} collection">
          ${collections.map((c) => `<option ${c === row.collection ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
        </select>
        <select data-field="skin" aria-label="Input ${index + 1} skin">
          ${skins.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === row.skinId ? "selected" : ""}>${escapeHtml(s.market_base_name)}</option>`).join("")}
        </select>
        <input data-field="float" type="number" min="${skin.min_float}" max="${skin.max_float}" step="0.0001" value="${row.float.toFixed(4)}" aria-label="Input ${index + 1} float" title="${WEAR_NAME[wearForFloat(row.float)]} · range ${skin.min_float}–${skin.max_float}" />
        <input data-field="cost" type="number" min="0" step="0.01" value="${row.cost === null ? "" : row.cost.toFixed(2)}" placeholder="missing" aria-label="Input ${index + 1} cost" />
      </div>`;
  }).join("");
}

function outputsByCollection() {
  const result = {};
  for (const collection of new Set(calc.rows.map((r) => r.collection))) {
    // Same pool and prices as the finder, plus any values typed over them.
    result[collection] = outputPool(data.catalog, data.lookup, collection, calc.tier + 1, calc.stattrak).map((out) => {
      const prices = { ...out.prices };
      for (const w of WEARS) {
        const override = calc.overrides[`${out.name}|${w.code}`];
        if (override !== undefined) prices[w.code] = { ...(prices[w.code] || {}), price: override, thin: false };
      }
      return { ...out, prices };
    });
  }
  return result;
}

function calcInputs() {
  return calc.rows.map((row) => {
    const skin = findSkin(row);
    return { collection: row.collection, float: row.float, minFloat: skin.min_float, maxFloat: skin.max_float, cost: row.cost };
  });
}

function renderOutputs(analysis) {
  const byCollection = {};
  for (const o of analysis.outcomes) (byCollection[o.collection] ||= []).push(o);
  $("#outputGroups").innerHTML = Object.entries(byCollection).map(([collection, outcomes]) => `
    <div class="output-group">
      <div class="output-group-title"><span>${escapeHtml(collection)}</span><span>${outcomes.length} outputs</span></div>
      <div class="output-head calc-output"><span>Name</span><span>Float</span><span>Wear</span><span>Price €</span></div>
      ${outcomes.map((o) => `
        <div class="output-row calc-output">
          <span class="output-name" title="${escapeHtml(o.name)}">${escapeHtml(o.name)}</span>
          <span>${o.float.toFixed(4)}</span>
          <span>${o.wear}</span>
          <input class="field" data-override="${escapeHtml(`${o.name}|${o.wear}`)}" type="number" min="0" step="0.01" value="${o.gross === null ? "" : o.gross.toFixed(2)}" placeholder="missing" aria-label="${escapeHtml(o.name)} price" />
        </div>`).join("")}
    </div>`).join("");
}

function metric(label, value, sub, positive = false) {
  return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value ${positive ? "positive" : ""}">${value}</div><div class="metric-sub">${sub}</div></div>`;
}

function renderAnalysis(analysis) {
  const missing = analysis.outcomes.filter((o) => o.gross === null).map((o) => `Missing price for ${o.name} (${WEAR_NAME[o.wear]}) — enter it manually`);
  if (analysis.missingInputs) missing.unshift(`${analysis.missingInputs} input${analysis.missingInputs > 1 ? "s have" : " has"} no listing price — enter the cost manually`);
  if (missing.length) {
    $("#errorBox").textContent = missing.join(". ");
    $("#errorBox").hidden = false;
    $("#metrics").innerHTML = "";
    $("#outcomeTable").innerHTML = "";
    $("#insightPanel").innerHTML = "";
    return;
  }
  $("#errorBox").hidden = true;
  const a = analysis;
  $("#metrics").innerHTML = [
    metric("Input cost", currency.format(a.cost), `${calc.rows.length} items`),
    metric("Expected value", currency.format(a.ev), "after sale fees"),
    metric("Expected profit", signed(a.profit), a.roi === null ? "" : `ROI ${percent.format(a.roi)}`, a.profit >= 0),
    metric("P(profit)", percent.format(a.pProfit), "chance an outcome beats the cost"),
    metric("Risk", currency.format(a.risk), "Net proceeds standard deviation"),
  ].join("");
  $("#outcomeTable").innerHTML = a.outcomes.map((o) => `
    <tr>
      <td>${escapeHtml(o.name)}${o.thin || o.sold24h === false ? ' <span class="badge" title="No buy order near the listing price">thin market</span>' : ""}</td>
      <td class="probability">${percent.format(o.probability)}</td>
      <td>${o.float.toFixed(4)}</td>
      <td>${WEAR_NAME[o.wear]}</td>
      <td>${currency.format(o.gross)}</td>
      <td>${currency.format(o.net)}</td>
    </tr>`).join("");
  const tone = a.profit >= 0 ? "positive" : "negative";
  $("#insightPanel").innerHTML = `
    <div>
      <div class="insight-title">MODEL READOUT</div>
      <div class="insight-main">${a.profit >= 0 ? "Positive expected value after fees." : "No positive expected value after fees."}</div>
      <p class="insight-copy">This is an expected-value comparison, not a prediction. Check the underlying listings, float availability, liquidity and trade restrictions before acting.</p>
    </div>
    <div class="insight-stat"><span>Expected profit</span><strong class="${tone}">${signed(a.profit)}</strong></div>`;
}

function renderCalculator() {
  if (!data) return;
  if (!calc.rows.length || !calc.rows.every((r) => findSkin(r))) resetCalculator();
  renderInputs();
  if (!eligibleCollections().length) return;
  $("#calcCount").textContent = `${contractSize(calc.tier)} required`;
  const analysis = analyze({ inputs: calcInputs(), outputsByCollection: outputsByCollection(), ...fees(), thinValuation: $("#thinValuation").value });
  renderOutputs(analysis);
  renderAnalysis(analysis);
}

function onInputChange(event) {
  const el = event.target;
  const rowEl = el.closest("[data-row]");
  if (!rowEl) return;
  const row = calc.rows[Number(rowEl.dataset.row)];
  const field = el.dataset.field;
  if (field === "collection") resetRow(row, el.value);
  if (field === "skin" || field === "float") {
    if (field === "skin") row.skinId = el.value;
    const skin = findSkin(row);
    row.float = clampFloat(skin, field === "float" ? Number(el.value) : row.float);
    row.cost = quotePrice(skin, row.float) ?? null;
  }
  if (field === "cost") {
    const cost = Number(el.value);
    row.cost = el.value.trim() === "" ? null : Number.isFinite(cost) && cost >= 0 ? cost : row.cost;
  }
  renderCalculator();
}

function onOverrideChange(event) {
  const key = event.target.dataset.override;
  if (!key) return;
  const value = Number(event.target.value);
  if (event.target.value === "" || !Number.isFinite(value) || value < 0) delete calc.overrides[key];
  else calc.overrides[key] = value;
  renderCalculator();
}

// ---------- Boot ----------

async function boot() {
  $("#findButton").addEventListener("click", runFinder);
  $("#huntButton").addEventListener("click", runHunt);
  $("#huntQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") runHunt(); });
  $("#huntResults").addEventListener("click", onHuntActivate);
  $("#huntResults").addEventListener("keydown", onHuntActivate);
  for (const tab of document.querySelectorAll(".tab")) tab.addEventListener("click", () => showTab(tab.dataset.tab));
  $("#collectionQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") runFinder(); });
  $("#finderResults").addEventListener("click", onResultActivate);
  $("#finderResults").addEventListener("keydown", onResultActivate);
  $("#inputRows").addEventListener("change", onInputChange);
  $("#outputGroups").addEventListener("change", onOverrideChange);
  $("#calcTier").addEventListener("change", (e) => { calc.tier = Number(e.target.value); calc.rows = []; renderCalculator(); });
  $("#calcStattrak").addEventListener("change", (e) => { calc.stattrak = e.target.checked; calc.rows = []; renderCalculator(); });
  for (const id of ["#steamFee", "#fixedFee", "#thinValuation"]) $(id).addEventListener("change", renderCalculator);

  try {
    const loaded = await loadData();
    data = { ...loaded, lookup: priceLookup(loaded.prices) };
  } catch (error) {
    $("#dataError").hidden = false;
    $("#priceStamp").textContent = "Prices unavailable";
    $("#statusDot").classList.add("offline");
    console.error(error);
    return;
  }
  $("#priceStamp").textContent = `Prices as of ${data.updatedAt.toLocaleString()}`;
  $("#staleNote").hidden = !data.stale;
  const { feeRate } = priceSource(data.prices);
  if (Number.isFinite(feeRate)) $("#steamFee").value = String(+(feeRate * 100).toFixed(2));
  $("#findButton").disabled = false;
  $("#huntButton").disabled = false;
  const knifeNames = [...new Set(Object.values(data.catalog.special_pools || {}).flat().map((e) => e.market_base_name.replace(/^★ /, "")))].sort();
  $("#huntNames").innerHTML = knifeNames.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
  renderCalculator();
}

boot();
