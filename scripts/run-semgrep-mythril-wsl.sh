#!/usr/bin/env bash
# Semgrep sobre copia en ext4 (no /mnt/c) + Mythril sobre bytecode de ejecución.
set +e
. /etc/profile.d/cyber-tools.sh 2>/dev/null || true
export PATH="/root/.foundry/bin:/root/.cyfrin/bin:/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/opt/zaproxy:/usr/bin:${PATH}"
export SEMGREP_SEND_METRICS=off
MAGNO=/mnt/c/CURSORPLANTILLA-BASE/Magno
OUT="${CYBER_OUT:-/root/cyber-scans/$(date +%F)-finish}"
export OUT
mkdir -p "$OUT" /root/magno-semgrep
echo "===== SEMGREP COPY $(date -Is) =====" | tee "$OUT/progress.txt"
rm -rf /root/magno-semgrep
mkdir -p /root/magno-semgrep
cd "$MAGNO" || exit 1
for d in contracts scripts services utils hooks components app; do
  mkdir -p "/root/magno-semgrep/$d"
  tar -C "$d" --exclude node_modules --exclude '*.map' -cf - . | tar -C "/root/magno-semgrep/$d" -xf -
done
echo COPY_DONE | tee -a "$OUT/progress.txt"

echo "===== 5 SEMGREP $(date -Is) =====" | tee -a "$OUT/progress.txt"
if command -v semgrep >/dev/null 2>&1; then
  SEMGREP_BIN=semgrep
else
  SEMGREP_BIN="python3 -m semgrep"
fi
$SEMGREP_BIN --error --quiet --metrics=off \
  --config p/javascript \
  --config p/security-audit \
  --json --output "$OUT/semgrep.json" \
  /root/magno-semgrep
SEMGREP_STATUS=$?
echo SEMGREP_EXIT:$SEMGREP_STATUS | tee -a "$OUT/progress.txt"
if [[ "$SEMGREP_STATUS" -gt 1 ]]; then
  echo "SEMGREP_DID_NOT_RUN status=$SEMGREP_STATUS" | tee -a "$OUT/progress.txt"
fi
python3 - <<'PY'
import json
import os
p = os.path.join(os.environ["OUT"], "semgrep.json")
try:
    data = json.load(open(p, encoding="utf-8"))
except Exception as e:
    print("semgrep json", e)
    raise SystemExit
results = data.get("results") or []
print("SEMGREP_FINDINGS", len(results))
for r in results[:80]:
    extra = r.get("extra") or {}
    msg = str(extra.get("message", "")).replace("\n", " ")
    print("-", extra.get("severity"), r.get("check_id"), r.get("path"), r.get("start", {}).get("line"), msg[:160])
PY

echo "===== 6 MYTHRIL $(date -Is) =====" | tee -a "$OUT/progress.txt"
[[ -x /root/.svm/0.8.24/solc-0.8.24 ]] && export SOLC=/root/.svm/0.8.24/solc-0.8.24

myth_runtime() {
  local artifact="$1" bin="$2" out="$3" timeout_s="$4" depth="$5" label="$6"
  if [[ ! -f "$artifact" ]]; then
    echo "MYTHRIL_SKIP_${label} no artifact" | tee -a "$OUT/progress.txt"
    return
  fi
  ARTIFACT="$artifact" BIN="$bin" python3 - <<'PY'
import json
import os
from pathlib import Path
data = json.loads(Path(os.environ["ARTIFACT"]).read_text(encoding="utf-8"))
code = data.get("deployedBytecode") or data.get("bytecode") or ""
if isinstance(code, dict):
    code = code.get("object", "")
code = str(code)
if not code.startswith("0x") or len(code) <= 2:
    raise SystemExit("no runtime bytecode")
Path(os.environ["BIN"]).write_text(code[2:], encoding="utf-8")
print("RUNTIME_BYTES", (len(code) - 2) // 2)
PY
  myth analyze --bin-runtime -f "$bin" \
    --execution-timeout "$timeout_s" --max-depth "$depth" 2>&1 | tee "$out"
  echo "MYTHRIL_${label}_EXIT:${PIPESTATUS[0]}" | tee -a "$OUT/progress.txt"
  if grep -qiE "Compiler not found|Traceback \(most recent" "$out" 2>/dev/null; then
    echo "MYTHRIL_${label}_DID_NOT_RUN" | tee -a "$OUT/progress.txt"
  fi
}

myth_runtime "$MAGNO/artifacts/contracts/QuatriviumCredit.sol/QuatriviumCredit.json" \
  /tmp/credit-runtime.bin "$OUT/mythril-credit.txt" 180 22 CREDIT
myth_runtime "$MAGNO/artifacts/contracts/QuatriviumLeveling.sol/QuatriviumLeveling.json" \
  /tmp/leveling-runtime.bin "$OUT/mythril-leveling.txt" 120 18 LEVELING
echo "===== SCANS_DONE $(date -Is) =====" | tee -a "$OUT/progress.txt"
