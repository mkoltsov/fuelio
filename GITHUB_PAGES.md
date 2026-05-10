# GitHub Pages Setup

This repository is a static site. It does not need a server, database, Docker, or LubeLogger process.

## Publish The Site

1. Open `https://github.com/mkoltsov/fuelio`.
2. Go to `Settings`.
3. Open `Pages`.
4. Under `Build and deployment`, set:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Click `Save`.
6. Wait a few minutes, then open:
   `https://mkoltsov.github.io/fuelio/`

GitHub's publishing-source docs are here:
`https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site`

## Data Privacy

The repository is public. Anything committed under `data/` can be read by anyone if GitHub Pages is enabled.

This repo intentionally ignores:

- `data/fuel.private.csv`
- `data/Fuelio_latest.csv`
- `data/costco_fuel.csv`

The public `data/fuel.csv` contains sanitized real fuel data for analytics. Your raw local data is kept in ignored files.

The public CSV keeps dates, odometer readings, gallons, total cost, generic source labels, and price-per-gallon notes. It removes raw Fuelio IDs, exact Fuelio location fields, Costco receipt numbers, Costco station/city notes, email addresses, account identifiers, and membership identifiers.

## Use Private Data Locally

1. Open the GitHub Pages site.
2. Click `Import CSV`.
3. Select your private CSV, for example:
   `data/fuel.private.csv`
4. The imported data is stored in that browser's localStorage.
5. Use `Export Fuel` or `Export Backup` after edits.

## Publish Updated Sanitized Data

After pulling new private inputs:

1. Run `python3 scripts/merge_fuelio_costco.py`.
2. Inspect `data/fuel.csv`.
3. Commit and push.
4. GitHub Pages will serve that sanitized CSV publicly.

Do not publish raw Fuelio backups or raw Costco exports unless you are comfortable exposing location fields, receipt numbers, and other private metadata.

## Rebuild Local Private Data

After pulling a new Fuelio backup and Costco receipt CSV:

```bash
python3 scripts/merge_fuelio_costco.py
```

That writes `data/fuel.private.csv`, which is ignored by git, and a sanitized `data/fuel.csv`, which is intended for GitHub Pages.
