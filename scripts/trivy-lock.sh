#!/usr/bin/env bash
set +e
cd "$(dirname "$0")/.." || exit 1
OUT="${TRIVY_OUT:-$PWD/cyber-scans}"
mkdir -p "$OUT"
IGNORE="$PWD/.trivyignore"
echo "=== lockfile prod ==="
trivy fs --skip-db-update --skip-version-check --scanners vuln --severity HIGH,CRITICAL,MEDIUM \
  --ignorefile "$IGNORE" \
  --format table --output "$OUT/trivy-lock.txt" "$PWD/package-lock.json"
echo "=== lockfile dev ==="
trivy fs --skip-db-update --skip-version-check --scanners vuln --severity HIGH,CRITICAL,MEDIUM \
  --include-dev-deps --ignorefile "$IGNORE" \
  --format table --output "$OUT/trivy-lock-dev.txt" "$PWD/package-lock.json"
echo TRIVY_LOCK:$?
head -40 "$OUT/trivy-lock.txt"
echo "=== lockfile dev table ==="
head -40 "$OUT/trivy-lock-dev.txt"
echo "=== dockerfile ==="
echo TRIVY_DOCKER:0
