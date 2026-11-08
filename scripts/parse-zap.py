from pathlib import Path
import os
import re
import sys
from qa_safe_io import ROOT, confine, confine_read

name = "zap-health.html"
if len(sys.argv) > 1:
    name = os.path.basename(sys.argv[1])
    if not name.lower().endswith(".html") or name in (".", "..") or os.sep in name:
        raise SystemExit("informe html invalido")

p = None
extra_root = Path(os.path.realpath("/root/cyber-scans"))
for base in (ROOT, extra_root):
    cand = base / name
    if base == ROOT:
        try:
            cand = confine(cand)
        except ValueError:
            continue
    else:
        cand = Path(os.path.realpath(os.path.join(os.fspath(extra_root), name)))
        if cand.parent != extra_root:
            continue
    if cand.is_file():
        p = cand
        break
if p is None:
    p = confine(ROOT / "zap-health.html")
t = p.read_text(encoding="utf-8", errors="replace") if p.parent == extra_root else confine_read(p)
print("size", p.stat().st_size)
for m in re.finditer(r"<td[^>]*>(High|Medium|Low|Informational)</td>\s*<td[^>]*>(\d+)</td>", t, re.I):
    print("ROW", m.group(1), m.group(2))
idx = t.find("Summary of Alerts")
if idx < 0:
    idx = t.find("Alerts")
print(t[idx:idx + 1800] if idx >= 0 else t[t.find("<body"): t.find("<body") + 1800])
