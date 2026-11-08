#!/usr/bin/env bash
set +e
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.local/bin:/root/.foundry/bin
OUT=/root/cyber-scans/2026-09-16-validate
echo SLITHER=$(slither --version 2>/dev/null || echo MISSING)
echo "=== files ==="
ls -la "$OUT" 2>/dev/null
echo "=== progress ==="
cat "$OUT/progress.txt" 2>/dev/null
echo "=== forge tail ==="
tail -40 "$OUT/forge-test.txt" 2>/dev/null
echo "=== slither tail ==="
tail -20 "$OUT/slither.txt" 2>/dev/null
echo "=== trivy head ==="
head -40 "$OUT/trivy-head.txt" 2>/dev/null
echo "=== semgrep ==="
python3 - <<'PY'
import json
from pathlib import Path
p=Path("/root/cyber-scans/2026-09-16-validate/semgrep.json")
print("semgrep_exists", p.exists())
if p.exists():
    data=json.loads(p.read_text(encoding="utf-8"))
    results=data.get("results") or []
    print("SEMGREP_FINDINGS", len(results))
    for r in results[:30]:
        extra=r.get("extra") or {}
        print(f"- {extra.get('severity')} {r.get('check_id')} {r.get('path')}:{r.get('start',{}).get('line')}")
PY
echo "=== mythril tail ==="
tail -20 "$OUT/mythril-credit.txt" 2>/dev/null
