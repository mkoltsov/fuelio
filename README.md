# Fuel Ledger Pages

Static GitHub Pages fuel and maintenance ledger inspired by LubeLogger record views.

## Files

- `index.html` - app shell
- `styles.css` - responsive dashboard styling
- `app.js` - CSV parsing, charts, local edits, import/export
- `data/fuel.csv` - sanitized public fuel ledger for GitHub Pages
- `data/fuel.private.csv` - local merged Fuelio and Costco data, ignored by git
- `data/costco_fuel.csv` - local Costco-only fill-ups, ignored by git
- `data/Fuelio_latest.csv` - local newest Fuelio backup pulled from Gmail, ignored by git
- `data/maintenance.csv` - maintenance records
- `data/reminders.csv` - reminder records
- `scripts/merge_fuelio_costco.py` - rebuilds private and public fuel ledgers

## GitHub Pages

Publish this folder from a public repository or a GitHub Pages-enabled private repository. The app has no server component and stores edits in browser localStorage until exported.

For privacy, the committed `data/fuel.csv` omits raw Fuelio IDs, exact Fuelio location fields, Costco receipt numbers, Costco station/city notes, email addresses, account identifiers, and membership identifiers. The raw imported files stay ignored by git.

See [GITHUB_PAGES.md](GITHUB_PAGES.md) for setup steps.

## Rebuild Data

```bash
python3 scripts/merge_fuelio_costco.py
```

The merge writes `data/fuel.private.csv` for local use and `data/fuel.csv` for publishing. It prefers Fuelio odometer data when a Costco receipt matches by date, gallons, and total cost. Unmatched Costco receipts remain in the ledger without odometer values.
