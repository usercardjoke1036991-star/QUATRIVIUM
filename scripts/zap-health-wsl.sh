#!/usr/bin/env bash
set -e
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/bin:/opt/zaproxy
MAGNO=/mnt/c/CURSORPLANTILLA-BASE/Magno
cd "$MAGNO"
OUT="${CYBER_OUT:-/root/cyber-scans/$(date +%F)}"
export OUT
mkdir -p /tmp/notify-zap "$OUT"
# dotenv carga .env del cwd. El arnés corre en /tmp para no heredar Magno/.env.
cd /tmp/notify-zap
# Con `*` el propio escaneo se provoca un "Cross-Domain Misconfiguration" que en mainnet
# es imposible: el worker se niega a arrancar con comodín. Escanear la configuración real.
env -i \
  PATH="$PATH" \
  HOME=/root \
  NODE_ENV=test \
  NOTIFY_BIND=127.0.0.1 \
  PORT=8788 \
  NOTIFY_PORT=8788 \
  NOTIFY_DATA_FILE=/tmp/notify-zap/.notify-data.json \
  NOTIFY_DATA_KEY=zap-health-scan-key-32chars \
  EXPO_PUBLIC_CHAIN_ID=97 \
  EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET=0xD2d2A9eF0D1e4f253abc90Dd4ACb0E6C50B2de9f \
  NOTIFY_CORS_ORIGIN=https://quatriviumcredit.app \
  node "$MAGNO/scripts/notify-worker.mjs" >/tmp/notify-zap/out.log 2>&1 &
WPID=$!
ok=0
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8788/health >/tmp/notify-zap/health.json; then
    ok=1
    break
  fi
  sleep 1
done
echo HEALTH_OK=$ok
cat /tmp/notify-zap/health.json 2>/dev/null || true
echo
if [[ "$ok" != 1 ]]; then
  echo WORKER_LOG
  tail -n 80 /tmp/notify-zap/out.log || true
fi
/opt/zaproxy/zap.sh -cmd -quickurl http://127.0.0.1:8788/health -quickout "$OUT/zap-health.html" -quickprogress
echo ZAP_EXIT=$?
kill $WPID 2>/dev/null || true
python3 - <<'PY'
from pathlib import Path
import os
import re
p=Path(os.environ["OUT"]) / "zap-health.html"
print("ZAP_HTML", p.exists(), p.stat().st_size if p.exists() else 0)
t=p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
print("HIGH", len(re.findall(r"Risk: High", t, re.I)))
print("MED", len(re.findall(r"Risk: Medium", t, re.I)))
print("LOW", len(re.findall(r"Risk: Low", t, re.I)))
print("titles", re.findall(r"<title>(.*?)</title>", t)[:2])
for label in ["High", "Medium", "Low", "Informational"]:
    print("count", label, t.count(label))
print(t[:2000])
PY
