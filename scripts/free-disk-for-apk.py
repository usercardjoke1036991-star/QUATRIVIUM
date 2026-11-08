"""Libera espacio: Temp residual, caches de sandbox y artefactos de Magno no usados por el APK en curso."""
from __future__ import annotations

import os
import shutil
import stat
import time
from pathlib import Path

FREED = 0
SKIPPED = 0
ERRORS = 0

KEEP_NAMES = {
    "quatrivium-release.keystore",
    "keystore.properties",
    "debug.keystore",
}


def on_rm_error(func, path, _exc):
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except OSError:
        global ERRORS
        ERRORS += 1


def size_of(path: Path) -> int:
    if path.is_file() or path.is_symlink():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    try:
        for root, dirs, files in os.walk(path, topdown=True, onerror=lambda _e: None):
            for name in files:
                fp = Path(root) / name
                try:
                    total += fp.stat().st_size
                except OSError:
                    pass
    except OSError:
        return 0
    return total


def remove_path(path: Path, reason: str) -> None:
    global FREED, SKIPPED, ERRORS
    if not path.exists() and not path.is_symlink():
        return
    if path.name in KEEP_NAMES:
        SKIPPED += 1
        print(f"SKIP keep {path}")
        return
    nbytes = size_of(path)
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path, onerror=on_rm_error)
        else:
            path.unlink(missing_ok=True)
        FREED += nbytes
        print(f"DEL {nbytes / (1024 * 1024):8.1f} MB  {reason}  {path}")
    except OSError as err:
        ERRORS += 1
        SKIPPED += 1
        print(f"BUSY {path} ({err})")


def main() -> None:
    magno = Path(__file__).resolve().parents[1]

    android_app_build = magno / "android" / "app" / "build"
    targets = [
        magno / "artifacts",
        magno / "cache",
        magno / "forge-out",
        magno / "forge-cache",
        magno / ".expo",
        magno / "coverage",
        magno / "typechain-types",
        magno / "android" / "build",
        magno / "android" / "app" / ".cxx",
        magno / "android" / ".gradle",
        android_app_build / "intermediates",
        android_app_build / "tmp",
        android_app_build / "generated",
        android_app_build / "kotlin",
        magno / "node_modules" / ".cache",
    ]
    for item in targets:
        remove_path(item, "cache")

    print(f"FREED_MB {FREED / (1024 * 1024):.1f}")
    print(f"SKIPPED {SKIPPED}")
    print(f"ERRORS {ERRORS}")
    try:
        import shutil as sh

        usage = sh.disk_usage("C:\\")
        print(f"C_FREE_MB {usage.free / (1024 * 1024):.0f}")
    except OSError:
        pass


if __name__ == "__main__":
    main()
