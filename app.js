const sampleInputs = [
  ["Collection Alpha", 0.08, 1.20],
  ["Collection Alpha", 0.11, 1.20],
  ["Collection Alpha", 0.09, 1.20],
  ["Collection Alpha", 0.14, 1.20],
  ["Collection Alpha", 0.10, 1.20],
  ["Collection Alpha", 0.12, 1.20],
  ["Collection Beta", 0.07, 1.25],
  ["Collection Beta", 0.13, 1.25],
  ["Collection Beta", 0.16, 1.25],
  ["Collection Beta", 0.09, 1.25],
];

const sampleOutputs = {
  "Collection Alpha": [
    { name: "Alpha Output 1", min: 0.00, max: 0.50, steam: 34.00, instant: 27.50 },
    { name: "Alpha Output 2", min: 0.10, max: 0.70, steam: 8.00, instant: 6.40 },
  ],
  "Collection Beta": [
    { name: "Beta Output 1", min: 0.00, max: 0.40, steam: 14.00, instant: 11.20 },
  ],
};

const inputRows = document.querySelector("#inputRows");
const outputGroups = document.querySelector("#outputGroups");
const analyzeButton = document.querySelector("#analyzeButton");
const errorBox = document.querySelector("#errorBox");
const metrics = document.querySelector("#metrics");
const outcomeTable = document.querySelector("#outcomeTable");
const insightPanel = document.querySelector("#insightPanel");

const currency = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const percent = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 1 });
const number = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderInputs() {
  inputRows.innerHTML = sampleInputs.map(([collection, floatValue, cost], index) => `
    <div class="input-row" data-input-index="${index}">
      <span class="input-index">${String(index + 1).padStart(2, "0")}</span>
      <select data-field="collection" aria-label="Input ${index + 1} collection">
        <option ${collection === "Collection Alpha" ? "selected" : ""}>Collection Alpha</option>
        <option ${collection === "Collection Beta" ? "selected" : ""}>Collection Beta</option>
      </select>
      <input data-field="float" type="number" min="0" max="1" step="0.0001" value="${floatValue}" aria-label="Input ${index + 1} float" />
      <input data-field="cost" type="number" min="0" step="0.01" value="${cost.toFixed(2)}" aria-label="Input ${index + 1} cost" />
    </div>
  `).join("");
}

function renderOutputs() {
  outputGroups.innerHTML = Object.entries(sampleOutputs).map(([collection, outputs]) => `
    <div class="output-group" data-collection="${collection}">
      <div class="output-group-title"><span>${collection}</span><span>${outputs.length} outputs</span></div>
      <div class="output-head"><span>Name</span><span>Min</span><span>Max</span><span>Steam</span><span>Instant</span></div>
      ${outputs.map((output, index) => `
        <div class="output-row" data-output-index="${index}">
          <input class="field" data-field="name" value="${output.name}" aria-label="${collection} output ${index + 1} name" />
          <input class="field" data-field="min" type="number" min="0" max="1" step="0.0001" value="${output.min}" aria-label="${output.name} minimum float" />
          <input class="field" data-field="max" type="number" min="0" max="1" step="0.0001" value="${output.max}" aria-label="${output.name} maximum float" />
          <input class="field" data-field="steam" type="number" min="0" step="0.01" value="${output.steam.toFixed(2)}" aria-label="${output.name} Steam price" />
          <input class="field" data-field="instant" type="number" min="0" step="0.01" value="${output.instant.toFixed(2)}" aria-label="${output.name} instant price" />
        </div>
      `).join("")}
    </div>
  `).join("");
}

function readInputs() {
  return [...document.querySelectorAll(".input-row")].map((row) => ({
    collection: row.querySelector('[data-field="collection"]').value,
    floatValue: Number(row.querySelector('[data-field="float"]').value),
    cost: Number(row.querySelector('[data-field="cost"]').value),
  }));
}

function readOutputs() {
  const outputs = {};
  document.querySelectorAll(".output-group").forEach((group) => {
    const collection = group.dataset.collection;
    outputs[collection] = [...group.querySelectorAll(".output-row")].map((row) => ({
      name: row.querySelector('[data-field="name"]').value.trim() || "Unnamed output",
      min: Number(row.querySelector('[data-field="min"]').value),
      max: Number(row.querySelector('[data-field="max"]').value),
      steam: Number(row.querySelector('[data-field="steam"]').value),
      instant: Number(row.querySelector('[data-field="instant"]').value),
    }));
  });
  return outputs;
}

function readFees() {
  return {
    steamRate: Number(document.querySelector("#steamFee").value) / 100,
    instantRate: Number(document.querySelector("#instantFee").value) / 100,
    steamFixed: Number(document.querySelector("#steamFixedFee").value),
    instantFixed: Number(document.querySelector("#instantFixedFee").value),
  };
}

function netSalePrice(gross, rate, fixed) {
  return Math.max(0, gross * (1 - rate) - fixed);
}

function runAnalysis() {
  errorBox.hidden = true;
  const inputs = readInputs();
  const outputs = readOutputs();
  const fees = readFees();

  try {
    validate(inputs, outputs, fees);
    const outcomes = calculateOutcomes(inputs, outputs, fees);
    const inputCost = inputs.reduce((sum, item) => sum + item.cost, 0);
    const summary = summarise(outcomes, inputCost);
    renderResults(outcomes, summary, inputCost);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
}

function validate(inputs, outputs, fees) {
  if (inputs.length !== 10) throw new Error("A trade-up must contain exactly 10 inputs.");
  inputs.forEach((input, index) => {
    if (!Number.isFinite(input.floatValue) || input.floatValue < 0 || input.floatValue > 1) throw new Error(`Input ${index + 1} has an invalid float.`);
    if (!Number.isFinite(input.cost) || input.cost < 0) throw new Error(`Input ${index + 1} has an invalid cost.`);
  });
  Object.entries(outputs).forEach(([collection, collectionOutputs]) => {
    if (!collectionOutputs.length) throw new Error(`${collection} needs at least one eligible output.`);
    collectionOutputs.forEach((output) => {
      if (![output.min, output.max, output.steam, output.instant].every(Number.isFinite)) throw new Error(`${output.name} has an invalid number.`);
      if (output.min < 0 || output.max > 1 || output.min > output.max) throw new Error(`${output.name} has an invalid float range.`);
      if (output.steam < 0 || output.instant < 0) throw new Error(`${output.name} has an invalid price.`);
    });
  });
  if (![fees.steamRate, fees.instantRate].every((fee) => fee >= 0 && fee < 1)) throw new Error("Fee rates must be between 0% and 100%.");
  if (![fees.steamFixed, fees.instantFixed].every((fee) => Number.isFinite(fee) && fee >= 0)) throw new Error("Fixed fees must be non-negative.");
}

function calculateOutcomes(inputs, outputs, fees) {
  const averageFloat = inputs.reduce((sum, item) => sum + item.floatValue, 0) / inputs.length;
  const collections = [...new Set(inputs.map((item) => item.collection))];
  const outcomes = [];
  collections.forEach((collection) => {
    const eligible = outputs[collection] || [];
    const collectionProbability = inputs.filter((item) => item.collection === collection).length / 10;
    const outputProbability = collectionProbability / eligible.length;
    eligible.forEach((output) => {
      outcomes.push({
        ...output,
        probability: outputProbability,
        outputFloat: output.min + averageFloat * (output.max - output.min),
        steamNet: netSalePrice(output.steam, fees.steamRate, fees.steamFixed),
        instantNet: netSalePrice(output.instant, fees.instantRate, fees.instantFixed),
      });
    });
  });
  return outcomes;
}

function summarise(outcomes, inputCost) {
  const expected = (field) => outcomes.reduce((sum, outcome) => sum + outcome.probability * outcome[field], 0);
  const standardDeviation = (field, mean) => Math.sqrt(outcomes.reduce((sum, outcome) => sum + outcome.probability * (outcome[field] - mean) ** 2, 0));
  const steamExpected = expected("steamNet");
  const instantExpected = expected("instantNet");
  return {
    inputCost,
    steamExpected,
    instantExpected,
    steamProfit: steamExpected - inputCost,
    instantProfit: instantExpected - inputCost,
    steamProbability: outcomes.filter((outcome) => outcome.steamNet > inputCost).reduce((sum, outcome) => sum + outcome.probability, 0),
    instantProbability: outcomes.filter((outcome) => outcome.instantNet > inputCost).reduce((sum, outcome) => sum + outcome.probability, 0),
    steamRisk: standardDeviation("steamNet", steamExpected),
    instantRisk: standardDeviation("instantNet", instantExpected),
  };
}

function renderResults(outcomes, summary, inputCost) {
  const bestRoute = summary.steamProfit >= summary.instantProfit ? "Steam" : "Instant sell";
  const bestProfit = Math.max(summary.steamProfit, summary.instantProfit);
  metrics.innerHTML = [
    metric("Input cost", currency.format(inputCost), "10 items"),
    metric("Steam EV", currency.format(summary.steamExpected), `${summary.steamProfit >= 0 ? "+" : ""}${currency.format(summary.steamProfit)} expected` , summary.steamProfit >= 0),
    metric("Instant EV", currency.format(summary.instantExpected), `${summary.instantProfit >= 0 ? "+" : ""}${currency.format(summary.instantProfit)} expected`, summary.instantProfit >= 0),
    metric("P(profit)", `${percent.format(summary.steamProbability)}`, `Steam exit · instant ${percent.format(summary.instantProbability)}`),
    metric("Steam risk", currency.format(summary.steamRisk), `Net proceeds standard deviation`),
  ].join("");

  outcomeTable.innerHTML = outcomes.map((outcome) => `
    <tr>
      <td>${escapeHtml(outcome.name)}</td>
      <td class="probability">${percent.format(outcome.probability)}</td>
      <td>${outcome.outputFloat.toFixed(4)}</td>
      <td>${currency.format(outcome.steamNet)}</td>
      <td>${currency.format(outcome.instantNet)}</td>
    </tr>
  `).join("");

  const resultTone = bestProfit >= 0 ? "positive" : "negative";
  insightPanel.innerHTML = `
    <div>
      <div class="insight-title">MODEL READOUT</div>
      <div class="insight-main">${bestProfit >= 0 ? `${bestRoute} has the stronger expected exit.` : "No positive expected value after fees."}</div>
      <p class="insight-copy">This is an expected-value comparison, not a prediction. Check the underlying quotes, market spread, liquidity and trade restrictions before treating the result as actionable.</p>
    </div>
    <div class="insight-stat"><span>Best expected profit</span><strong class="${resultTone}">${bestProfit >= 0 ? "+" : ""}${currency.format(bestProfit)}</strong></div>
  `;
}

function metric(label, value, sub, positive = false) {
  return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value ${positive ? "positive" : ""}">${value}</div><div class="metric-sub">${sub}</div></div>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

renderInputs();
renderOutputs();
analyzeButton.addEventListener("click", runAnalysis);
runAnalysis();
