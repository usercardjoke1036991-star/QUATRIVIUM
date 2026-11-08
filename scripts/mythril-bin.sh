#!/usr/bin/env bash
set +e
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/bin:/root/.foundry/bin
OUT=/root/cyber-scans/2026-09-16-validate
MAGNO=/mnt/c/CURSORPLANTILLA-BASE/Magno
ART="$MAGNO/artifacts/contracts/QuatriviumCredit.sol/QuatriviumCredit.json"
python3 - <<PY
import json
from pathlib import Path
art=Path("/mnt/c/CURSORPLANTILLA-BASE/Magno/artifacts/contracts/QuatriviumCredit.sol/QuatriviumCredit.json")
data=json.loads(art.read_text(encoding="utf-8"))
code=data.get("deployedBytecode") or data.get("bytecode") or {}
hexcode=code.get("object") if isinstance(code, dict) else code
Path("/tmp/credit.bin").write_text(str(hexcode).replace("0x",""), encoding="utf-8")
print("BYTECODE_LEN", len(str(hexcode)))
PY
myth analyze -f /tmp/credit.bin --execution-timeout 180 --max-depth 22 > "$OUT/mythril-credit-bin.txt" 2>&1
echo MYTHRIL_BIN_EXIT:$?
tail -50 "$OUT/mythril-credit-bin.txt"
