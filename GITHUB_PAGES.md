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
4. The imported data is used in that browser session for review/export.
5. Use `Export Fuel` or `Export Backup` if you need a local copy.

## Add Public Entries From The Page

The `Add Entry` view follows the weekly meal-plan pattern:

1. Enter a fill-up in gallons with the odometer in miles, or enter a maintenance cost.
2. The draft is stored in that browser's localStorage.
3. Click the GitHub save button.
4. Open the prefilled issue.
5. The owner-only GitHub Action commits the sanitized CSV update, comments, and closes the issue.

Fill-ups are written to both `data/manual_fuel.csv` and `data/fuel.csv`. Maintenance costs are written to `data/maintenance.csv`.

This requires GitHub Issues and Actions to be enabled for the repository.

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

## Scheduled Costco Refresh

GitHub Pages serves files only; it cannot poll Costco. This repo includes a local monitor instead:

```bash
scripts/run_costco_monitor.sh
```

The scheduled wrapper uses the local managed Brave browser on CDP port `9222` to read Costco gas receipts, updates ignored local CSVs, rebuilds the sanitized public `data/fuel.csv`, commits it, and pushes it. The Windows scheduled task is named `Fuelio Costco Monitor` and is set for Sundays at 10:00 PM local time.
