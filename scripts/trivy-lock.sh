#!/usr/bin/env bash
set +e
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/bin
OUT=/root/cyber-scans/2026-09-16-validate
MAGNO=/mnt/c/CURSORPLANTILLA-BASE/Magno
mkdir -p "$OUT"
echo "=== lockfile prod ==="
trivy fs --skip-db-update --skip-version-check --scanners vuln --severity HIGH,CRITICAL,MEDIUM \
  --ignorefile "$MAGNO/.trivyignore" \
  --format table --output "$OUT/trivy-lock.txt" "$MAGNO/package-lock.json"
echo "=== lockfile dev ==="
trivy fs --skip-db-update --skip-version-check --scanners vuln --severity HIGH,CRITICAL,MEDIUM \
  --include-dev-deps --ignorefile "$MAGNO/.trivyignore" \
  --format table --output "$OUT/trivy-lock-dev.txt" "$MAGNO/package-lock.json"
echo TRIVY_LOCK:$?
head -40 "$OUT/trivy-lock.txt"
echo "=== lockfile dev table ==="
head -40 "$OUT/trivy-lock-dev.txt"
echo "=== dockerfile ==="
trivy config --skip-check-update --severity HIGH,CRITICAL,MEDIUM \
  --format table --output "$OUT/trivy-docker.txt" "$MAGNO/Dockerfile.notify"
echo TRIVY_DOCKER:$?
cat "$OUT/trivy-docker.txt"
echo "=== render.yaml ==="
trivy config --skip-check-update --severity HIGH,CRITICAL,MEDIUM \
  --format table --output "$OUT/trivy-render.txt" "$MAGNO/render.yaml" 2>/dev/null || true
echo TRIVY_RENDER:$?
head -40 "$OUT/trivy-render.txt" 2>/dev/null
