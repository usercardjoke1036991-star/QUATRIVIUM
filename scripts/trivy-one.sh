#!/usr/bin/env bash
set +e
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/bin
OUT=/root/cyber-scans/2026-09-16-validate
mkdir -p "$OUT"
trivy fs --skip-db-update \
  --scanners vuln,secret,misconfig \
  --skip-dirs node_modules --skip-dirs android --skip-dirs ios --skip-dirs lib \
  --skip-dirs forge-out --skip-dirs forge-cache --skip-dirs .git --skip-dirs dist --skip-dirs .expo \
  --skip-dirs artifacts --skip-dirs cache --skip-dirs coverage \
  --severity HIGH,CRITICAL,MEDIUM \
  --format table \
  --output "$OUT/trivy.txt" \
  /mnt/c/CURSORPLANTILLA-BASE/Magno
echo TRIVY_ONE_EXIT:$?
head -100 "$OUT/trivy.txt"
