#!/usr/bin/env python3
import csv
import re
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FUELIO = ROOT / "data" / "Fuelio_latest.csv"
COSTCO = ROOT / "data" / "costco_fuel.csv"
OUT = ROOT / "data" / "fuel.private.csv"
PUBLIC_OUT = ROOT / "data" / "fuel.csv"
MAINT_OUT = ROOT / "data" / "maintenance.csv"

FUEL_HEADERS = [
    "date",
    "odometer",
    "gallons",
    "cost",
    "notes",
    "tags",
    "partial_fuelup",
    "missed_fuelup",
    "source",
    "fuelio_unique_id",
]


def read_sections(path):
    sections = {}
    current = None
    header = None
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.reader(handle):
            if not row:
                continue
            if row[0].startswith("## "):
                current = row[0][3:]
                sections[current] = []
                header = None
                continue
            if current and header is None:
                header = row
                continue
            if current and header:
                sections[current].append(dict(zip(header, row)))
    return sections


def num(value):
    try:
        return float(str(value or "").replace("$", "").replace(",", ""))
    except ValueError:
        return 0.0


def fmt(value, places):
    if value == "" or value is None:
        return ""
    return f"{num(value):.{places}f}"


def date_key(value):
    return str(value or "")[:10]


def costco_receipt(notes):
    match = re.search(r"Costco receipt ([0-9]+)", notes or "")
    return match.group(1) if match else ""


def public_notes(notes):
    price_match = re.search(r"\b[0-9]+(?:\.[0-9]{1,3})?/gal\b", notes or "")
    return price_match.group(0) if price_match else ""


def normalized_match_key(row):
    return (
        date_key(row.get("date")),
        round(num(row.get("gallons")), 3),
        round(num(row.get("cost")), 2),
    )


def read_costco_rows():
    with COSTCO.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    out = []
    for row in rows:
        clean = {h: row.get(h, "") for h in FUEL_HEADERS}
        clean["date"] = date_key(row.get("date"))
        clean["gallons"] = fmt(row.get("gallons"), 3)
        clean["cost"] = fmt(row.get("cost"), 2)
        clean["notes"] = row.get("notes", "")
        clean["tags"] = row.get("tags", "Costco RegularGas")
        clean["partial_fuelup"] = row.get("partial_fuelup", "0")
        clean["missed_fuelup"] = row.get("missed_fuelup", "0")
        clean["source"] = "Costco receipt"
        out.append(clean)
    return out


def fuelio_rows():
    sections = read_sections(FUELIO)
    logs = sections.get("Log", [])
    out = []
    for row in logs:
        gallons = num(row.get("Fuel (gal)"))
        total = num(row.get("Price"))
        volume_price = num(row.get("VolumePrice"))
        city = row.get("City", "").strip()
        base_note = row.get("Notes", "").strip()
        note_parts = []
        if city:
            note_parts.append(city)
        if volume_price:
            note_parts.append(f"{volume_price:.3f}/gal")
        if base_note:
            note_parts.append(base_note)
        out.append({
            "date": date_key(row.get("Date")),
            "odometer": fmt(row.get("Odo (mi)"), 0),
            "gallons": f"{gallons:.3f}",
            "cost": f"{total:.2f}",
            "notes": "; ".join(note_parts),
            "tags": "Fuelio",
            "partial_fuelup": "0" if row.get("Full", "1") == "1" else "1",
            "missed_fuelup": row.get("Missed", "0") or "0",
            "source": "Fuelio backup",
            "fuelio_unique_id": row.get("UniqueId", ""),
        })
    return out


def merge():
    costco = read_costco_rows()
    fuelio = fuelio_rows()
    costco_by_key = {normalized_match_key(row): row for row in costco}
    merged = []
    matched_costco_keys = set()

    for row in fuelio:
        key = normalized_match_key(row)
        costco_row = costco_by_key.get(key)
        if costco_row:
            matched_costco_keys.add(key)
            receipt = costco_receipt(costco_row.get("notes"))
            notes = row.get("notes", "")
            if receipt and receipt not in notes:
                notes = f"{notes}; Costco receipt {receipt}" if notes else f"Costco receipt {receipt}"
            station_match = re.match(r"^(Costco [^;]+)", costco_row.get("notes", ""))
            if station_match and station_match.group(1) not in notes:
                notes = f"{station_match.group(1)}; {notes}" if notes else station_match.group(1)
            merged.append({
                **row,
                "notes": notes,
                "tags": "Fuelio Costco" if "Costco" in costco_row.get("tags", "") else row.get("tags", ""),
                "source": "Fuelio backup + Costco receipt",
            })
        else:
            merged.append(row)

    for row in costco:
        if normalized_match_key(row) not in matched_costco_keys:
            merged.append(row)

    merged.sort(key=lambda row: (row.get("date", ""), num(row.get("odometer")), row.get("source", "")))
    with OUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FUEL_HEADERS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(merged)

    public_rows = []
    for row in merged:
        public_row = dict(row)
        public_row["notes"] = public_notes(public_row.get("notes", ""))
        public_row["fuelio_unique_id"] = ""
        public_rows.append(public_row)

    with PUBLIC_OUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FUEL_HEADERS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(public_rows)

    if not MAINT_OUT.exists() or MAINT_OUT.read_text(encoding="utf-8").strip() == "date,odometer,service,category,cost,vendor,notes":
        MAINT_OUT.write_text("date,odometer,service,category,cost,vendor,notes\n", encoding="utf-8")

    return {
        "fuelio_rows": len(fuelio),
        "costco_rows": len(costco),
        "merged_rows": len(merged),
        "matched_costco_rows": len(matched_costco_keys),
        "output": str(OUT),
        "public_output": str(PUBLIC_OUT),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(merge(), indent=2))
