"""
verificar_modulos.py - Verificador de módulos y modales UI
==========================================================
Complementa verificar_conectores.py y detectar_logica.py (no los duplica).

A) Módulos: docs CONTEXTO/VISION vs disco, imports relativos rotos,
   submódulos de paquetes locales, #include MQL5, exports de index,
   __init__.py ausente, docstrings de módulo, ciclos A→B→A.

B) Modales UI (JS/JSX/TS/TSX/HTML): cierre, Escape, overlay, a11y, open={true}.
   En Python/MQL5 sin archivos UI: 0 hallazgos (no-op).

Uso:
    python verificar_modulos.py
    python verificar_modulos.py /ruta/
    python verificar_modulos.py --json
    python verificar_modulos.py /ruta/ --tipo node --json
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

from qa_safe_io import resto_bullet_estado, under_root

# Forzar UTF-8 en Windows (ERR-003: reconfigure + hasattr, no TextIOWrapper)
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ─────────────────────────────────────────────
# CONSTANTES
# ─────────────────────────────────────────────

_DIRS_EXCLUIDOS = {
    ".venv", "venv", "__pycache__", "node_modules", "dist", "build",
    ".pytest_cache", ".mypy_cache", ".git", ".cursor", ".github",
    "site-packages",
    "cache", "artifacts", ".cxx", "CMakeFiles",
    "coverage", "typechain-types", "typechain", ".cache",
    ".next", ".nuxt", ".turbo", "out", "DerivedData", "Pods",
}

_SCRIPTS_PLANTILLA = {
    "crear_proyecto.py", "qa_autonomo.py", "sincronizar_plantilla.py",
    "aprender_error.py", "actualizar_contexto.py", "verificar_conectores.py",
    "detectar_logica.py", "vision_proyecto.py", "actualizar_readme.py",
    "memoria_proyecto.py", "reestructurar_peticion.py", "run_tests.py",
    "verificar_modulos.py",
    "mapa_proyecto.py",
}

_EXT_PY = {".py"}
_EXT_JS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
_EXT_UI = {".js", ".jsx", ".ts", ".tsx", ".html", ".htm"}
_EXT_MQL = {".mq5", ".mq4", ".mqh"}

_JS_RESOLVE = (
    "", ".js", ".jsx", ".ts", ".tsx", ".mjs",
    "/index.js", "/index.jsx", "/index.ts", "/index.tsx",
)

# Extensiones largas primero para no cortar .json como .js
_RE_ARCHIVO_DOC = re.compile(
    r"(?<![\w./])("
    r"[A-Za-z0-9][A-Za-z0-9_.-]{0,80}(?:/[A-Za-z0-9_.-]{1,80}){0,8}"
    r"\.(?:json|jsx|tsx|mjs|cjs|mq5|mq4|mqh|java|kts|mdc|yaml|yml|py|js|ts|kt)"
    r")(?![\w])"
)
_RE_DIR_DOC = re.compile(
    r"(?<![\w./])(src/|tests/|test/|app/|lib/|include/|Include/)(?![\w])"
)
_RE_ARBOL = re.compile(
    r"[├└]──\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(?:json|jsx|tsx|mq5|mq4|mqh|py|js|ts))"
)
_RE_INCLUDE_MQL = re.compile(r'#include\s+"([^"]+\.mqh)"')
_RE_EXPORT_FROM = re.compile(
    r"""export\s+(?:type\s+)?(?:default\s+)?from\s+['"](\.[^'"]{1,240})['"]"""
)
_RE_EXPORT_FROM_NAMED = re.compile(
    r"""export\s+[\w*\s{},]{1,120}\s+from\s+['"](\.[^'"]{1,240})['"]"""
)
_RE_EXPORT_NAMED = re.compile(r"""export\s+\{([^}]+)\}(?!\s*from)""")
_RE_NOMBRE_MODAL = re.compile(r"(Modal|Dialog|Drawer|Popup)", re.IGNORECASE)
_RE_TAG_MODAL = re.compile(r"<(Modal|Dialog|Drawer|Popup)\b")
_RE_ROLE_DIALOG = re.compile(r"""role\s*=\s*['"]dialog['"]""")
_RE_ARIA_MODAL = re.compile(r"""aria-modal\s*=""")
_RE_CIERRE = re.compile(
    r"onClose|onDismiss|onRequestClose|handleClose|"
    r"setOpen\s*\(\s*(?:false|null)\s*\)|"
    r"setIsOpen\s*\(\s*false\s*\)|Escape|"
    r"""aria-label\s*=\s*['"][^'"]*(close|cerrar)[^'"]*['"]"""
    r"|>\s*(Cerrar|Close|×|✕|✖)\s*<",
    re.IGNORECASE,
)
_RE_ESCAPE_KEY = re.compile(r"\bEscape\b|onKeyDown|keydown", re.IGNORECASE)
_RE_OVERLAY = re.compile(r"overlay|backdrop|scrim", re.IGNORECASE)
_RE_OPEN_TRUE = re.compile(
    r"\b(open|isOpen|visible|show)\s*=\s*\{\s*true\s*\}"
)
_RE_SETTER_OPEN = re.compile(r"\bset(Open|IsOpen|Visible|Show)\b")

try:
    _STDLIB = set(sys.stdlib_module_names)  # type: ignore[attr-defined]
except AttributeError:
    _STDLIB = {
        "os", "sys", "re", "json", "ast", "io", "pathlib", "typing",
        "collections", "itertools", "functools", "subprocess", "tempfile",
        "shutil", "glob", "math", "random", "datetime", "time", "copy",
        "dataclasses", "abc", "enum", "importlib", "logging", "hashlib",
        "base64", "argparse", "unittest", "traceback", "warnings",
    }

_SUBPROYECTO_CACHE: dict[str, frozenset] = {}
_CACHE_TEXTO: dict[str, Optional[str]] = {}
_CACHE_AST: dict[str, Optional[ast.Module]] = {}


def _limpiar_caches() -> None:
    """Limpia caches de una corrida (evita fugas entre tests)."""
    _CACHE_TEXTO.clear()
    _CACHE_AST.clear()


# ─────────────────────────────────────────────
# UTILIDADES
# ─────────────────────────────────────────────

def _hallazgo(
    categoria: str,
    tipo: str,
    archivo: str,
    linea: int,
    mensaje: str,
    severidad: str,
) -> dict:
    """Crea un dict de hallazgo (módulos o modales)."""
    return {
        "categoria": categoria,
        "tipo": tipo,
        "archivo": archivo,
        "linea": linea,
        "mensaje": mensaje,
        "severidad": severidad,
    }


def _subproyectos_inmediatos(raiz: Path) -> frozenset:
    """Subdirectorios de primer nivel con .git propio (ERR-004)."""
    clave = str(raiz)
    if clave not in _SUBPROYECTO_CACHE:
        try:
            raices = frozenset(
                d for d in raiz.iterdir()
                if d.is_dir() and (d / ".git").exists()
            )
        except OSError:
            raices = frozenset()
        _SUBPROYECTO_CACHE[clave] = raices
    return _SUBPROYECTO_CACHE[clave]


def _nombres_excluidos(raiz: Path) -> set:
    """Directorios a podar: cache, venv y subproyectos independientes."""
    return set(_DIRS_EXCLUIDOS) | {p.name for p in _subproyectos_inmediatos(raiz)}


def _leer(archivo: Path) -> Optional[str]:
    """Lee un archivo UTF-8; None si falla el I/O. Cache por ruta."""
    clave = str(archivo)
    if clave in _CACHE_TEXTO:
        return _CACHE_TEXTO[clave]
    try:
        texto = archivo.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        texto = None
    _CACHE_TEXTO[clave] = texto
    return texto


def _ruta_relativa(archivo: Path, raiz: Path) -> str:
    """Ruta relativa al proyecto, o absoluta si no es hija."""
    try:
        return str(archivo.relative_to(raiz))
    except ValueError:
        return str(archivo)


def _inventariar(raiz: Path) -> dict:
    """Una sola pasada: agrupa archivos por tipo y registra nombres."""
    inventario = {
        "py": [],
        "js": [],
        "mql": [],
        "ui": [],
        "nombres": set(),
        "rutas_rel": set(),
    }
    excluir = _nombres_excluidos(raiz)
    try:
        for dirpath, dirnames, filenames in os.walk(str(raiz)):
            dirnames[:] = [
                d for d in dirnames
                if d not in excluir and not d.startswith("Auditoria")
            ]
            dp = Path(dirpath)
            for fname in filenames:
                f = dp / fname
                suf = f.suffix.lower()
                rel = _ruta_relativa(f, raiz).replace("\\", "/")
                inventario["nombres"].add(fname)
                inventario["rutas_rel"].add(rel)
                if suf in _EXT_PY:
                    inventario["py"].append(f)
                if suf in _EXT_JS:
                    inventario["js"].append(f)
                if suf in _EXT_MQL:
                    inventario["mql"].append(f)
                if suf in _EXT_UI:
                    inventario["ui"].append(f)
    except OSError:
        pass
    return inventario


def detectar_tipo_proyecto(directorio: str) -> str:
    """Autodetecta python | node | mql5 | android (misma idea que el kit)."""
    d = Path(directorio)
    try:
        if (d / "build.gradle").exists() or (d / "build.gradle.kts").exists():
            return "android"
        if (d / "AndroidManifest.xml").exists():
            return "android"
        if (list(d.glob("*.mq5")) or list(d.glob("*.mq4"))
                or list(d.glob("src/*.mq5")) or list(d.glob("src/*.mq4"))):
            return "mql5"
        if (d / "package.json").exists():
            return "node"
        if (list(d.glob("*.jsx")) or list(d.glob("*.tsx"))
                or list(d.glob("src/*.jsx")) or list(d.glob("src/*.tsx"))
                or list(d.glob("*.html"))):
            return "node"
        if (list(d.glob("*.py")) or (d / "requirements.txt").exists()
                or (d / "pyproject.toml").exists()):
            return "python"
    except OSError:
        pass
    return "desconocido"


def _parse_safe(codigo: str) -> Optional[ast.Module]:
    """Parsea Python; None si hay SyntaxError. Cache por id del texto."""
    clave = str(id(codigo)) + ":" + str(len(codigo))
    if clave in _CACHE_AST:
        return _CACHE_AST[clave]
    try:
        tree = ast.parse(codigo)
    except SyntaxError:
        tree = None
    _CACHE_AST[clave] = tree
    return tree


# ─────────────────────────────────────────────
# A) MÓDULOS DOCUMENTADOS (CONTEXTO / VISION)
# ─────────────────────────────────────────────

def _extraer_modulos_documentados(texto: str) -> list[tuple[str, int]]:
    """Nombres de archivo/carpeta en líneas ✅/🔄, árbol y tabla de módulos."""
    hallados: list[tuple[str, int]] = []
    vistos: set[str] = set()
    en_tabla_modulos = False

    for num, linea in enumerate(texto.splitlines(), 1):
        strip = linea.strip()
        if strip.startswith("##"):
            en_tabla_modulos = ("Módulos" in strip) or ("Modulos" in strip)

        candidatos: list[str] = []
        resto_est = resto_bullet_estado(linea)
        if resto_est:
            resto = resto_est.strip().strip("`")
            primer = re.split(r"[\s—–]+", resto, maxsplit=1)[0].strip("`")
            if primer and (Path(primer).suffix or primer.endswith("/") or "/" in primer):
                candidatos.append(primer)
            candidatos.extend(t.group(1) for t in _RE_ARCHIVO_DOC.finditer(resto))
            candidatos.extend(t.group(1) for t in _RE_DIR_DOC.finditer(resto))
        for m in _RE_ARBOL.finditer(linea):
            candidatos.append(m.group(1))
        if en_tabla_modulos and "|" in linea:
            for m in _RE_ARCHIVO_DOC.finditer(linea):
                candidatos.append(m.group(1))

        for raw in candidatos:
            nombre = raw.strip().strip("`").replace("\\", "/")
            if (
                not nombre
                or "*" in nombre
                or nombre.startswith(".")
                or nombre in vistos
            ):
                continue
            vistos.add(nombre)
            hallados.append((nombre, num))
    return hallados


def detectar_modulos_documentados_ausentes(
    raiz: Path, inventario: Optional[dict] = None
) -> list[dict]:
    """Módulos listados en CONTEXTO.md / VISION.md que no existen en disco."""
    hallazgos: list[dict] = []
    for doc_name in ("CONTEXTO.md", "VISION.md"):
        ruta = under_root(raiz, doc_name)
        if not ruta.is_file():
            continue
        texto = _leer(ruta)
        if not texto:
            continue
        for nombre, linea in _extraer_modulos_documentados(texto):
            if _existe_en_disco(raiz, nombre, inventario):
                continue
            hallazgos.append(_hallazgo(
                categoria="modulos",
                tipo="modulo_documentado_ausente",
                archivo=doc_name,
                linea=linea,
                mensaje=(
                    f"Módulo '{nombre}' listado en {doc_name} "
                    f"no existe en disco"
                ),
                severidad="critico",
            ))
    return hallazgos


def _existe_en_disco(
    raiz: Path, nombre: str, inventario: Optional[dict] = None
) -> bool:
    """True si el path, carpeta o basename existe (usa inventario, sin re-walk)."""
    limpio = nombre.strip().rstrip("/").replace("\\", "/")
    if not limpio:
        return True
    try:
        if (raiz / nombre).exists() or (raiz / limpio).exists():
            return True
    except OSError:
        pass
    base_doc = Path(limpio).name
    for extra in (
        raiz / ".cursor" / "rules" / base_doc,
        raiz / ".cursor" / "hooks" / base_doc,
        raiz / ".github" / "workflows" / base_doc,
    ):
        try:
            if extra.exists():
                return True
        except OSError:
            continue
    if inventario:
        base = Path(limpio).name
        if base in inventario.get("nombres", set()):
            return True
        if limpio in inventario.get("rutas_rel", set()):
            return True
        if any(
            r == limpio or r.endswith("/" + limpio) or r.startswith(limpio + "/")
            for r in inventario.get("rutas_rel", set())
        ):
            return True
    return False


# ─────────────────────────────────────────────
# A) IMPORTS RELATIVOS Y SUBMÓDULOS LOCALES
# ─────────────────────────────────────────────

def detectar_imports_relativos_rotos(archivo: Path, raiz: Path) -> list[dict]:
    """
    Hueco vs verificar_conectores: from .pkg import / from . import X
    cuando el destino no existe. No copia el chequeo de nombres importados.
    """
    codigo = _leer(archivo)
    if not codigo:
        return []
    tree = _parse_safe(codigo)
    if tree is None:
        return []

    rel = _ruta_relativa(archivo, raiz)
    hallazgos: list[dict] = []
    for nodo in ast.walk(tree):
        if not isinstance(nodo, ast.ImportFrom) or nodo.level <= 0:
            continue
        base = archivo.parent
        for _ in range(nodo.level - 1):
            base = base.parent
        modulo = nodo.module or ""
        if modulo:
            dest = base / modulo.replace(".", os.sep)
            existe = (
                dest.with_suffix(".py").is_file()
                or (dest / "__init__.py").is_file()
                or dest.is_dir()
            )
            etiqueta = "." * nodo.level + modulo
        else:
            nombres = [a.name for a in nodo.names if a.name != "*"]
            if not nombres:
                continue
            existe = all(
                (base / f"{n}.py").is_file() or (base / n).is_dir()
                for n in nombres
            )
            etiqueta = "." * nodo.level + (", ".join(nombres))
        if existe:
            continue
        hallazgos.append(_hallazgo(
            categoria="modulos",
            tipo="import_relativo_ausente",
            archivo=rel,
            linea=getattr(nodo, "lineno", 0),
            mensaje=f"Import relativo '{etiqueta}' — destino no existe en disco",
            severidad="critico",
        ))
    return hallazgos


def detectar_submodulos_paquete_ausentes(archivo: Path, raiz: Path) -> list[dict]:
    """
    Hueco: from pkg.sub import X cuando pkg/ existe localmente pero sub no.
    verificar_conectores omite el módulo si no resuelve el archivo completo.
    """
    codigo = _leer(archivo)
    if not codigo:
        return []
    tree = _parse_safe(codigo)
    if tree is None:
        return []

    rel = _ruta_relativa(archivo, raiz)
    hallazgos: list[dict] = []
    for nodo in ast.walk(tree):
        if not isinstance(nodo, ast.ImportFrom) or nodo.level > 0:
            continue
        modulo = nodo.module or ""
        if "." not in modulo:
            continue
        cabeza, resto = modulo.split(".", 1)
        if cabeza in _STDLIB:
            continue
        pkg = None
        for base in (raiz, archivo.parent):
            cand = base / cabeza
            if cand.is_dir():
                pkg = cand
                break
        if pkg is None:
            continue
        dest = pkg / resto.replace(".", os.sep)
        if dest.with_suffix(".py").is_file() or (dest / "__init__.py").is_file():
            continue
        if dest.is_dir():
            continue
        hallazgos.append(_hallazgo(
            categoria="modulos",
            tipo="submodulo_local_ausente",
            archivo=rel,
            linea=getattr(nodo, "lineno", 0),
            mensaje=(
                f"'from {modulo} import …' — el paquete '{cabeza}/' existe "
                f"pero '{resto}' no está en disco"
            ),
            severidad="critico",
        ))
    return hallazgos


def detectar_init_faltante(archivo: Path, raiz: Path) -> list[dict]:
    """Aviso: from pkg import … y pkg/ existe sin __init__.py (namespace)."""
    codigo = _leer(archivo)
    if not codigo:
        return []
    tree = _parse_safe(codigo)
    if tree is None:
        return []

    rel = _ruta_relativa(archivo, raiz)
    hallazgos: list[dict] = []
    vistos: set[str] = set()
    for nodo in ast.walk(tree):
        if not isinstance(nodo, ast.ImportFrom) or nodo.level > 0:
            continue
        modulo = (nodo.module or "").split(".")[0]
        if not modulo or modulo in _STDLIB or modulo in vistos:
            continue
        pkg = None
        for base in (raiz, archivo.parent):
            cand = base / modulo
            if cand.is_dir():
                pkg = cand
                break
        if pkg is None:
            continue
        if (pkg / "__init__.py").is_file():
            continue
        vistos.add(modulo)
        hallazgos.append(_hallazgo(
            categoria="modulos",
            tipo="init_py_faltante",
            archivo=rel,
            linea=getattr(nodo, "lineno", 0),
            mensaje=(
                f"Paquete '{modulo}/' se importa como paquete pero no tiene "
                f"__init__.py (namespace implícito; aviso, no crítico)"
            ),
            severidad="advertencia",
        ))
    return hallazgos


def detectar_docstring_modulo_faltante(archivo: Path, raiz: Path) -> list[dict]:
    """Aviso: .py en src/ o raíz (no scripts de plantilla) sin docstring."""
    if archivo.name in _SCRIPTS_PLANTILLA:
        return []
    if archivo.name.startswith("test_") or archivo.name.endswith("_test.py"):
        return []
    if archivo.name == "conftest.py":
        return []
    try:
        padre = archivo.parent.resolve()
        raiz_r = raiz.resolve()
    except OSError:
        return []
    if padre not in (raiz_r, raiz_r / "src"):
        return []

    codigo = _leer(archivo)
    if not codigo:
        return []
    tree = _parse_safe(codigo)
    if tree is None:
        return []
    if ast.get_docstring(tree):
        return []
    return [_hallazgo(
        categoria="modulos",
        tipo="docstring_modulo_faltante",
        archivo=_ruta_relativa(archivo, raiz),
        linea=1,
        mensaje=f"'{archivo.name}' no tiene docstring de módulo",
        severidad="advertencia",
    )]


# ─────────────────────────────────────────────
# A) CICLOS A → B → A
# ─────────────────────────────────────────────

def _indice_modulos_py(archivos: list[Path], raiz: Path) -> dict[str, Path]:
    """Mapa nombre.punteado → archivo (nombres cortos solo si son únicos)."""
    largos: dict[str, Path] = {}
    cortos: dict[str, list[Path]] = {}
    for f in archivos:
        try:
            rel = f.resolve().relative_to(raiz.resolve())
        except ValueError:
            continue
        partes = list(rel.with_suffix("").parts)
        if partes and partes[-1] == "__init__":
            partes = partes[:-1]
        if not partes:
            continue
        clave = ".".join(partes)
        largos[clave] = f
        cortos.setdefault(partes[-1], []).append(f)
    indice = dict(largos)
    for corto, rutas in cortos.items():
        if len(rutas) == 1 and corto not in indice:
            indice[corto] = rutas[0]
    return indice


def _imports_locales_py(
    archivo: Path, indice: dict[str, Path]
) -> set[Path]:
    """Archivos locales referenciados por import / from (no stdlib)."""
    codigo = _leer(archivo)
    if not codigo:
        return set()
    tree = _parse_safe(codigo)
    if tree is None:
        return set()
    destinos: set[Path] = set()
    for nodo in ast.walk(tree):
        nombres: list[str] = []
        if isinstance(nodo, ast.Import):
            nombres = [a.name for a in nodo.names]
        elif isinstance(nodo, ast.ImportFrom) and nodo.level == 0 and nodo.module:
            nombres = [nodo.module]
        for nombre in nombres:
            cabeza = nombre.split(".")[0]
            if cabeza in _STDLIB:
                continue
            destino = indice.get(nombre) or indice.get(cabeza)
            if destino is not None and destino.resolve() != archivo.resolve():
                destinos.add(destino.resolve())
    return destinos


def detectar_ciclos_simples(archivos: list[Path], raiz: Path) -> list[dict]:
    """Dependencias circulares simples A→B→A (aviso / crítico suave)."""
    indice = _indice_modulos_py(archivos, raiz)
    grafo: dict[Path, set[Path]] = {}
    for f in archivos:
        grafo[f.resolve()] = _imports_locales_py(f, indice)

    hallazgos: list[dict] = []
    vistos: set[tuple[str, str]] = set()
    for a, destinos in grafo.items():
        for b in destinos:
            if a in grafo.get(b, set()):
                par = tuple(sorted((str(a), str(b))))
                if par in vistos:
                    continue
                vistos.add(par)
                hallazgos.append(_hallazgo(
                    categoria="modulos",
                    tipo="dependencia_circular",
                    archivo=_ruta_relativa(a, raiz),
                    linea=1,
                    mensaje=(
                        f"Dependencia circular simple: "
                        f"{a.name} ⇄ {b.name} (A→B→A)"
                    ),
                    severidad="advertencia",
                ))
    return hallazgos


# ─────────────────────────────────────────────
# A) MQL5 INCLUDES Y EXPORTS NODE
# ─────────────────────────────────────────────

def detectar_includes_mql_ausentes(archivo: Path, raiz: Path) -> list[dict]:
    """#include \"file.mqh\" que no existe (hueco: conectores no resuelve includes)."""
    codigo = _leer(archivo)
    if not codigo:
        return []
    rel = _ruta_relativa(archivo, raiz)
    hallazgos: list[dict] = []
    for num, linea in enumerate(codigo.splitlines(), 1):
        for m in _RE_INCLUDE_MQL.finditer(linea):
            inc = m.group(1).replace("\\", "/")
            candidatos = [
                archivo.parent / inc,
                raiz / inc,
                raiz / "Include" / Path(inc).name,
            ]
            if any(c.is_file() for c in candidatos):
                continue
            hallazgos.append(_hallazgo(
                categoria="modulos",
                tipo="include_mqh_ausente",
                archivo=rel,
                linea=num,
                mensaje=f'#include \"{inc}\" — archivo .mqh no encontrado',
                severidad="critico",
            ))
    return hallazgos


def _resolver_export_js(ruta_import: str, desde: Path) -> bool:
    """Resuelve export … from './x' (no el regex de import/require)."""
    if not ruta_import.startswith("."):
        return True
    base = (desde.parent / ruta_import).resolve()
    if Path(ruta_import).suffix:
        return Path(str(base)).is_file()
    for ext in _JS_RESOLVE:
        if Path(str(base) + ext).is_file():
            return True
    return False


def detectar_exports_index_rotos(archivo: Path, raiz: Path) -> list[dict]:
    """Aviso: export from './x' en index.* si el destino no existe."""
    if archivo.stem != "index":
        return []
    codigo = _leer(archivo)
    if not codigo:
        return []
    rel = _ruta_relativa(archivo, raiz)
    hallazgos: list[dict] = []
    for num, linea in enumerate(codigo.splitlines(), 1):
        for rex in (_RE_EXPORT_FROM, _RE_EXPORT_FROM_NAMED):
            for m in rex.finditer(linea):
                ruta = m.group(1)
                if _resolver_export_js(ruta, archivo):
                    continue
                hallazgos.append(_hallazgo(
                    categoria="modulos",
                    tipo="export_index_ausente",
                    archivo=rel,
                    linea=num,
                    mensaje=f"export desde '{ruta}' en index — archivo no encontrado",
                    severidad="advertencia",
                ))
        for m in _RE_EXPORT_NAMED.finditer(linea):
            nombres = [
                p.split(" as ")[0].strip()
                for p in m.group(1).split(",")
                if p.strip() and p.strip() != "default"
            ]
            for nombre in nombres:
                if re.search(rf"\b(function|class|const|let|var)\s+{re.escape(nombre)}\b", codigo):
                    continue
                if re.search(rf"\b{re.escape(nombre)}\b", codigo.replace(linea, "", 1)):
                    continue
                hallazgos.append(_hallazgo(
                    categoria="modulos",
                    tipo="export_index_nombre_ausente",
                    archivo=rel,
                    linea=num,
                    mensaje=f"export '{{ {nombre} }}' en index — nombre no definido",
                    severidad="advertencia",
                ))
    return hallazgos


# ─────────────────────────────────────────────
# B) MODALES UI
# ─────────────────────────────────────────────

def _es_candidato_modal(archivo: Path, codigo: str) -> bool:
    """Solo JS/HTML con nombre o markup de Modal/Dialog/Drawer/Popup."""
    if archivo.suffix.lower() not in _EXT_UI:
        return False
    if _RE_NOMBRE_MODAL.search(archivo.stem):
        return True
    if _RE_TAG_MODAL.search(codigo):
        return True
    if _RE_ROLE_DIALOG.search(codigo) or _RE_ARIA_MODAL.search(codigo):
        return True
    return False


def _analizar_modal(archivo: Path, raiz: Path, codigo: str) -> list[dict]:
    """Reglas de cierre, Escape, overlay, a11y y open={{true}}."""
    rel = _ruta_relativa(archivo, raiz)
    hallazgos: list[dict] = []
    es_dialog = bool(
        _RE_ROLE_DIALOG.search(codigo)
        or _RE_TAG_MODAL.search(codigo)
        or _RE_NOMBRE_MODAL.search(archivo.stem)
    )

    if not _RE_CIERRE.search(codigo):
        hallazgos.append(_hallazgo(
            categoria="modales",
            tipo="modal_sin_cierre",
            archivo=rel,
            linea=1,
            mensaje=(
                f"'{archivo.name}' parece un modal/dialog sin cierre visible "
                f"(onClose / onDismiss / handleClose / Escape / botón cerrar)"
            ),
            severidad="critico",
        ))

    if not _RE_ESCAPE_KEY.search(codigo):
        hallazgos.append(_hallazgo(
            categoria="modales",
            tipo="modal_sin_escape",
            archivo=rel,
            linea=1,
            mensaje=f"'{archivo.name}' no menciona Escape ni onKeyDown/keydown",
            severidad="advertencia",
        ))

    if es_dialog and not _RE_OVERLAY.search(codigo):
        hallazgos.append(_hallazgo(
            categoria="modales",
            tipo="modal_sin_overlay",
            archivo=rel,
            linea=1,
            mensaje=f"'{archivo.name}' es Modal/Dialog sin overlay/backdrop",
            severidad="advertencia",
        ))

    if es_dialog and not (_RE_ARIA_MODAL.search(codigo) or _RE_ROLE_DIALOG.search(codigo)):
        hallazgos.append(_hallazgo(
            categoria="modales",
            tipo="modal_sin_a11y",
            archivo=rel,
            linea=1,
            mensaje=(
                f"'{archivo.name}' es Modal/Dialog sin aria-modal ni role=dialog"
            ),
            severidad="advertencia",
        ))

    if _RE_OPEN_TRUE.search(codigo) and not _RE_SETTER_OPEN.search(codigo):
        linea_open = 1
        for i, ln in enumerate(codigo.splitlines(), 1):
            if _RE_OPEN_TRUE.search(ln):
                linea_open = i
                break
        hallazgos.append(_hallazgo(
            categoria="modales",
            tipo="modal_open_hardcodeado",
            archivo=rel,
            linea=linea_open,
            mensaje=f"'{archivo.name}' tiene open={{true}} hardcodeado sin setter",
            severidad="advertencia",
        ))
    return hallazgos


def detectar_modales_ui(
    directorio: str,
    tipo: Optional[str] = None,
    ui_files: Optional[list] = None,
) -> list[dict]:
    """
    Detecta problemas en componentes Modal/Dialog. 0 hallazgos si no hay UI.
    tipo python/mql5 sin archivos UI → no-op.
    """
    raiz = Path(directorio).resolve()
    tipo_eff = (tipo or detectar_tipo_proyecto(str(raiz))).lower()
    if ui_files is None:
        ui_files = _inventariar(raiz)["ui"]

    if tipo_eff in {"python", "mql5"} and not ui_files:
        return []
    if not ui_files:
        return []

    hallazgos: list[dict] = []
    for archivo in ui_files:
        codigo = _leer(archivo)
        if not codigo:
            continue
        if not _es_candidato_modal(archivo, codigo):
            continue
        try:
            hallazgos.extend(_analizar_modal(archivo, raiz, codigo))
        except Exception:
            continue
    return hallazgos


# ─────────────────────────────────────────────
# ORQUESTADOR
# ─────────────────────────────────────────────

def _checks_modulos(raiz: Path, tipo: str, inventario: dict) -> list[dict]:
    """Ejecuta los detectores de módulos aplicables al tipo."""
    hallazgos: list[dict] = []
    hallazgos.extend(detectar_modulos_documentados_ausentes(raiz, inventario))

    if tipo in {"python", "desconocido", "android"}:
        for archivo in inventario["py"]:
            try:
                hallazgos.extend(detectar_imports_relativos_rotos(archivo, raiz))
                hallazgos.extend(detectar_submodulos_paquete_ausentes(archivo, raiz))
                hallazgos.extend(detectar_init_faltante(archivo, raiz))
                hallazgos.extend(detectar_docstring_modulo_faltante(archivo, raiz))
            except Exception:
                continue
        try:
            hallazgos.extend(detectar_ciclos_simples(inventario["py"], raiz))
        except Exception:
            pass

    if tipo in {"mql5", "desconocido"}:
        for archivo in inventario["mql"]:
            try:
                hallazgos.extend(detectar_includes_mql_ausentes(archivo, raiz))
            except Exception:
                continue

    if tipo in {"node", "desconocido", "android"}:
        for archivo in inventario["js"]:
            try:
                hallazgos.extend(detectar_exports_index_rotos(archivo, raiz))
            except Exception:
                continue
    return hallazgos


def verificar_modulos(directorio: str, tipo: Optional[str] = None) -> dict:
    """
    Verifica módulos de código y modales UI en el directorio.

    Retorna dict con criticos, advertencias, hallazgos_modulos,
    hallazgos_modales, verificados y tipo_proyecto.
    """
    _limpiar_caches()
    raiz = Path(directorio).resolve()
    tipo_eff = (tipo or detectar_tipo_proyecto(str(raiz))).lower()
    if tipo_eff not in {"python", "node", "mql5", "android", "desconocido"}:
        tipo_eff = detectar_tipo_proyecto(str(raiz))

    inventario = _inventariar(raiz)
    hallazgos_modulos: list[dict] = []
    try:
        hallazgos_modulos = _checks_modulos(raiz, tipo_eff, inventario)
    except Exception:
        hallazgos_modulos = []

    hallazgos_modales: list[dict] = []
    try:
        hallazgos_modales = detectar_modales_ui(
            str(raiz), tipo_eff, ui_files=inventario["ui"]
        )
    except Exception:
        hallazgos_modales = []

    todos = hallazgos_modulos + hallazgos_modales
    criticos = [h for h in todos if h.get("severidad") == "critico"]
    advertencias = [h for h in todos if h.get("severidad") == "advertencia"]
    verificados = (
        len(inventario["py"]) + len(inventario["js"])
        + len(inventario["mql"]) + len(inventario["ui"])
    )

    return {
        "tipo_proyecto": tipo_eff,
        "directorio": str(raiz),
        "criticos": criticos,
        "advertencias": advertencias,
        "hallazgos_modulos": hallazgos_modulos,
        "hallazgos_modales": hallazgos_modales,
        "verificados": verificados,
        "ok": len(criticos) == 0,
    }


def imprimir_reporte(resultado: dict, formato_json: bool = False) -> None:
    """Imprime el reporte en texto o JSON."""
    if formato_json:
        print(json.dumps(resultado, ensure_ascii=False, indent=2))
        return

    print("\n📦 VERIFICACIÓN DE MÓDULOS Y MODALES")
    print("═" * 60)
    print(f"  Proyecto: {resultado['tipo_proyecto'].upper()}")
    print(f"  Directorio: {resultado['directorio']}")
    print("═" * 60)

    criticos = resultado.get("criticos") or []
    advertencias = resultado.get("advertencias") or []

    if criticos:
        print(f"\n❌ CRÍTICOS ({len(criticos)}):")
        for h in criticos:
            print(f"  [{h['archivo']}:{h['linea']}] {h['mensaje']}")

    if advertencias:
        print(f"\n⚠️  AVISOS ({len(advertencias)}):")
        for h in advertencias:
            print(f"  [{h['archivo']}:{h['linea']}] {h['mensaje']}")

    if not criticos and not advertencias:
        print("\n✅ Sin problemas de módulos ni modales")

    print(f"\n✅ ARCHIVOS REVISADOS: {resultado.get('verificados', 0)}")
    print("═" * 60 + "\n")


def _parsear_argv(argv: list[str]) -> tuple[str, bool, Optional[str]]:
    """Parsea [ruta] [--json] [--tipo python|node|mql5|android]."""
    formato_json = False
    tipo: Optional[str] = None
    directorio: Optional[str] = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            formato_json = True
        elif a == "--tipo" and i + 1 < len(argv):
            i += 1
            tipo = argv[i].lower()
        elif a.startswith("--tipo="):
            tipo = a.split("=", 1)[1].lower()
        elif not a.startswith("-"):
            directorio = a
        i += 1
    return directorio or os.getcwd(), formato_json, tipo


def main(argv: Optional[list[str]] = None) -> int:
    """Entry point. Exit 0 si OK/solo avisos, 1 si hay críticos."""
    args = sys.argv[1:] if argv is None else argv
    directorio, formato_json, tipo = _parsear_argv(args)

    if not os.path.isdir(directorio):
        print(f"❌ El directorio '{directorio}' no existe.")
        return 1

    try:
        resultado = verificar_modulos(directorio, tipo=tipo)
    except Exception as e:
        print(f"⚠️ Error al verificar módulos: {e}")
        return 0

    imprimir_reporte(resultado, formato_json)
    return 1 if resultado.get("criticos") else 0


if __name__ == "__main__":
    sys.exit(main())
