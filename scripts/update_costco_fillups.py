#!/usr/bin/env python3
import argparse
import csv
import json
import re
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COSTCO_CSV = ROOT / "data" / "costco_fuel.csv"
PUBLIC_FUEL_CSV = ROOT / "data" / "fuel.csv"
FETCH_SCRIPT = ROOT / "scripts" / "costco_fetch_fillups.js"
MERGE_SCRIPT = ROOT / "scripts" / "merge_fuelio_costco.py"

FIELDS = [
    "date",
    "odometer",
    "gallons",
    "cost",
    "notes",
    "tags",
    "partial_fuelup",
    "missed_fuelup",
]


def run(cmd, check=True, **kwargs):
    return subprocess.run(cmd, cwd=ROOT, text=True, check=check, **kwargs)


def receipt_id(row):
    match = re.search(r"Costco receipt ([0-9]+)", row.get("notes", ""))
    return match.group(1) if match else ""


def fallback_key(row):
    return (
        row.get("date", ""),
        row.get("gallons", ""),
        row.get("cost", ""),
    )


def read_rows(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        return [{field: row.get(field, "") for field in FIELDS} for row in csv.DictReader(handle)]


def write_rows(path, rows):
    rows = sorted(rows, key=lambda row: (row.get("date", ""), receipt_id(row), row.get("notes", "")))
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def fetch_rows(args):
    with tempfile.NamedTemporaryFile("w+", suffix=".json", delete=False) as tmp:
        output = Path(tmp.name)
    cmd = [
        "node",
        str(FETCH_SCRIPT),
        "--port",
        str(args.port),
        "--months",
        str(args.months),
        "--output",
        str(output),
    ]
    if args.no_open_browser:
        cmd.append("--no-open-browser")
    try:
        run(cmd)
        payload = json.loads(output.read_text(encoding="utf-8"))
        return [{field: row.get(field, "") for field in FIELDS} for row in payload.get("rows", [])]
    finally:
        output.unlink(missing_ok=True)


def merge_new_rows(existing, fetched):
    existing_ids = {receipt_id(row) for row in existing if receipt_id(row)}
    existing_keys = {fallback_key(row) for row in existing}
    added = []
    for row in fetched:
        rid = receipt_id(row)
        if rid and rid in existing_ids:
            continue
        if not rid and fallback_key(row) in existing_keys:
            continue
        added.append(row)
        if rid:
            existing_ids.add(rid)
        existing_keys.add(fallback_key(row))
    return existing + added, added


def privacy_check():
    text = PUBLIC_FUEL_CSV.read_text(encoding="utf-8")
    patterns = [
        r"Costco receipt [0-9]+",
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+",
        r"\b[A-Z][a-z]+,\s*[A-Z]{2}\b",
        r"\b[0-9]{12,}\b",
        r"\blatitude\b|\blongitude\b",
    ]
    failures = [pattern for pattern in patterns if re.search(pattern, text, re.IGNORECASE)]
    if failures:
        raise RuntimeError(f"Refusing to commit public CSV; privacy scan matched: {', '.join(failures)}")


def commit_and_push(added_count, push):
    if run(["git", "diff", "--quiet", "--", str(PUBLIC_FUEL_CSV.relative_to(ROOT))], check=False).returncode == 0:
        return {"committed": False, "pushed": False}
    privacy_check()
    run(["git", "add", str(PUBLIC_FUEL_CSV.relative_to(ROOT))])
    message = f"Add Costco fuel fill-ups {date.today().isoformat()}"
    run(["git", "commit", "-m", message])
    if push:
        run(["git", "push"])
    return {"committed": True, "pushed": push, "message": message, "added_count": added_count}


def main():
    parser = argparse.ArgumentParser(description="Fetch Costco gas receipts and update the fuel ledger.")
    parser.add_argument("--months", type=int, default=6, help="rolling Costco receipt lookback window")
    parser.add_argument("--port", type=int, default=9222, help="managed Brave CDP port")
    parser.add_argument("--commit", action="store_true", help="commit sanitized public data/fuel.csv if changed")
    parser.add_argument("--push", action="store_true", help="push the commit to origin")
    parser.add_argument("--no-open-browser", action="store_true", help="do not start Brave if CDP is closed")
    parser.add_argument("--skip-fetch", action="store_true", help="rebuild merged CSVs from existing local Costco data only")
    args = parser.parse_args()

    if args.commit or args.push:
        run(["git", "pull", "--ff-only"])

    existing = read_rows(COSTCO_CSV)
    fetched = [] if args.skip_fetch else fetch_rows(args)
    merged, added = merge_new_rows(existing, fetched)
    if added:
        write_rows(COSTCO_CSV, merged)

    merge_result = run(["python3", str(MERGE_SCRIPT)], capture_output=True)
    commit_result = commit_and_push(len(added), args.push) if args.commit or args.push else {"committed": False, "pushed": False}
    print(json.dumps({
        "existing_costco_rows": len(existing),
        "fetched_costco_rows": len(fetched),
        "new_costco_rows": len(added),
        "costco_rows_after": len(merged),
        "merge": json.loads(merge_result.stdout),
        **commit_result,
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
