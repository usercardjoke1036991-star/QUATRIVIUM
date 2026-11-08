#!/usr/bin/env bash
# Auditoría en vivo: inventario + Slither/Aderyn/Foundry/Trivy/Semgrep/Mythril.
set +e
. /etc/profile.d/cyber-tools.sh 2>/dev/null || true
export PATH="/root/.foundry/bin:/root/.cyfrin/bin:/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/opt/zaproxy:/usr/bin:${PATH}"
[[ -f /root/.cargo/env ]] && . /root/.cargo/env
export SEMGREP_SEND_METRICS=off
MAGNO=/mnt/c/CURSORPLANTILLA-BASE/Magno
# Una carpeta por día: dos auditorías distintas no se pisan los resultados.
OUT="${CYBER_OUT:-/root/cyber-scans/$(date +%F)}"
export OUT
mkdir -p "$OUT"
cd "$MAGNO" || exit 1

# CYBER_STAGES="trivy semgrep mythril" repite solo esas etapas sin rehacer las lentas.
STAGES="${CYBER_STAGES:-aderyn forge slither trivy semgrep mythril}"
want() {
  case " $STAGES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

{
  echo "===== TOOLS $(date -Is) ====="
  echo -n "node: "; node --version 2>/dev/null || echo MISSING
  echo -n "slither: "; (slither --version || python3 -m slither --version) 2>/dev/null || echo MISSING
  echo -n "aderyn: "; aderyn --version 2>/dev/null || echo MISSING
  echo -n "trivy: "; trivy --version 2>/dev/null | head -1 || echo MISSING
  echo -n "semgrep: "; (semgrep --version || python3 -m semgrep --version) 2>/dev/null || echo MISSING
  echo -n "myth: "; myth version 2>/dev/null | head -1 || echo MISSING
  echo -n "forge: "; forge --version 2>/dev/null | head -1 || echo MISSING
  echo -n "zap: "; ls /opt/zaproxy/zap.sh 2>/dev/null || echo MISSING
  echo -n "java: "; java -version 2>&1 | head -1
  df -h / /mnt/c | cat
} | tee "$OUT/tools.txt"

if want aderyn; then
echo "===== 1 ADERYN $(date -Is) =====" | tee -a "$OUT/progress.txt"
aderyn "$MAGNO" \
  -s contracts \
  -x mocks,Groth16Verifier,QuatriviumCreditHarness,lib/,node_modules/,forge-out/,forge-cache/,zk-contracts/,test/,forge-test/,artifacts/,cache/ \
  -o "$OUT/aderyn-report.md"
echo ADERYN_EXIT:$? | tee -a "$OUT/progress.txt"
sed -n '1,160p' "$OUT/aderyn-report.md" 2>/dev/null | tee "$OUT/aderyn-head.txt"
fi

if want forge; then
echo "===== 2 FORGE $(date -Is) =====" | tee -a "$OUT/progress.txt"
forge test --fuzz-runs 256 2>&1 | tee "$OUT/forge-test.txt"
echo FORGE_TEST_EXIT:${PIPESTATUS[0]} | tee -a "$OUT/progress.txt"
forge lint 2>&1 | tee "$OUT/forge-lint.txt"
echo FORGE_LINT_EXIT:${PIPESTATUS[0]} | tee -a "$OUT/progress.txt"
fi

if want slither; then
echo "===== 3 SLITHER $(date -Is) =====" | tee -a "$OUT/progress.txt"
bash "$MAGNO/scripts/run-slither-wsl.sh" --json "$OUT/slither.json" 2>&1 | tee "$OUT/slither.txt"
echo SLITHER_EXIT:${PIPESTATUS[0]} | tee -a "$OUT/progress.txt"
fi

if want trivy; then
echo "===== 4 TRIVY $(date -Is) =====" | tee -a "$OUT/progress.txt"
# `trivy fs` acepta UNA ruta: pasarle varias imprime la ayuda y no escanea nada.
# Y apuntarlo a la raíz sobre /mnt/c tarda decenas de minutos. Objetivos concretos.
: > "$OUT/trivy.txt"
trivy_step() {
  local label="$1"; shift
  echo "--- trivy $label ---" >> "$OUT/trivy.txt"
  trivy "$@" --format table --output "$OUT/trivy-$label.txt" 2>&1 | tail -n 5
  local status=$?
  cat "$OUT/trivy-$label.txt" >> "$OUT/trivy.txt" 2>/dev/null
  echo "TRIVY_${label}_EXIT:$status" | tee -a "$OUT/progress.txt"
  if grep -qE "^Usage:" "$OUT/trivy-$label.txt" 2>/dev/null; then
    echo "TRIVY_${label}_DID_NOT_RUN" | tee -a "$OUT/progress.txt"
  fi
}
trivy_step deps fs --skip-db-update --scanners vuln \
  --severity HIGH,CRITICAL,MEDIUM "$MAGNO/package-lock.json"
trivy_step docker config --skip-check-update \
  --severity HIGH,CRITICAL,MEDIUM "$MAGNO/Dockerfile.notify"
trivy_step secrets fs --skip-db-update --scanners secret \
  --severity HIGH,CRITICAL,MEDIUM "$MAGNO/scripts"
sed -n '1,180p' "$OUT/trivy.txt" | tee "$OUT/trivy-head.txt"
fi

if want semgrep; then
echo "===== 5 SEMGREP $(date -Is) =====" | tee -a "$OUT/progress.txt"
run_semgrep() {
  if command -v semgrep >/dev/null 2>&1; then
    semgrep "$@"
  else
    python3 -m semgrep "$@"
  fi
}
# Sin p/solidity: ese pack no existe en el registro y hace salir a Semgrep con 7 sin correr nada.
# Solidity ya lo cubren Slither, Aderyn y Mythril.
run_semgrep --error --quiet --metrics=off \
  --config p/javascript \
  --config p/security-audit \
  --exclude node_modules --exclude android --exclude ios --exclude lib \
  --exclude forge-out --exclude forge-cache --exclude artifacts --exclude cache \
  --exclude coverage --exclude .expo \
  --json --output "$OUT/semgrep.json" \
  "$MAGNO/contracts" "$MAGNO/scripts" "$MAGNO/services" "$MAGNO/utils" \
  "$MAGNO/hooks" "$MAGNO/components" "$MAGNO/app"
SEMGREP_STATUS=$?
echo SEMGREP_EXIT:$SEMGREP_STATUS | tee -a "$OUT/progress.txt"
# 0 = sin hallazgos, 1 = con hallazgos. Cualquier otro código significa que no analizó:
# "0 hallazgos" ahí sería un verde falso.
if [[ "$SEMGREP_STATUS" -gt 1 ]]; then
  echo "SEMGREP_DID_NOT_RUN status=$SEMGREP_STATUS" | tee -a "$OUT/progress.txt"
fi
python3 - <<'PY' || true
import json
import os
p=os.path.join(os.environ["OUT"], "semgrep.json")
try:
    data=json.load(open(p,encoding="utf-8"))
except Exception as e:
    print("semgrep json", e)
    raise SystemExit
results=data.get("results") or []
print("SEMGREP_FINDINGS", len(results))
for r in results[:50]:
    extra=r.get("extra") or {}
    print(f"- {extra.get('severity')} {r.get('check_id')} {r.get('path')}:{r.get('start',{}).get('line')} {str(extra.get('message',''))[:140]}")
PY
fi

if want mythril; then
echo "===== 6 MYTHRIL $(date -Is) =====" | tee -a "$OUT/progress.txt"
# Sobre bytecode de ejecución, no sobre fuente: `myth analyze artifact.json` exige solc en PATH
# y aquí solc solo existe dentro de .svm de Foundry.
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
fi

echo "===== SCANS_DONE $(date -Is) =====" | tee -a "$OUT/progress.txt"
