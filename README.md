# TradeUp Lab — CS2 Trade-Up Finder

[![Open website](https://img.shields.io/badge/Open%20website-TradeUp%20Lab-b9f45a?style=for-the-badge&labelColor=171e29)](https://patrickcioranu-ui.github.io/cs2-tradeup-lab/)

TradeUp Lab searches CS2 trade-up contracts against real CSFloat listing prices and ranks them by expected profit,
ROI or chance of profit.

## What it does

- **Finder:** searches every single-collection and two-collection trade-up (splits 1/9 … 9/1) for each rarity step,
  normal and/or StatTrak™. You set a minimum profit chance, a max budget, the tier, StatTrak mode and the sort order;
  it shows the top 50 results in about 1–3 seconds (in a background thread).
- **Calculator:** pick real collections and skins for the 10 inputs, set floats, and see every possible output with
  its float, wear, listing price, net after fees, expected value, profit chance and risk. Clicking a finder result loads
  it here.
- **Low-liquidity warning:** shown when an output has no CSFloat buy order, or its best buy order is below 70% of the
  lowest listing (a thin market where selling near the listing price is unlikely).

## Model and assumptions

- **Output float:** CS2's weighted-float rule. Each input float is scaled to its own skin range, the ten values are
  averaged (W), and W is mapped onto each output's range: `out = out_min + W × (out_max − out_min)`.
  Sources: SteamDB's trade-up guide and CSDelta's weighted-float article (both Jul 2026).
- **Probabilities:** a collection's chance = its share of the 10 inputs; outputs within a collection are equally likely.
- **Input cost:** the price of the wear you buy, assuming you get the *worst* float inside that wear, so results are
  conservative.
- **Prices:** the lowest current CSFloat listing for each skin and wear, from the public
  [prices.csgotrader.app](https://prices.csgotrader.app/latest/csfloat.json) CSFloat dump, converted from USD to EUR
  with the ECB daily rate. Inputs and outputs both use the listing price. Skins with no listing have no price, and any
  trade-up that needs one is skipped. Listings are not guaranteed sale prices.
- **Exit:** selling on CSFloat, 2% sale fee by default (adjustable).
  Earlier versions used Steam Market median sale prices, which were badly off for many skins.
- **Not covered yet:** knife/glove trade-ups (5 Covert inputs), souvenir inputs, and mixes of three or more collections.

## Data refresh

`site/data/catalog.json` (skins, from the open-source [ByMykel CSGO-API](https://github.com/ByMykel/CSGO-API)) and
`site/data/prices.json` are **not committed**. The **Deploy TradeUp Lab to GitHub Pages** workflow builds them fresh
and publishes them with the site on every push to `main`, daily at 06:00 UTC, and on demand. If a data build fails, that
deploy is skipped and the previous live site keeps its last good data.

To refresh now: **Actions → Deploy TradeUp Lab to GitHub Pages → Run workflow**.

For local development, build the data first (takes a few seconds):

```bash
python scripts/update_data.py
```

## Development

Requirements: Python 3.12+, Node 22+. No third-party packages.

```bash
python -m unittest discover -s tests -v
```

```bash
npm test
```

Serve the site locally:

```bash
python -m http.server 8000 -d site
```

The command-line analyser still works on saved data:

```bash
python tradeup_cli.py data/example_tradeup.json
```

## Deployment

GitHub Pages must use **Settings → Pages → Source: GitHub Actions**. Scheduled workflows are paused by GitHub after
60 days without repository activity; re-enable it from the Actions tab if that happens.
