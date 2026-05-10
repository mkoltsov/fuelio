#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs

{
  echo "=== $(date -Is) costco monitor ==="
  python3 scripts/update_costco_fillups.py --months 6 --commit --push
} >> logs/costco-monitor.log 2>&1
