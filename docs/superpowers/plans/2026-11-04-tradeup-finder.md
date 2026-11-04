# Trade-Up Finder with Live Steam Prices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real CS2 skins plus Steam prices, refreshed every 6 h by a GitHub Action, feeding an in-browser finder that ranks trade-ups by profit, ROI or profit chance under user filters.

**Architecture:** Python (stdlib only) builds `site/data/catalog.json` and `site/data/prices.json` in a scheduled Action. The static site loads them; `engine.js` holds the trade-up maths shared by the finder (run in a Web Worker) and the existing calculator.

**Tech Stack:** Python 3.12 stdlib + unittest; vanilla JS ES modules; `node --test` (Node 22, no npm deps); GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-11-04-tradeup-finder-design.md`

## Global Constraints

- No third-party dependencies: Python stdlib only; JS with no npm packages (a `package.json` exists only for `"type": "module"` and the test script).
- Currency EUR; display via `Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" })` as today.
- Steam fee default 15% (`fee_rate: 0.15`), fixed fee default 0.
- Output float: weighted-float formula, spec §4.2. One function per language: `output_float` (Python), `outputFloat` (JS).
- Wear buckets: FN [0, 0.07), MW [0.07, 0.15), FT [0.15, 0.38), WW [0.38, 0.45), BS [0.45, 1].
- Wear market names: `Factory New`, `Minimal Wear`, `Field-Tested`, `Well-Worn`, `Battle-Scarred`; StatTrak prefix is exactly `StatTrak™ ` (U+2122 then a space).
- Input cost assumption: worst float in the bought wear (spec §4.4).
- Tier ids 0–5 = Consumer, Industrial, Mil-Spec, Restricted, Classified, Covert; finder tiers T = 0..4 (T → T+1).
- Finder: single collection + two-collection pairs (k = 1..9), top 50, low-liquidity badge when `minListings < 10`.
- Steam paging: 100 per page, ~3 s pause, exponential back-off on 429, max 5 retries per page. Prices unseen for 72 h are dropped.
- Stale-price warning when `updated_at` is older than 24 h.
- Generic User-Agent `TradeUpLab-data-refresh/1.0`. Never put personal data in requests.
- Commit after each task. **Never push** without the user's OK.

## Review Focus

1. **Float exactly on a wear boundary** (0.07, 0.15, 0.38, 0.45, 1.0) should land in the higher bucket, with 1.0 → BS. Test in Task 3.
2. **A skin with a zero float range** (min == max) should normalise to 0, not NaN. Tests in Task 2 (Python) and Task 3 (JS).
3. **An output with no Steam price** should cause the candidate to be skipped, never treated as €0 or as profit. Test in Task 7.
4. **StatTrak names:** they must be built with the exact `StatTrak™ ` prefix, or every StatTrak lookup silently misses. Test in Task 3.
5. **Steam failing mid-run** (`success: false`, empty `results`, or repeated 429s) should keep the pages already fetched and report the run as incomplete without raising. Test in Task 5.

---

### Task 1: Toolchain and repo cleanup

**Files:**
- Move: `pages.yml` → `.github/workflows/pages.yml`
- Delete (root duplicates): `app.js`, `index.html`, `styles.css`, `core.py`, `__init__.py`, `test_core.py`, `example_tradeup.json`, `download`
- Create: `package.json`

- [ ] **Step 1: Install tools (ask the user first; this installs software).** Run `winget install Python.Python.3.12` and `winget install OpenJS.NodeJS.LTS`, then open a new shell. Check: `python --version` shows 3.12.x and `node --version` shows v22 or later.
- [ ] **Step 2: Baseline.** Run `python -m unittest discover -s tests -v`. Expected: 4 tests OK.
- [ ] **Step 3: Move and delete files** with `git mv` / `git rm` as listed above.
- [ ] **Step 4: Create `package.json`:** `{"name":"cs2-tradeup-lab","private":true,"type":"module","scripts":{"test":"node --test tests/js/"}}`.
- [ ] **Step 5: Add a `workflow_run` trigger to `.github/workflows/pages.yml`** for workflow `"Refresh price data"` with `types: [completed]`. Commits pushed by `GITHUB_TOKEN` don't trigger `push` workflows, so without this the refreshed data would never deploy.
- [ ] **Step 6: Re-run the Python tests.** Expected: 4 OK.
- [ ] **Step 7: Commit:** `chore: move Pages workflow, remove root duplicates`.
- [ ] **Step 8: Tell the user** that before this is pushed, they must set **Settings → Pages → Source: GitHub Actions**. The live site is probably served from the root files, which this task deletes.

### Task 2: Python core — weighted float

**Files:** Modify `cs2_tradeup/core.py`; test `tests/test_core.py`

**Interfaces:**
- Produces: `InputItem(name, collection, float_value, acquisition_cost, min_float=0.0, max_float=1.0)`; `normalized_float(item: InputItem) -> float`; `output_float(inputs, output) -> float` (now weighted).

- [ ] **Step 1: Write failing tests:**
  - `test_weighted_float_spectrogram`: 10 × `InputItem(..., float_value=0.15, min_float=0.0, max_float=0.50)`; outputs `OutputSkin("Crossfade","A",0.0,0.50,...)` → `0.15`, `OutputSkin("Halftone","A",0.0,0.60,...)` → `0.18`, `OutputSkin("Berry","A",0.0,0.80,...)` → `0.24`.
  - `test_zero_range_input_normalises_to_zero`: `InputItem(..., float_value=0.3, min_float=0.3, max_float=0.3)` → `normalized_float == 0.0`.
  - `test_input_outside_own_range_rejected`: float 0.6 with `max_float=0.5` → `ValueError`.
- [ ] **Step 2:** `python -m unittest tests.test_core -v` → the new tests FAIL.
- [ ] **Step 3: Implement.** Add the range fields, plus validation in `__post_init__` (`0 ≤ min ≤ max ≤ 1` and `min ≤ float ≤ max`). Add `normalized_float`, and have `output_float` average `normalized_float`. Update the docstring to cite spec §4.2.
- [ ] **Step 4:** All 7 tests PASS. The old `test_output_float_formula` still passes because its inputs use the default range 0–1.
- [ ] **Step 5: Commit:** `fix: use CS2 weighted-float trade-up formula`.

### Task 3: `site/engine.js` — shared maths

**Files:** Create `site/engine.js`; test `tests/js/engine.test.js`

**Interfaces — Produces (all named exports):**
- `WEARS`: `[{ code: "FN", name: "Factory New", min: 0, max: 0.07 }, …]` (5 entries; BS max 1)
- `wearForFloat(f: number) -> "FN"|"MW"|"FT"|"WW"|"BS"`
- `normalizeFloat(f, min, max) -> number` (returns 0 when max === min)
- `outputFloat(inputs: {float, minFloat, maxFloat}[], outMin, outMax) -> number`
- `netSale(gross, feeRate, fixedFee = 0) -> number` (floored at 0)
- `marketName(baseName: string, wearCode, stattrak: boolean) -> string`
- `analyze({ inputs, outputsByCollection, feeRate, fixedFee }) -> Analysis`
  - `inputs`: `{ collection, float, minFloat, maxFloat, cost }[]` (length 10)
  - `outputsByCollection`: `{ [collection]: { name, minFloat, maxFloat, prices: { [wear]: { price, listings } } }[] }`
  - `Analysis`: `{ complete: boolean, cost, ev, profit, roi, pProfit, risk, minListings, outcomes: { name, collection, probability, float, wear, gross, net, listings }[] }`. `complete` is false and `gross`/`net` are `null` when any outcome's wear has no price. In that case `ev`, `profit`, `roi` and `pProfit` are `null`.

- [ ] **Step 1: Write failing tests** (`node:test`, `node:assert/strict`):
  - `wearForFloat`: 0 → FN, 0.0699 → FN, 0.07 → MW, 0.15 → FT, 0.38 → WW, 0.45 → BS, 1 → BS.
  - `normalizeFloat(0.3, 0.3, 0.3) === 0`; `normalizeFloat(0.15, 0, 0.5) === 0.3`.
  - Spectrogram case (as in Task 2): `outputFloat` ≈ 0.15 / 0.18 / 0.24.
  - `marketName("AK-47 | Redline", "FT", true) === "StatTrak™ AK-47 | Redline (Field-Tested)"`; non-StatTrak → `"AK-47 | Redline (Field-Tested)"`.
  - Python parity: same data as `test_expected_value_and_profit_probability` (good 30 / bad 2, cost 1 each, fee 0) → `ev` 16, `profit` 6, `pProfit` 0.5.
  - Fee: one output at 20, `feeRate` 0.15 → `ev` 17.
  - Collection weighting 6/4 with 2+1 outputs → probabilities 0.3, 0.3, 0.4.
  - Missing price → `complete === false`, `ev === null`.
- [ ] **Step 2:** `npm test` → FAIL (module not found).
- [ ] **Step 3: Implement** `site/engine.js`. Logic mirrors `cs2_tradeup/core.py`; `risk` = weighted standard deviation of `net`; `roi = profit / cost` (`null` when cost is 0).
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5: Commit:** `feat: add shared JS trade-up engine`.

### Task 4: Catalog builder

**Files:** Create `cs2_tradeup/catalog.py`, `tests/fixtures/bymykel_skins_sample.json`; test `tests/test_catalog.py`

**Interfaces — Produces:**
- `SKINS_URL = "https://bymykel.github.io/CSGO-API/api/en/skins.json"`
- `RARITY_TIERS = {"rarity_common_weapon": 0, "rarity_uncommon_weapon": 1, "rarity_rare_weapon": 2, "rarity_mythical_weapon": 3, "rarity_legendary_weapon": 4, "rarity_ancient_weapon": 5}`
- `build_catalog(raw_skins: list[dict], generated_at: str) -> dict` with output `{"generated_at", "collections": {name: {"<tier>": [{"id", "market_base_name", "rarity", "min_float", "max_float", "stattrak_available"}]}}}`. Tier keys are strings. Skins within a tier are sorted by `market_base_name`.

- [ ] **Step 1: Build the fixture from the real source.** Download `SKINS_URL` once and **confirm the field names** (`name`, `rarity.id`, `collections[].name`, `min_float`, `max_float`, `stattrak`, `category.name`). If any differ, use the real names here and in Step 3. Save about 8 entries to the fixture:
  - 2 Mil-Spec and 1 Restricted from one collection
  - 1 Restricted from a second collection
  - 1 knife (category `Knives`)
  - 1 glove
  - 1 skin with no collections
  - 1 non-StatTrak skin
- [ ] **Step 2: Write failing tests:**
  - Knife, glove and no-collection skins are excluded.
  - Tiers are placed correctly.
  - `stattrak_available` is mapped.
  - Floats are copied.
  - Output is deterministically sorted.
- [ ] **Step 3: Implement.** Exclude when `category.name` is in `{"Knives", "Gloves"}`, when there are no collections, or when the rarity id isn't in `RARITY_TIERS`. A skin in several collections goes under the first one.
- [ ] **Step 4:** `python -m unittest tests.test_catalog -v` → PASS.
- [ ] **Step 5: Commit:** `feat: build skin catalog from ByMykel data`.

### Task 5: Steam price fetcher

**Files:** Create `cs2_tradeup/steam_prices.py`, `tests/fixtures/steam_search_page.json`; test `tests/test_steam_prices.py`

**Interfaces — Produces:**
- `SEARCH_URL = "https://steamcommunity.com/market/search/render/"`; base params `{"appid": 730, "norender": 1, "count": 100, "sort_column": "name", "sort_dir": "asc", "currency": 3}`
- `parse_search_page(payload: dict, fx: float, seen_at: str) -> dict[str, dict]`: maps `hash_name` → `{"price": round(sell_price / 100 * fx, 2), "listings": sell_listings, "seen_at": seen_at}`
- `fetch_all(get_json: Callable[[dict], dict], sleep: Callable[[float], None], fx: float, seen_at: str) -> tuple[dict, bool]`: returns (prices, complete)
- `fetch_ecb_usd_per_eur(get_text: Callable[[str], str]) -> float`
- `merge_prices(previous: dict | None, fresh: dict, now: datetime, complete: bool) -> dict`: returns the full `prices.json` structure from spec §3.3

- [ ] **Step 1: Check the currency (manual, record the result in the commit message).** Fetch one page with `currency=3` and one without; compare `sell_price` and `sell_price_text`.
  - If EUR is honoured: `fx = 1.0`.
  - If not: `fx = 1 / fetch_ecb_usd_per_eur(...)`, using `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (the `USD` rate), and store `fx_rate` in the file.
  - Save a trimmed real page (3 results) as the fixture.
- [ ] **Step 2: Write failing tests:**
  - Fixture parse: prices are converted and rounded to 2 decimals.
  - `fetch_all` with a stub returning page 1 (`total_count` 150), then page 2 → 150 items, `complete=True`, and `sleep` called between pages.
  - **Mid-run failure:** stub returns page 1, then `{"success": false}` → keeps page-1 items, `complete=False`, no exception.
  - **429 handling:** stub raises a 429 error 6 times on page 2 → stops after 5 retries, `complete=False`, back-off sleeps doubled (3, 6, 12, 24, 48).
  - `merge_prices`: a previous item seen 73 h ago is dropped; one seen 71 h ago is kept; fresh values overwrite; `updated_at = now`; `sources.steam.fee_rate == 0.15`.
- [ ] **Step 3: Implement** with `urllib.request` (User-Agent from Global Constraints). Page through with `start = 0, 100, …` until `start >= total_count`.
- [ ] **Step 4:** `python -m unittest tests.test_steam_prices -v` → PASS.
- [ ] **Step 5: Commit:** `feat: fetch and merge Steam market prices (currency: <result of step 1>)`.

### Task 6: Refresh script and workflow

**Files:** Create `scripts/update_data.py`, `.github/workflows/update-prices.yml`; test `tests/test_update_data.py`

**Interfaces:**
- Consumes: `build_catalog`, `fetch_all`, `merge_prices`, `fetch_ecb_usd_per_eur`.
- Produces: `run(data_dir: Path, fetch_catalog, fetch_prices, now) -> int` (exit code), plus `main()`.

- [ ] **Step 1: Write failing tests** with stub fetchers and a temp dir:
  - Catalog fetch raises → the existing `catalog.json` is unchanged, prices are still written, exit 0.
  - Prices return 0 items and `complete=False` → `prices.json` is unchanged, exit 1.
  - Normal run writes both files as UTF-8 JSON with `ensure_ascii=False`, so `™` stays readable.
- [ ] **Step 2:** Run the tests → FAIL.
- [ ] **Step 3: Implement** `run` / `main` (`main` wires up the real network functions).
- [ ] **Step 4:** Tests PASS. Then run `python scripts/update_data.py` for real once (about 15 min) so that `site/data/` has real files to commit.
- [ ] **Step 5: Create the workflow,** named `Refresh price data`:
  - cron `0 */6 * * *` plus `workflow_dispatch`
  - `permissions: contents: write`
  - `actions/checkout@v4`, `actions/setup-python@v5` with 3.12, then `python scripts/update_data.py`
  - Then: `git diff --quiet site/data || (git config user.name github-actions && git config user.email github-actions@users.noreply.github.com && git add site/data && git commit -m "data: refresh prices $(date -u +%FT%TZ)" && git push)`
- [ ] **Step 6: Commit:** `feat: scheduled price refresh workflow`.

### Task 7: Finder search (`site/finder.js`)

**Files:** Create `site/finder.js`, `tests/js/fixtures/mini-catalog.json`, `tests/js/fixtures/mini-prices.json`; test `tests/js/finder.test.js`

**Interfaces:**
- Consumes: `analyze`, `WEARS`, `marketName`, `normalizeFloat` from `engine.js`.
- Produces:
  - `inputOptions(catalog, lookup, tier, stattrak) -> Map<collection, InputOption[]>`, where `InputOption = { collection, skin, wear, float, norm, price, listings }`, after pruning dominated options.
  - `findTradeUps(catalog, lookup, opts, onProgress?) -> Result[]`
    - `opts = { minProfitChance: 0..1, maxBudget: number|null, tiers: number[], stattrak: "normal"|"stattrak"|"both", sortBy: "profit"|"roi"|"chance", limit: 50, feeRate: 0.15, fixedFee: 0 }`
    - `Result = { tier, stattrak, legs: { option: InputOption, count }[], analysis: Analysis, lowLiquidity: boolean }`
  - `lookup` is `(marketName) => { price, listings } | undefined`, created by `priceLookup` (Task 8).

Rules:
- **Worst float:** BS → `skin.max_float`; otherwise `min(skin.max_float, wear.max - 0.0001)`.
- **A wear is available** when `skin.min_float < wear.max` and `skin.max_float >= wear.min`.
- **Only the cheapest priced skin per (collection, wear) is kept,** and options with `listings === 0` are dropped.
- **Pruning:** drop option X when another option Y in the same collection has `price ≤` and `norm ≤`, with at least one of them strictly smaller.
- **Output pool:** tier T+1 skins in each used collection (StatTrak: only `stattrak_available`). Each output's `prices` come from `lookup(marketName(...))` per wear.
- **Skipping:** collections with no T+1 skins are skipped, as is any candidate whose `analysis.complete === false`.
- **Sorting:** by the chosen key descending, tie-broken by lower cost. Progress is reported as a 0–1 fraction.

- [ ] **Step 1: Hand-build the fixtures.** Two collections, A and B, each with 2 Mil-Spec skins and 2 Restricted skins.
  - Set prices so the best trade-up is known: 7 × A-cheap-MW + 3 × B-cheap-FT, with expected profit and profit chance computed by hand and written into the test as constants.
  - Include one Restricted skin in B whose FN wear has no price.
  - Include a StatTrak variant for A only.
- [ ] **Step 2: Write failing tests:**
  - The best result equals the hand-computed trade-up (legs and profit to the cent).
  - `minProfitChance` above that trade-up's chance excludes it.
  - `maxBudget` below its cost excludes it.
  - `stattrak: "stattrak"` only returns StatTrak results, and only from A.
  - A dominated option (more expensive, worse norm) is absent from `inputOptions`.
  - **A candidate that lands on the unpriced FN output is never returned.**
  - Sorting by `"roi"` and `"chance"` reorders the results.
  - `onProgress` is called with 1 at the end.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test` → PASS. Then time a full real-data run in Node (`site/data/*.json`, all tiers, `"both"`) and record it in the commit message. Target: under 15 s. If it's slower, precompute output pools per (collection, tier, StatTrak) once.
- [ ] **Step 5: Commit:** `feat: trade-up finder search`.

### Task 8: Data loading and Finder UI

**Files:** Create `site/data.js`, `site/finder.worker.js`; modify `site/index.html`, `site/app.js`, `site/styles.css`; test `tests/js/data.test.js`

**Interfaces — Produces:**
- `loadData(fetchFn = fetch, base = "data/") -> Promise<{ catalog, prices, updatedAt: Date, stale: boolean }>`. Throws `DataLoadError` on any HTTP or JSON failure.
- `priceLookup(prices, source = "steam") -> (marketName) => { price, listings } | undefined`
- Worker protocol: in `{ type: "search", catalog, prices, opts }`; out `{ type: "progress", value }` / `{ type: "done", results }` / `{ type: "error", message }`. Starting a new search terminates the old worker and creates a new one.

- [ ] **Step 1: Write failing tests:**
  - `loadData` with a stub `fetchFn`: OK, then `stale` is false when 1 h old and true when 25 h old.
  - A 404 → rejects with `DataLoadError`.
  - `priceLookup` hit and miss.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement `data.js` and `finder.worker.js`.** The worker imports `finder.js` and `data.js`, and is created with `new Worker("finder.worker.js", { type: "module" })`.
- [ ] **Step 4: UI.**
  - Load `app.js` with `<script type="module">`.
  - Add a "Finder" section above the calculator with these controls:
    - min profit chance % (default 50)
    - max budget € (empty = none)
    - tier select ("All" plus 5 steps)
    - StatTrak select (Normal / StatTrak / Both)
    - sort select
    - "Find trade-ups" button
  - Below the controls: a progress bar and a results table (inputs summary, cost, EV, profit, ROI, chance, low-liquidity badge).
  - Topbar shows "Prices as of <local time>", plus an amber "stale prices" note when `stale`.
  - Empty result → the exact text from spec §8.
  - `DataLoadError` → the banner "Couldn't load price data", and the calculator stays usable.
- [ ] **Step 5: Manual check.** Serve with `python -m http.server -d site 8000` and open it in the browser pane.
  - A search for "Mil-Spec → Restricted, 50%, profit" shows results and the progress bar fills.
  - Renaming `site/data/prices.json` temporarily shows the banner.
- [ ] **Step 6: Commit:** `feat: finder UI with live data`.

### Task 9: Calculator on real skins, plus hand-off

**Files:** Modify `site/app.js`, `site/index.html`, `site/styles.css`

**Interfaces:**
- Consumes: `analyze`, `marketName`, `wearForFloat` (Task 3); `priceLookup` (Task 8); `Result` (Task 7).
- Produces: `loadIntoCalculator(result: Result) -> void`.

- [ ] **Step 1: Remove the sample data.** Delete `sampleInputs` and `sampleOutputs`, and the Instant fee fields and column.
- [ ] **Step 2: Calculator controls.**
  - At the top: a tier select and a StatTrak checkbox.
  - Each of the 10 rows: collection select (collections with skins at the tier) → skin select → float (clamped to the skin's range) → cost, auto-filled with `lookup(marketName(skin, wearForFloat(float), st))?.price` and editable.
- [ ] **Step 3: Outputs** are generated per used collection from tier T+1. Each price is auto-filled at its computed wear and stays editable. Results render from `analyze(...)`. An incomplete analysis shows "Missing price for <name> (<wear>) — enter it manually".
- [ ] **Step 4: Hand-off.** Clicking a finder row calls `loadIntoCalculator`, fills the rows from `legs` (count × option, using `option.float`), and scrolls to the calculator.
- [ ] **Step 5: Manual check** (same server). Click the top finder result and confirm the calculator's EV, profit and chance equal the finder row exactly. Change one float and confirm the outputs' floats and wears update.
- [ ] **Step 6:** `npm test` and `python -m unittest discover -s tests -v` → all PASS.
- [ ] **Step 7: Commit:** `feat: calculator uses real skins and accepts finder results`.

### Task 10: README and end-to-end verification

**Files:** Modify `README.md`

- [ ] **Step 1: Update the README.**
  - Describe the finder, the data refresh (every 6 h; manual run via Actions → "Refresh price data" → Run workflow), and the assumptions (worst-float input cost, Steam-only exit at 15%, weighted-float formula with its sources, no knife/glove or souvenir support).
  - Fix the broken badge URL (`https:/` → `https://`).
  - Remove the push-from-scratch instructions.
- [ ] **Step 2: Commit:** `docs: document finder and data refresh`.
- [ ] **Step 3: Ask the user before pushing,** and remind them about the Pages source setting from Task 1.
- [ ] **Step 4: After their push,** check:
  - Both workflows succeed in the Actions tab.
  - Run "Refresh price data" manually; Pages redeploys and the live site shows the new timestamp.
  - A finder search works on the live site.
