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

## Data Privacy

The repository is public. Anything committed under `data/` can be read by anyone if GitHub Pages is enabled.

This repo intentionally ignores:

- `data/fuel.private.csv`
- `data/Fuelio_latest.csv`
- `data/costco_fuel.csv`

The public `data/fuel.csv` is sample data. Your real local data is kept in `data/fuel.private.csv`.

## Use Real Data Without Publishing It

1. Open the GitHub Pages site.
2. Click `Import CSV`.
3. Select your private CSV, for example:
   `data/fuel.private.csv`
4. The imported data is stored in that browser's localStorage.
5. Use `Export Fuel` or `Export Backup` after edits.

## Publish Real Data Intentionally

If you decide the data is safe to make public:

1. Replace `data/fuel.csv` with your private CSV.
2. Commit and push.
3. GitHub Pages will serve that CSV publicly.

Do not publish raw Fuelio backups unless you are comfortable exposing odometer history, dates, locations, and receipt notes.

## Rebuild Local Private Data

After pulling a new Fuelio backup and Costco receipt CSV:

```bash
python3 scripts/merge_fuelio_costco.py
```

That writes `data/fuel.private.csv`, which is ignored by git.
