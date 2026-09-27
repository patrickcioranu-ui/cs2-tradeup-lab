# CS2 Trade-Up Analysis MVP

[![Open website](https://img.shields.io/badge/Open%20website-TradeUp%20Lab-b9f45a?style=for-the-badge&labelColor=171e29)](https:/patrickcioranu-ui.github.io/cs2-tradeup-lab/)

This is the first offline version of a quantitative CS2 trade-up analyser. It keeps the calculation engine independent from marketplace/network code so that the model can be tested against saved data before adding live feeds.

## Included in the MVP

- Standard ten-input trade-up validation.
- Collection-weighted output probabilities.
- Output-float calculation from the average input float:

  `output_float = output_min + average_input_float * (output_max - output_min)`

- Configurable Steam and instant-sell fee models.
- Expected net proceeds and expected profit.
- Probability of making a profit.
- Proceeds standard deviation as a simple risk measure.
- Comparison of Steam and instant-sell exits.

## Run the example

```bash
python tradeup_cli.py data/example_tradeup.json
```

## Run tests

```bash
python -m unittest discover -s tests -v
```

The sample values are illustrative, not live market quotes. The next stage should add an ingestion layer that uses permitted public APIs, exports or manually saved quotes, normalises item identifiers, stores timestamped prices and records fees/marketplace assumptions. That will let us back-test whether an apparent edge survives spreads, liquidity and price changes.

## GitHub Pages website

The interactive website is in `site/`. It runs entirely in the browser and uses the same trade-up logic as the MVP, with editable inputs, fees, output quotes and a decision view.

### Push it to GitHub

1. Create a new empty repository on GitHub, for example `cs2-tradeup-lab`. Do not initialise it with another README or `.gitignore`.
2. From this project folder, run:

```bash
git init
git add .
git commit -m "Initial TradeUp Lab website"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cs2-tradeup-lab.git
git push -u origin main
```

3. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
4. Open the **Actions** tab and wait for `Deploy TradeUp Lab to GitHub Pages` to finish.

The site will then be available at:

`https://YOUR_USERNAME.github.io/cs2-tradeup-lab/`

The deployment workflow is already included at `.github/workflows/pages.yml`.

### Add the link to the repository sidebar

After the first deployment:

1. Open the repository's main page on GitHub.
2. Click the gear icon beside **About**.
3. Paste `https://YOUR_USERNAME.github.io/cs2-tradeup-lab/` into the **Website** field.
4. Click **Save changes**.

GitHub will then show the website link in the repository sidebar, while the README badge above provides a larger clickable button.
