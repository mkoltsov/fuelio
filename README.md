# Fuel Ledger Pages

Static GitHub Pages fuel and maintenance ledger inspired by LubeLogger and Fuelio record views.

## Files

- `index.html` - app shell
- `styles.css` - responsive dashboard styling
- `app.js` - CSV parsing, statistics charts, GitHub issue entry forms, import/export
- `data/fuel.csv` - sanitized public fuel ledger for GitHub Pages
- `data/manual_fuel.csv` - public manual fill-ups submitted from GitHub Pages issues
- `data/fuel.private.csv` - local merged Fuelio and Costco data, ignored by git
- `data/costco_fuel.csv` - local Costco-only fill-ups, ignored by git
- `data/Fuelio_latest.csv` - local newest Fuelio backup pulled from Gmail, ignored by git
- `data/maintenance.csv` - maintenance records
- `data/reminders.csv` - reminder records
- `data/maintenance_schedule.csv` - second-generation 2011 Toyota Matrix mileage schedule and approximate North Carolina procedure costs
- `.github/workflows/update-ledger-entry.yml` - owner-only issue workflow that commits manual fill-ups and maintenance costs
- `scripts/merge_fuelio_costco.py` - rebuilds private and public fuel ledgers
- `scripts/update_costco_fillups.py` - fetches new Costco gas receipts through the local managed Brave session
- `scripts/run_costco_monitor.sh` - scheduled-task wrapper that commits and pushes sanitized updates

## GitHub Pages

Publish this folder from a public repository or a GitHub Pages-enabled private repository. The app has no server component. New fill-ups and maintenance costs are drafted in browser localStorage, then submitted through a prefilled GitHub issue that an owner-only workflow commits to CSV.

The `Statistics` view has all-time, recent-month, and custom month filters for Fuelio-style fill-up totals, fuel costs, consumption, price, odometer trends, Costco savings estimates, a mileage-adjusted 2011 Matrix value tracker, source mix, and a monthly scoreboard from the sanitized public CSV. The dashboard also includes a monthly fuel-cost strip for the latest spend trend.

For privacy, the committed `data/fuel.csv` omits raw Fuelio IDs, exact Fuelio location fields, Costco receipt numbers, Costco station/city notes, email addresses, account identifiers, and membership identifiers. The raw imported files stay ignored by git.

See [GITHUB_PAGES.md](GITHUB_PAGES.md) for setup steps.

## Rebuild Data

```bash
python3 scripts/merge_fuelio_costco.py
```

The merge writes `data/fuel.private.csv` for local use and `data/fuel.csv` for publishing. It prefers Fuelio odometer data when a Costco receipt matches by date, gallons, and total cost. Unmatched Costco receipts remain in the ledger without odometer values.

Manual public fill-ups submitted from the page use gallons and odometer miles. They are stored in `data/manual_fuel.csv`; the merge includes them so scheduled Costco/Fuelio rebuilds do not discard them. Fuelio maintenance-cost rows are imported from the backup when the `## Costs` section contains records.

The Schedule view uses the local second-generation Toyota Matrix scheduled-maintenance guide and the latest public odometer to show upcoming 5,000-mile service items. Cost ranges are approximate North Carolina independent-shop estimates and are intended for planning, not as quotes.

## Scheduled Costco Updates

The Costco monitor runs locally because GitHub Pages cannot run background jobs and the Costco receipt API needs the browser's logged-in session. The monitor uses the managed Brave CDP session on port `9222`, updates ignored local Costco data, rebuilds `data/fuel.csv`, privacy-scans the public CSV, then commits and pushes only the sanitized public file when new fill-ups are found.

```bash
scripts/run_costco_monitor.sh
```

Keep the managed Brave profile signed in to Costco. If Costco asks for sign-in again, the scheduled task will log the failure under `logs/costco-monitor.log` and skip publishing.
