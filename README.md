# TradeUp Lab — CS2 Trade-Up Finder

[![Open website](https://img.shields.io/badge/Open%20website-TradeUp%20Lab-b9f45a?style=for-the-badge&labelColor=171e29)](https://patrickcioranu-ui.github.io/cs2-tradeup-lab/)

TradeUp Lab searches CS2 trade-up contracts against real Steam Market prices and ranks them by expected profit,
ROI or chance of profit.

## What it does

- **Finder:** searches every single-collection and two-collection trade-up (splits 1/9 … 9/1) for each rarity step,
  normal and/or StatTrak™. You set a minimum profit chance, a max budget, the tier, StatTrak mode and the sort order;
  it shows the top 50 results in about 1–3 seconds (in a background thread).
- **Calculator:** pick real collections and skins for the 10 inputs, set floats, and see every possible output with
  its float, wear, Steam price, net after fees, expected value, profit chance and risk. Clicking a finder result loads
  it here.
- **Low-liquidity warning:** shown when an output had no Steam sales in the last 24 hours.

## Model and assumptions

- **Output float:** CS2's weighted-float rule. Each input float is scaled to its own skin range, the ten values are
  averaged (W), and W is mapped onto each output's range: `out = out_min + W × (out_max − out_min)`.
  Sources: SteamDB's trade-up guide and CSDelta's weighted-float article (both Jul 2026).
- **Probabilities:** a collection's chance = its share of the 10 inputs; outputs within a collection are equally likely.
- **Input cost:** the price of the wear you buy, assuming you get the *worst* float inside that wear, so results are
  conservative.
- **Prices:** Steam Market median sale price over the last 24 h (falling back to 7/30/90 days), taken from the public
  [prices.csgotrader.app](https://prices.csgotrader.app/latest/steam.json) Steam dump and converted from USD to EUR with
  the ECB daily rate. Medians are not guaranteed buy/sell prices.
- **Exit:** Steam only, 15% fee by default (adjustable). Third-party instant-sell sites can be added later as extra
  price sources.
- **Not covered yet:** knife/glove trade-ups (5 Covert inputs), souvenir inputs, and mixes of three or more collections.

## Data refresh

`site/data/catalog.json` (skins, from the open-source [ByMykel CSGO-API](https://github.com/ByMykel/CSGO-API)) and
`site/data/prices.json` are rebuilt every 6 hours by the **Refresh price data** GitHub Action, which commits them and
triggers a Pages redeploy.

To refresh now: **Actions → Refresh price data → Run workflow**.

To refresh locally:

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

GitHub Pages must use **Settings → Pages → Source: GitHub Actions**. The `Deploy TradeUp Lab to GitHub Pages`
workflow publishes the `site/` folder on every push to `main` and after every price refresh.
