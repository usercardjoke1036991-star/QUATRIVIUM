"""
io_utf8.py - subprocess.run con UTF-8 explícito
===============================================
Evita UnicodeDecodeError en Windows (cp1252) cuando un proceso hijo
imprime emojis u otros caracteres UTF-8.

No reemplaza sys.stdout (ERR-003). Usar reconfigure() en los scripts CLI.
"""

import subprocess


def run_utf8(cmd, **kwargs):
    """
    Wrapper de subprocess.run con encoding=utf-8 y errors=replace.

    Por defecto captura stdout/stderr en texto. El caller puede pasar
    cwd, timeout, check, env u otros kwargs de subprocess.run.
    """
    kwargs.setdefault("capture_output", True)
    kwargs.setdefault("text", True)
    kwargs.setdefault("encoding", "utf-8")
    kwargs.setdefault("errors", "replace")
    try:
        return subprocess.run(cmd, **kwargs)
    except (OSError, subprocess.SubprocessError):
        raise
