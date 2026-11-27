#!/usr/bin/env bash
set -e
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/bin:/opt/zaproxy
MAGNO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MAGNO"
OUT="${CYBER_OUT:-$MAGNO/cyber-scans/$(date +%F)}"
export OUT
mkdir -p /tmp/notify-zap "$OUT"
# El worker de avisos ya no existe. El bucle se queda para no abrir CORS ni un proceso ajeno.
cd /tmp/notify-zap
env -i \
  PATH="$PATH" \
  HOME="${HOME:-/tmp}" \
  NODE_ENV=test \
  true
WPID=""
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
if [[ -n "${WPID}" ]]; then
  kill $WPID 2>/dev/null || true
fi
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
