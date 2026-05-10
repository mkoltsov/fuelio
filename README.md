# Fuel Ledger Pages

Static GitHub Pages fuel and maintenance ledger inspired by LubeLogger record views.

## Files

- `index.html` - app shell
- `styles.css` - responsive dashboard styling
- `app.js` - CSV parsing, charts, local edits, import/export
- `data/fuel.csv` - public sample data for GitHub Pages
- `data/fuel.private.csv` - local merged Fuelio and Costco data, ignored by git
- `data/costco_fuel.csv` - local Costco-only fill-ups, ignored by git
- `data/Fuelio_latest.csv` - local newest Fuelio backup pulled from Gmail, ignored by git
- `data/maintenance.csv` - maintenance records
- `data/reminders.csv` - reminder records
- `scripts/merge_fuelio_costco.py` - rebuilds `data/fuel.csv`

## GitHub Pages

Publish this folder from a public repository or a GitHub Pages-enabled private repository. The app has no server component and stores edits in browser localStorage until exported.

For privacy, avoid publishing raw receipt IDs unless the repository/site visibility is acceptable.

See [GITHUB_PAGES.md](GITHUB_PAGES.md) for setup steps.

## Rebuild Data

```bash
python3 scripts/merge_fuelio_costco.py
```

The merge writes `data/fuel.private.csv` and prefers Fuelio odometer data when a Costco receipt matches by date, gallons, and total cost. Unmatched Costco receipts remain in the ledger without odometer values.
