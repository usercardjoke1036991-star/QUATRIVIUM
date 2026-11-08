from pathlib import Path
t = Path("/root/cyber-scans/2026-09-16-validate/zap-health.html").read_text(encoding="utf-8", errors="replace")
for marker in ("Alert Detail", "Alerts", "CSP", "Content Security", "X-Content", "Missing"):
    i = t.find(marker)
    print("MARK", marker, i)
i = t.find("Alert Detail")
print("---DETAIL---")
print(t[i:i+5000] if i >= 0 else t[-4000:])
