# TradeUp Lab — Automatic Trade-Up Finder with Live Steam Prices

Date: 2026-11-04
Status: Draft for review

## 1. Goal

Turn TradeUp Lab from a manual calculator with made-up items into a tool that
**automatically finds profitable CS2 trade-ups** using real skins and real
Steam Community Market prices.

The user sets targets (minimum profit chance, max budget, rarity tier,
StatTrak mode, sort order) and the site lists the best trade-ups that meet them.

### What the user said
- Prices must come automatically from the Steam Market.
- They want to enter a profit chance and get the most profitable trade-ups for it.
- Controls: max budget, rarity tier, StatTrak toggle, sort choice.
- Steam fees only for now; third-party instant-sell sites (e.g. tradeit.gg) later.
- Currency: EUR.

### Assumptions (confirmed implicitly by approving the design)
- Hosting stays free on GitHub Pages; no paid server.
- Prices are refreshed every 6 hours, not live to the second.
- The existing manual calculator stays and is used to inspect a found trade-up.
- Search covers single-collection and two-collection trade-ups only.

### Success criteria
1. Opening the site shows real collections and skins, with a visible
   "Prices as of <time>" stamp no older than ~12 h under normal operation.
2. Setting "min profit chance = 60%, sort by expected profit" returns a ranked
   list of trade-ups meeting that threshold in under ~15 s on a normal laptop.
3. Clicking a result loads it into the calculator, and the calculator's EV and
   profit chance match the finder's numbers exactly.
4. If Steam blocks a refresh, the site keeps working with the last good prices.

### Non-goals (this spec)
- Third-party instant-sell prices (designed for, not built).
- Trade-ups mixing 3+ collections.
- Knife/glove trade-ups (5 Covert inputs → knife/glove, added by Valve on
  2025-10-22) and souvenir inputs (added 2026-05-22).
- Buying/selling automation, accounts, or price alerts.

## 2. Architecture

```
GitHub Action (every 6 h + manual)
  scripts/update_data.py
    ├─ skin catalog  ──► site/data/catalog.json
    └─ Steam prices  ──► site/data/prices.json
          (commit only if changed)
                 │
GitHub Pages (static) — browser
  data.js         loads catalog + prices
  engine.js       trade-up maths (shared)
  finder.worker.js  search in a Web Worker
  app.js          page UI: Finder + Calculator
```

All network access to Steam happens in the Action, never in the browser
(avoids CORS and rate-limit problems for visitors).

## 3. Data pipeline

### 3.1 Workflow — `.github/workflows/pages.yml`

> **Amended 2026-11-04 after final review:** committing ~4 MB of data every 6 h
> would bloat the repo, so data is no longer committed.

- Triggers: push to `main`, `schedule` cron `0 */6 * * *`, and `workflow_dispatch`.
- Runs `python scripts/update_data.py` to build `site/data/*.json` (git-ignored),
  then uploads `site/` as the Pages artifact and deploys it.
- If the data build fails, the deploy is skipped and the last live site stays up.

### 3.2 Skin catalog — `site/data/catalog.json`
- Source: ByMykel CSGO-API public JSON (`skins.json`, English).
- Kept fields per skin: `id`, `market_base_name` (e.g. `AK-47 | Redline`),
  `collection`, `rarity` (tier index 0–5: Consumer, Industrial, Mil-Spec,
  Restricted, Classified, Covert), `min_float`, `max_float`,
  `stattrak_available`, `souvenir`.
- Excluded: knives, gloves, souvenir-only skins, skins with no collection, and
  skins whose collection can't be traded up (no trade-up eligibility).
- Structure: `{ generated_at, collections: { <name>: { <tier>: [skin, ...] } } }`.

### 3.3 Prices — `site/data/prices.json`

> **Amended 2026-11-04 during implementation (user decision):** Steam's search
> endpoint ignores `currency` (always USD), serves only 10 results per page and
> answers HTTP 429 for minutes after ~18 anonymous pages, so a full crawl every
> 6 h is not workable. Prices now come from the public
> `https://prices.csgotrader.app/latest/steam.json` dump (Steam Market median
> sale prices; `last_24h`, falling back to 7/30/90-day), converted USD→EUR with
> the ECB rate. Entries carry `listings: null` and `sold_24h`; the low-liquidity
> badge means "an output had no Steam sales in the last 24 h". The direct Steam
> crawl below is kept in code (tested) for a possible future hybrid.
- Source: `https://steamcommunity.com/market/search/render/?appid=730&norender=1&count=100&start=N`
  paged until all results are read; ~3 s pause between pages; exponential
  back-off on HTTP 429 (max 5 retries per page).
- Currency: request EUR (`currency=3`). **Verify first** that this endpoint honours
  the currency parameter. If it returns USD regardless, convert using the ECB
  daily EUR/USD reference rate and record `fx_rate` in the file.
- Structure:
  ```json
  {
    "updated_at": "2026-11-04T12:00:00Z",
    "currency": "EUR",
    "sources": {
      "steam": {
        "fee_rate": 0.15,
        "prices": { "AK-47 | Redline (Field-Tested)": { "price": 12.34, "listings": 812, "seen_at": "..." } }
      }
    }
  }
  ```
- `sources` is keyed by exit route so `tradeit` etc. can be added later with
  their own fee model, without changing the finder.
- Partial runs: if a run is blocked partway, merge new prices into the previous
  file; each item keeps its own `seen_at`. Items not seen for 72 h are dropped.

## 4. Trade-up model (engine.js)

### 4.1 Probabilities
Unchanged from today: P(collection) = inputs from that collection / 10;
outputs within a collection's next tier are equally likely.

### 4.2 Output float
Use the current CS2 "weighted float" formula (in effect since the October 2024
update), which normalises each input's float by its own skin range:

```
norm_i      = (float_i − min_i) / (max_i − min_i)
avg_norm    = mean(norm_i)          # "weighted float" W, 0..1
out_float   = out_min + avg_norm × (out_max − out_min)
```

Each possible output gets its own float from the same W. When every input has a
0–1 range, W equals the plain average (the old formula), so the existing Python
test example still holds.

Verified 2026-11-04 against SteamDB's trade-up guide (Jul 2026) and CSDelta's
weighted-float article (Jul 2026), which agree, e.g. 10× M249 | Spectrogram
(range 0–0.50) at 0.15 → W = 0.30 → AK-47 | Crossfade (0–0.50) at 0.15. Valve
never documented this in patch notes. This example becomes a unit test. The
formula lives in one function so it can be swapped if Valve changes it again.

The current `core.py` and `app.js` use the old raw-average formula and are
**wrong for capped-range inputs**. This spec fixes both.

### 4.3 Wear buckets
FN [0, 0.07), MW [0.07, 0.15), FT [0.15, 0.38), WW [0.38, 0.45), BS [0.45, 1].
A skin's available buckets are those overlapping its `[min_float, max_float]`.

### 4.4 Input cost assumption (conservative)
For an input bought in bucket W, price = Steam lowest listing for that skin+wear,
and float = the **worst** (highest) float in W ∩ the skin's range. This never
overstates the result.

### 4.5 Exits
Net sale = gross × (1 − fee_rate) − fixed_fee, per exit route in `sources`.
This release: Steam only (15%). EV, profit, ROI and P(profit) are computed for the
selected exit.

## 5. Finder

### 5.1 Search space
For each selected tier T (T → T+1, T ≤ Classified) and StatTrak mode:
- For each collection C with skins at T and T+1, and each wear bucket W:
  the **cheapest** priced skin at tier T in C with bucket W → candidate input
  `(C, W, skin, price, worst_float)`.
- Prune dominated inputs per collection: drop (C, W) if another (C, W') is both
  cheaper and has a lower or equal normalised float.
- Candidates:
  - Single: 10 × one candidate input.
  - Pairs: k × input A + (10 − k) × input B, k = 1..9, A and B from different
    collections.
- Skip any candidate where an input or any possible output (at its computed
  wear) has no price or zero listings.

### 5.2 Metrics per candidate
`cost`, `ev` (expected net), `profit = ev − cost`, `roi = profit / cost`,
`p_profit` = sum of probabilities of outcomes whose net > cost,
`min_listings` across outputs (liquidity).

### 5.3 Filters and sort (UI controls)
- Minimum profit chance (%) — required, default 50.
- Max budget (€) — optional.
- Rarity tier — "all" or one tier step.
- StatTrak — Normal / StatTrak / Both.
- Sort — Expected profit (€) / ROI (%) / Profit chance.
Result: top 50, each row showing inputs summary, cost, EV, profit, ROI,
profit chance, and a "low liquidity" badge if `min_listings < 10`.

### 5.4 Execution
Runs in `finder.worker.js` (Web Worker). Posts progress (0–100%) and final
results. A new search cancels any running one. Target: < 15 s full search.

### 5.5 Calculator hand-off
Clicking a result fills the existing calculator with the 10 inputs (real skins,
assumed floats, prices) and the auto-generated outputs. Calculator uses the same
`engine.js`, so numbers match exactly.

## 6. Site changes

- `site/index.html`: new "Finder" section at the top (controls, progress bar,
  results table); calculator section keeps its place below. Price timestamp in
  the top bar. Remove "Collection Alpha/Beta" sample data.
- Calculator inputs become: collection → skin → float; cost auto-filled
  (editable). Outputs auto-generated from catalog, prices auto-filled (editable).
- The "Instant" column/fee is replaced by the exit-route list (Steam only today).
- `site/app.js` split into `data.js`, `engine.js`, `finder.worker.js`, `app.js`.

## 7. Repo cleanup

- Move `pages.yml` to `.github/workflows/pages.yml` (it currently never runs).
- Remove root duplicates (`app.js`, `index.html`, `styles.css`, `core.py`,
  `__init__.py`, `test_core.py`, `example_tradeup.json`, stray `download`) so
  `site/`, `cs2_tradeup/`, `tests/`, `data/` are the single sources.
- Update README: new features, data refresh, assumptions, how to trigger a refresh.

## 8. Error handling

| Situation | Behaviour |
|---|---|
| Steam 429 / blocked mid-run | Back off; on giving up, merge partial prices; job still succeeds if ≥1 page fetched |
| Steam fully unreachable | Job fails visibly in Actions; existing `prices.json` untouched |
| Catalog source down | Keep previous `catalog.json`; job continues with prices |
| Browser fails to load data | Error banner: "Couldn't load price data"; calculator usable with manual entry |
| Prices older than 24 h | Amber "stale prices" warning beside timestamp |
| Finder finds nothing | "No trade-ups match — try lowering the profit chance or raising the budget" |

## 9. Testing

- **Python** (`tests/`, unittest, existing style):
  - Steam response parsing → price map (fixture JSON, no network).
  - Catalog normalisation (fixture of a few skins, incl. excluded kinds).
  - Merge of partial runs and 72 h expiry.
- **JavaScript** (`tests/js/`, run with `node --test`, no dependencies):
  - `engine.js`: probabilities, normalised float, wear bucket, net price, EV,
    P(profit) — including a parity case equal to the existing Python
    `test_core.py` example.
  - Finder on a tiny fixture catalog: known best trade-up is found, filters
    (min profit chance, budget, StatTrak) exclude correctly, dominated inputs
    pruned.
- **Manual**: run the Action once via `workflow_dispatch`, load the site, run a
  search, click a result, confirm calculator matches.

## 10. Future (not in this spec)
- Third-party instant-sell sources (tradeit.gg etc.) as new `sources` entries.
- Price history storage for back-testing (the timestamped files are a start).
- 3-collection mixes; knife/glove trade-ups (5 inputs); souvenir inputs.
