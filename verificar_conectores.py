"""
verificar_conectores.py - Detector de Conectores Sueltos
=========================================================
Detecta referencias en el código que apuntan a algo que no existe o
no funciona funcionalmente (análisis estático, sin ejecutar código).

Tipos de conectores detectados:
  Python : - import de función/nombre que no existe en el módulo local
           - llamada a función no definida en ningún archivo del proyecto
  Node/React: - import/require de ruta relativa que no existe como archivo
              - handler JSX (onClick, etc.) no definido en el componente
  MQL5  : - llamada a función no definida en el archivo

Uso:
    python verificar_conectores.py              # Analiza el directorio actual
    python verificar_conectores.py /ruta/       # Analiza una ruta específica
    python verificar_conectores.py --json       # Output JSON
"""

import ast
import builtins
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional

from qa_safe_io import under_root

# Forzar UTF-8 en Windows
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ─────────────────────────────────────────────
# CONSTANTES GLOBALES
# ─────────────────────────────────────────────

_DIRS_EXCLUIDOS = {
    ".venv", "venv", "__pycache__", "node_modules", "dist", "build",
    ".pytest_cache", ".mypy_cache", ".git", ".cursor", ".github",
    "site-packages", ".gradle", "cache", "artifacts", ".cxx", "CMakeFiles",
    "coverage", "typechain-types", "typechain", ".cache",
    ".next", ".nuxt", ".turbo", "out", "DerivedData", "Pods",
    ".expo", ".ruff_cache",
}

# ─────────────────────────────────────────────
# Caché de subproyectos (misma lógica que qa_autonomo.py)
# ─────────────────────────────────────────────
_SUBPROYECTO_CACHE: dict[str, frozenset] = {}


def _subproyectos_inmediatos(raiz: Path) -> frozenset:
    """Retorna subdirectorios de primer nivel que tienen su propio .git (subproyectos)."""
    clave = str(raiz)
    if clave not in _SUBPROYECTO_CACHE:
        raices = frozenset(
            d for d in raiz.iterdir()
            if d.is_dir() and (d / ".git").exists()
        )
        _SUBPROYECTO_CACHE[clave] = raices
    return _SUBPROYECTO_CACHE[clave]

# Builtins y stdlib comunes de Python que NO se marcan como "indefinidos"
# Se usa el módulo builtins para obtener TODOS los builtins reales de Python
_IGNORAR_PYTHON: frozenset = frozenset(
    dir(builtins)  # Todos los builtins reales (print, len, frozenset, divmod, etc.)
    + [
        # Typing comunes
        "Optional", "Union", "List", "Dict", "Set", "Tuple", "Any",
        "Callable", "Generator", "Iterator", "Iterable", "Sequence",
        "Type", "ClassVar", "Final", "Literal", "TypeVar",
        # Decoradores y clases especiales
        "dataclass", "field", "abstractmethod",
        # Pytest
        "pytest", "fixture", "parametrize", "mark", "raises",
        # Módulos importados como nombres (se ignoran)
        "os", "sys", "re", "json", "ast", "io", "Path", "subprocess",
        "datetime", "date", "timedelta", "time", "math", "random",
        "collections", "itertools", "functools", "contextlib",
        "threading", "multiprocessing", "asyncio", "logging",
        "shutil", "glob", "tempfile", "hashlib", "base64", "copy",
        "dataclasses", "abc", "enum", "typing", "pathlib", "importlib",
        # MQL5 builtins frecuentes
        "OnTick", "OnInit", "OnDeinit", "OrderSend", "Print", "Alert",
        "NormalizeDouble", "MathRound", "StringLen", "ArraySize",
        # Nombres especiales Python
        "__name__", "__file__", "__doc__", "__init__", "__main__",
        "__all__", "__version__", "__author__",
        # Comunes en tests y fixtures
        "capsys", "tmp_path", "monkeypatch", "mocker",
        # Callbacks comunes como parámetros (patrones frecuentes)
        "fn", "callback", "func", "handler", "on_done", "on_error",
        "on_success", "on_complete", "on_cancel", "on_close",
        "on_toggle", "on_clear", "on_edit", "on_status", "on_pending_fill",
        "on_auto_close", "submit_fn", "execute_exit", "execute_add",
        "is_closing", "function",
    ]
)

# Extensiones JS/TS que se consideran al resolver imports de Node
_JS_EXTENSIONES = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]


# ─────────────────────────────────────────────
# ESTRUCTURAS DE DATOS
# ─────────────────────────────────────────────

def _conector(tipo: str, archivo: str, linea: int, mensaje: str, severidad: str = "roto") -> dict:
    """Crea un dict que representa un conector detectado."""
    return {
        "tipo": tipo,
        "archivo": archivo,
        "linea": linea,
        "mensaje": mensaje,
        "severidad": severidad,  # "roto" | "sospechoso"
    }


# ─────────────────────────────────────────────
# UTILIDADES DE SISTEMA DE ARCHIVOS
# ─────────────────────────────────────────────

def _iterar_py(directorio: Path) -> list[Path]:
    """Itera archivos .py en el proyecto evitando directorios excluidos y subproyectos."""
    resultado = []
    # Nombres de subproyectos directos (primer nivel con su propio .git)
    nombres_subproyecto = {p.name for p in _subproyectos_inmediatos(directorio)}
    excluir = _DIRS_EXCLUIDOS | nombres_subproyecto
    for dirpath, dirnames, filenames in os.walk(str(directorio)):
        dirnames[:] = [
            d for d in dirnames
            if d not in excluir and not d.startswith("Auditoria")
        ]
        for fname in filenames:
            if fname.endswith(".py"):
                resultado.append(Path(dirpath) / fname)
    return resultado


def _iterar_js(directorio: Path) -> list[Path]:
    """Itera archivos JS/TS en el proyecto evitando directorios excluidos y subproyectos."""
    resultado = []
    ext = {".js", ".jsx", ".ts", ".tsx"}
    nombres_subproyecto = {p.name for p in _subproyectos_inmediatos(directorio)}
    excluir = _DIRS_EXCLUIDOS | nombres_subproyecto
    for dirpath, dirnames, filenames in os.walk(str(directorio)):
        dirnames[:] = [
            d for d in dirnames
            if d not in excluir and not d.startswith("Auditoria")
        ]
        for fname in filenames:
            if Path(fname).suffix in ext:
                resultado.append(Path(dirpath) / fname)
    return resultado


def _iterar_mql(directorio: Path) -> list[Path]:
    """Itera archivos MQL4/MQL5 en el proyecto evitando subproyectos."""
    resultado = []
    nombres_subproyecto = {p.name for p in _subproyectos_inmediatos(directorio)}
    excluir = _DIRS_EXCLUIDOS | nombres_subproyecto
    for dirpath, dirnames, filenames in os.walk(str(directorio)):
        dirnames[:] = [
            d for d in dirnames
            if d not in excluir and not d.startswith("Auditoria")
        ]
        for fname in filenames:
            if fname.endswith((".mq5", ".mq4", ".mqh")):
                resultado.append(Path(dirpath) / fname)
    return resultado


def _leer(archivo: Path) -> Optional[str]:
    """Lee un archivo de forma segura, retorna None si falla."""
    try:
        return archivo.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None


def _ruta_relativa(archivo: Path, raiz: Path) -> str:
    """Retorna la ruta relativa del archivo respecto a la raíz del proyecto."""
    try:
        return str(archivo.relative_to(raiz))
    except ValueError:
        return str(archivo)


# ─────────────────────────────────────────────
# MÓDULO 1: ANÁLISIS PYTHON
# ─────────────────────────────────────────────

def _parse_safe(codigo: str) -> Optional[ast.Module]:
    """Parsea código Python de forma segura, retorna None si hay SyntaxError."""
    try:
        return ast.parse(codigo)
    except SyntaxError:
        return None


def _nombres_definidos_en_modulo(codigo: str) -> set[str]:
    """
    Extrae todos los nombres definidos a nivel de módulo en un archivo Python:
    funciones, clases, variables de módulo, imports, alias y variables de bucle.
    Incluye targets de `for`/`async for` para no marcar `verificador()` como
    conector suelto cuando es una variable local del loop (falso positivo ERR-008).
    """
    tree = _parse_safe(codigo)
    if tree is None:
        return set()

    nombres: set[str] = set()
    for nodo in ast.walk(tree):
        if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            nombres.add(nodo.name)
        elif isinstance(nodo, ast.Assign):
            for target in nodo.targets:
                nombres |= _nombres_de_target(target)
        elif isinstance(nodo, (ast.For, ast.AsyncFor)):
            nombres |= _nombres_de_target(nodo.target)
        elif isinstance(nodo, ast.Import):
            for alias in nodo.names:
                nombres.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(nodo, ast.ImportFrom):
            for alias in nodo.names:
                nombres.add(alias.asname or alias.name)
        elif isinstance(nodo, ast.AnnAssign):
            if isinstance(nodo.target, ast.Name):
                nombres.add(nodo.target.id)
    return nombres


def _nombres_de_target(target: ast.AST) -> set[str]:
    """Extrae nombres de un target AST (Name, Tuple, List)."""
    nombres: set[str] = set()
    if isinstance(target, ast.Name):
        nombres.add(target.id)
    elif isinstance(target, (ast.Tuple, ast.List)):
        for elt in target.elts:
            nombres |= _nombres_de_target(elt)
    return nombres


def _recopilar_nombres_proyecto(archivos_py: list[Path]) -> set[str]:
    """
    Recopila TODOS los nombres definidos en todos los archivos Python del proyecto.
    Usado como base de referencia para detectar llamadas a funciones indefinidas.
    """
    todos: set[str] = set()
    for archivo in archivos_py:
        codigo = _leer(archivo)
        if codigo:
            todos |= _nombres_definidos_en_modulo(codigo)
    return todos


def _es_submodulo_local(ruta_modulo: Path, nombre: str) -> bool:
    """True si `from paquete import nombre` apunta a un .py o paquete real."""
    if not nombre.isidentifier():
        return False
    if ruta_modulo.name != "__init__.py":
        return False
    base = ruta_modulo.parent
    try:
        return (
            (base / f"{nombre}.py").is_file()
            or (base / nombre / "__init__.py").is_file()
        )
    except OSError:
        return False


def _resolver_modulo_local(modulo: str, desde_archivo: Path, raiz: Path) -> Optional[Path]:
    """
    Intenta resolver un nombre de módulo a un archivo .py local.
    Retorna la ruta del archivo si existe, None si es externo o no encontrado.
    """
    # Convertir puntos a separadores de ruta
    ruta_rel = modulo.replace(".", os.sep) + ".py"
    # Buscar desde la raíz del proyecto
    try:
        candidato_raiz = under_root(raiz, ruta_rel.replace("\\", "/"))
    except ValueError:
        candidato_raiz = None
    if candidato_raiz and candidato_raiz.exists():
        return candidato_raiz
    # Buscar desde el directorio del archivo origen
    candidato_local = desde_archivo.parent / ruta_rel
    if candidato_local.exists():
        return candidato_local
    # Paquete (directorio con __init__.py)
    ruta_pkg = modulo.replace(".", os.sep)
    for base in [raiz, desde_archivo.parent]:
        init = base / ruta_pkg / "__init__.py"
        if init.exists():
            return init
    return None


def detectar_imports_rotos(archivo: Path, raiz: Path) -> list[dict]:
    """
    Encuentra imports de funciones/nombres que no existen en el módulo local.
    Solo verifica módulos que se pueden resolver como archivos .py del proyecto.
    Imports externos (pip/stdlib) se marcan como sospechosos, nunca rotos.
    """
    codigo = _leer(archivo)
    if not codigo:
        return []

    tree = _parse_safe(codigo)
    if tree is None:
        return []

    conectores = []
    rel = _ruta_relativa(archivo, raiz)

    for nodo in ast.walk(tree):
        if not isinstance(nodo, ast.ImportFrom):
            continue

        modulo = nodo.module or ""
        # Saltar imports relativos de paquete (from . import X) — difícil de resolver
        if nodo.level > 0:
            continue
        # Saltar si no hay módulo
        if not modulo:
            continue

        # Intentar resolver como módulo local
        ruta_modulo = _resolver_modulo_local(modulo, archivo, raiz)
        if ruta_modulo is None:
            # No es un módulo local conocido → sospechoso (puede ser pip/stdlib)
            continue

        # El módulo existe localmente: verificar si los nombres importados están definidos
        codigo_modulo = _leer(ruta_modulo)
        if not codigo_modulo:
            continue

        nombres_en_modulo = _nombres_definidos_en_modulo(codigo_modulo)

        for alias in nodo.names:
            nombre = alias.name
            if nombre == "*":
                continue  # star import, no se puede verificar estáticamente
            if nombre in nombres_en_modulo:
                continue
            if _es_submodulo_local(ruta_modulo, nombre):
                continue
            conectores.append(_conector(
                tipo="import_roto_python",
                archivo=rel,
                linea=nodo.lineno,
                mensaje=(
                    f"'from {modulo} import {nombre}' — "
                    f"'{nombre}' no está definido en {ruta_modulo.name}"
                ),
                severidad="roto",
            ))

    return conectores


def _recopilar_parametros_funciones(tree: ast.Module) -> set[str]:
    """
    Extrae todos los nombres de parámetros de todas las funciones del árbol AST.
    Estos nombres son llamables dentro de sus funciones (callbacks, etc.) y no
    deben marcarse como conectores rotos.
    """
    params: set[str] = set()
    for nodo in ast.walk(tree):
        if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for arg in nodo.args.args + nodo.args.posonlyargs + nodo.args.kwonlyargs:
                params.add(arg.arg)
            if nodo.args.vararg:
                params.add(nodo.args.vararg.arg)
            if nodo.args.kwarg:
                params.add(nodo.args.kwarg.arg)
    return params


def detectar_llamadas_sin_definicion(archivo: Path, raiz: Path,
                                      nombres_proyecto: set[str]) -> list[dict]:
    """
    Encuentra llamadas a funciones simples (no métodos) que no están definidas
    en ningún archivo Python del proyecto ni son builtins conocidos.
    Conservador por diseño: solo marca 'sospechoso', nunca 'roto'.
    Respeta parámetros de función como nombres válidos (evita falsos positivos de callbacks).
    """
    codigo = _leer(archivo)
    if not codigo:
        return []

    tree = _parse_safe(codigo)
    if tree is None:
        return []

    # Nombres locales definidos en ESTE archivo (funciones, vars, clases)
    nombres_locales = _nombres_definidos_en_modulo(codigo)
    # Parámetros de función (callbacks, etc.) — son válidos como callables
    parametros = _recopilar_parametros_funciones(tree)
    # Nombres importados en este archivo
    nombres_importados: set[str] = set()
    for nodo in ast.walk(tree):
        if isinstance(nodo, ast.Import):
            for alias in nodo.names:
                nombres_importados.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(nodo, ast.ImportFrom):
            for alias in nodo.names:
                if alias.name != "*":
                    nombres_importados.add(alias.asname or alias.name)

    # Todos los nombres "conocidos" en el contexto
    conocidos = (
        _IGNORAR_PYTHON | nombres_proyecto | nombres_locales
        | nombres_importados | parametros
    )

    conectores = []
    rel = _ruta_relativa(archivo, raiz)

    for nodo in ast.walk(tree):
        if not isinstance(nodo, ast.Call):
            continue
        # Solo llamadas simples: f() — NO obj.metodo() ni obj[i]()
        if not isinstance(nodo.func, ast.Name):
            continue
        nombre = nodo.func.id
        # Ignorar nombres privados/dunder
        if nombre.startswith("_"):
            continue
        # Ignorar builtins y conocidos
        if nombre in conocidos:
            continue
        # Ignorar MAYÚSCULAS (constantes tratadas como callables)
        if nombre.isupper():
            continue

        # Conservador: siempre marca como 'sospechoso' (no 'roto')
        # porque Python es muy dinámico y los falsos positivos son comunes
        conectores.append(_conector(
            tipo="llamada_sin_definicion_python",
            archivo=rel,
            linea=nodo.lineno,
            mensaje=f"Llamada a '{nombre}()' — función no encontrada en el proyecto",
            severidad="sospechoso",
        ))

    return conectores


# ─────────────────────────────────────────────
# MÓDULO 2: ANÁLISIS NODE / REACT
# ─────────────────────────────────────────────

# Extensiones que se prueban al resolver un import relativo de JS
_JS_RESOLVE_ORDER = [
    "",          # exacto
    ".js", ".jsx", ".ts", ".tsx", ".mjs",
    "/index.js", "/index.jsx", "/index.ts", "/index.tsx",
]


def _resolver_import_js(ruta_import: str, desde_archivo: Path) -> Optional[Path]:
    """
    Intenta resolver una ruta de import JS relativa a un archivo existente.
    Retorna la ruta si existe, None si no se encuentra.
    """
    if not ruta_import.startswith("."):
        return None  # Import absoluto/módulo externo: no verificable estáticamente

    base = (desde_archivo.parent / ruta_import).resolve()
    for ext in _JS_RESOLVE_ORDER:
        candidato = Path(str(base) + ext)
        if candidato.is_file():
            return candidato
        # Si ruta_import ya tiene extensión, solo probar exacto
        if Path(ruta_import).suffix:
            break
    return None


def detectar_imports_js_rotos(archivo: Path, raiz: Path) -> list[dict]:
    """
    Detecta imports/require de rutas relativas que no existen como archivo.
    Solo verifica rutas que empiezan con './' o '../'.
    """
    codigo = _leer(archivo)
    if not codigo:
        return []

    conectores = []
    rel = _ruta_relativa(archivo, raiz)

    # Detectar: import X from './ruta'  |  import './ruta'  |  import type X from './ruta'
    patron_import_side = re.compile(
        r"""import\s+['"](\.[^'"]{1,240})['"]""",
        re.MULTILINE,
    )
    patron_import = re.compile(
        r"""import\s+(?:type\s+)?[\w{},*\s]{1,120}\s+from\s+['"](\.[^'"]{1,240})['"]""",
        re.MULTILINE,
    )
    # Detectar: require('./ruta')
    patron_require = re.compile(r"""require\s*\(\s*['"](\.[^'"]+)['"]\s*\)""")

    for linea_num, linea in enumerate(codigo.splitlines(), 1):
        for patron in (patron_import_side, patron_import, patron_require):
            for m in patron.finditer(linea):
                ruta_import = m.group(1)
                if _resolver_import_js(ruta_import, archivo) is None:
                    conectores.append(_conector(
                        tipo="import_roto_js",
                        archivo=rel,
                        linea=linea_num,
                        mensaje=f"import de '{ruta_import}' — archivo no encontrado",
                        severidad="roto",
                    ))

    return conectores


def _nombres_js_definidos(codigo: str) -> set[str]:
    """Nombres locales JS/TS: const/function, destructuring y imports."""
    nombres: set[str] = set()
    for m in re.finditer(
        r"(?:^|\s)(?:const|let|var|function|class)\s+(\w+)",
        codigo,
        re.MULTILINE,
    ):
        nombres.add(m.group(1))
    for m in re.finditer(r"(?:const|let|var)\s*\{([^}]+)\}", codigo):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if part.startswith("..."):
                rest = part.lstrip(".").strip()
                if rest.isidentifier():
                    nombres.add(rest)
                continue
            if ":" in part:
                alias = part.split(":")[-1].split("=")[0].strip()
                if alias.isidentifier():
                    nombres.add(alias)
            else:
                name = part.split("=")[0].strip()
                if name.isidentifier():
                    nombres.add(name)
    for m in re.finditer(r"\(\s*\{([^}]+)\}", codigo):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part or part.startswith("..."):
                rest = part.lstrip(".").strip()
                if rest.isidentifier():
                    nombres.add(rest)
                continue
            if ":" in part:
                alias = part.split(":")[-1].split("=")[0].strip()
                if alias.isidentifier():
                    nombres.add(alias)
            else:
                name = part.split("=")[0].strip()
                if name.isidentifier():
                    nombres.add(name)
    for m in re.finditer(r"(?:const|let|var)\s*\[([^\]]+)\]", codigo):
        for part in m.group(1).split(","):
            name = part.strip()
            if name.startswith("..."):
                name = name.lstrip(".").strip()
            if name.isidentifier():
                nombres.add(name)
    patron_import_nombre = re.compile(
        r"""import\s+(?:type\s+)?\{([\w\s,]{1,200})\}\s+from"""
    )
    for m in patron_import_nombre.finditer(codigo):
        for nombre in re.split(r"[,\s]+", m.group(1)):
            if nombre.strip() and nombre.strip() not in {"type", "from"}:
                nombres.add(nombre.strip())
    return nombres


def detectar_handlers_jsx_sin_definir(archivo: Path, raiz: Path) -> list[dict]:
    """
    Detecta handlers JSX (onClick, onChange, onSubmit, etc.) que referencian
    nombres no definidos en el mismo archivo como const/function/let/var.
    """
    codigo = _leer(archivo)
    if not codigo:
        return []

    rel = _ruta_relativa(archivo, raiz)
    conectores = []
    nombres_definidos = _nombres_js_definidos(codigo)

    # Handlers JSX: onClick={X}, onChange={X}, onSubmit={X}, etc.
    patron_handler = re.compile(
        r"""on[A-Z]\w*\s*=\s*\{(\w+)\}"""
    )

    for linea_num, linea in enumerate(codigo.splitlines(), 1):
        for m in patron_handler.finditer(linea):
            handler = m.group(1)
            # Ignorar expresiones complejas que empiecen con this, props, etc.
            if handler in {"true", "false", "null", "undefined"}:
                continue
            if handler not in nombres_definidos:
                conectores.append(_conector(
                    tipo="handler_jsx_sin_definir",
                    archivo=rel,
                    linea=linea_num,
                    mensaje=(
                        f"Handler '{handler}' referenciado en JSX "
                        f"pero no definido en el componente"
                    ),
                    severidad="roto",
                ))

    return conectores


def detectar_rutas_api_js(archivo: Path, raiz: Path) -> list[dict]:
    """
    Detecta llamadas a fetch('/api/...') o axios.*('/api/...') para
    revisión manual — no puede verificarse estáticamente si la ruta existe en backend.
    """
    codigo = _leer(archivo)
    if not codigo:
        return []

    rel = _ruta_relativa(archivo, raiz)
    conectores = []

    patron = re.compile(
        r"""(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*['"`]([^'"`]+)['"`]""",
        re.IGNORECASE
    )

    for linea_num, linea in enumerate(codigo.splitlines(), 1):
        for m in patron.finditer(linea):
            ruta = m.group(1)
            if ruta.startswith("/api/") or ruta.startswith("api/"):
                conectores.append(_conector(
                    tipo="ruta_api_js",
                    archivo=rel,
                    linea=linea_num,
                    mensaje=f"fetch/axios a '{ruta}' — verificar que esta ruta existe en el backend",
                    severidad="sospechoso",
                ))

    return conectores


# ─────────────────────────────────────────────
# MÓDULO 3: ANÁLISIS MQL5
# ─────────────────────────────────────────────

def _obtener_funciones_mql(codigo: str) -> set[str]:
    """
    Extrae nombres de funciones definidas en código MQL4/MQL5.
    Patrón: tipo_retorno NombreFuncion(...) { — a nivel de módulo.
    """
    # Funciones MQL: tipo retorno (word), nombre (word), paréntesis
    # Excluir 'if', 'while', 'for', 'switch' como falsos positivos
    patron = re.compile(
        r"""^\s*(?:void|int|double|bool|string|datetime|color|long|ulong|short|ushort|char|uchar|float)\s+(\w+)\s*\(""",
        re.MULTILINE
    )
    _KEYWORDS_MQL = {"OnTick", "OnInit", "OnDeinit", "OnStart", "OnTimer",
                     "OnChartEvent", "OnTrade", "OnTradeTransaction", "OnBookEvent"}
    nombres = set(m.group(1) for m in patron.finditer(codigo))
    nombres |= _KEYWORDS_MQL
    return nombres


def _obtener_llamadas_mql(codigo: str) -> list[tuple[int, str]]:
    """
    Extrae llamadas a funciones en código MQL (nombre seguido de paréntesis).
    Retorna lista de (línea, nombre).
    """
    patron = re.compile(r"""\b([A-Za-z_]\w+)\s*\(""")
    # Palabras clave MQL que no son llamadas
    _NO_LLAMADAS = {
        "if", "else", "while", "for", "switch", "return", "case",
        "void", "int", "double", "bool", "string", "datetime", "class", "struct",
    }
    resultado = []
    for linea_num, linea in enumerate(codigo.splitlines(), 1):
        for m in patron.finditer(linea):
            nombre = m.group(1)
            if nombre not in _NO_LLAMADAS:
                resultado.append((linea_num, nombre))
    return resultado


# Funciones predefinidas MQL5 (subset de las más comunes — no exhaustivo)
_BUILTINS_MQL5 = frozenset([
    "OrderSend", "OrderClose", "OrderModify", "OrderSelect", "OrdersTotal",
    "OrderProfit", "OrderLots", "OrderType", "OrderSymbol", "OrderMagicNumber",
    "OrderOpenPrice", "OrderStopLoss", "OrderTakeProfit",
    "PositionSelect", "PositionGetDouble", "PositionGetInteger", "PositionGetString",
    "PositionGetTicket", "PositionsTotal",
    "NormalizeDouble", "MathRound", "MathAbs", "MathMax", "MathMin",
    "MathFloor", "MathCeil", "MathSqrt", "MathPow", "MathLog", "MathExp",
    "StringLen", "StringSubstr", "StringFind", "StringToDouble", "StringToInteger",
    "DoubleToString", "IntegerToString", "TimeToString", "StringFormat",
    "ArraySize", "ArrayResize", "ArrayCopy", "ArrayFill", "ArraySort",
    "iTime", "iOpen", "iHigh", "iLow", "iClose", "iVolume", "iBarShift",
    "iBars", "iMA", "iRSI", "iMACD", "iATR", "iBands", "iStochastic",
    "CopyTime", "CopyOpen", "CopyHigh", "CopyLow", "CopyClose",
    "SymbolInfoDouble", "SymbolInfoInteger", "SymbolInfoString",
    "AccountInfoDouble", "AccountInfoInteger", "AccountInfoString",
    "MarketInfo", "Ask", "Bid", "Digits", "Point",
    "GetLastError", "ResetLastError", "SetIndexBuffer",
    "Print", "Alert", "Comment", "MessageBox",
    "TimeCurrent", "TimeLocal", "TimeGMT",
    "ChartID", "ChartSymbol", "ChartPeriod",
    "EventSetTimer", "EventKillTimer",
    "Sleep", "RefreshRates",
    "OnTick", "OnInit", "OnDeinit", "OnStart", "OnTimer",
    "OnChartEvent", "OnTrade", "OnTradeTransaction",
    "new", "delete",
])


def detectar_conectores_mql(archivo: Path, raiz: Path) -> list[dict]:
    """
    Detecta llamadas a funciones no definidas en archivos MQL4/MQL5.
    Verifica solo dentro del mismo archivo (no cruza #include de forma semántica).
    """
    codigo = _leer(archivo)
    if not codigo:
        return []

    rel = _ruta_relativa(archivo, raiz)
    funciones_definidas = _obtener_funciones_mql(codigo)
    llamadas = _obtener_llamadas_mql(codigo)

    # Recopilar includes del archivo para no marcar sus funciones como indefinidas
    # (análisis superficial: solo registrar que hay includes)
    tiene_includes = "#include" in codigo

    conectores = []
    reportadas: set[str] = set()  # Evitar duplicados por función

    for linea_num, nombre in llamadas:
        if nombre in _BUILTINS_MQL5:
            continue
        if nombre in funciones_definidas:
            continue
        if nombre in reportadas:
            continue
        # Si tiene #include, no podemos saber qué funciones trae → sospechoso
        severidad = "sospechoso" if tiene_includes else "roto"
        reportadas.add(nombre)
        conectores.append(_conector(
            tipo="llamada_sin_definicion_mql5",
            archivo=rel,
            linea=linea_num,
            mensaje=(
                f"Llamada a '{nombre}()' — no definida en el archivo"
                + (" (puede venir de #include)" if tiene_includes else "")
            ),
            severidad=severidad,
        ))

    return conectores


# ─────────────────────────────────────────────
# ORQUESTADOR PRINCIPAL
# ─────────────────────────────────────────────

def verificar_conectores(directorio: str) -> dict:
    """
    Ejecuta la verificación de conectores sueltos en el directorio dado.
    Detecta el tipo de proyecto automáticamente.

    Retorna:
        dict con claves 'rotos', 'sospechosos', 'verificados', 'tipo_proyecto'
    """
    d = Path(directorio).resolve()
    rotos: list[dict] = []
    sospechosos: list[dict] = []
    verificados_count = 0

    # Detectar tipo de proyecto
    tiene_py = bool(list(d.glob("*.py")) or list(d.glob("src/*.py")))
    tiene_js = bool((d / "package.json").exists())
    tiene_mql = bool(list(d.glob("*.mq5")) + list(d.glob("*.mq4")) +
                     list(d.glob("src/*.mq5")) + list(d.glob("src/*.mq4")))

    tipo = "desconocido"
    if tiene_mql:
        tipo = "mql5"
    elif tiene_js:
        tipo = "node"
    elif tiene_py:
        tipo = "python"

    # ── Análisis Python ──────────────────────────────────────────
    if tiene_py or tipo == "python":
        archivos_py = _iterar_py(d)
        nombres_proyecto = _recopilar_nombres_proyecto(archivos_py)

        for archivo in archivos_py:
            # Imports rotos
            resultado_imports = detectar_imports_rotos(archivo, d)
            for c in resultado_imports:
                (rotos if c["severidad"] == "roto" else sospechosos).append(c)

            # Llamadas sin definición (solo en archivos no de tests para reducir falsos)
            if "test_" not in archivo.name and "_test" not in archivo.name:
                resultado_llamadas = detectar_llamadas_sin_definicion(
                    archivo, d, nombres_proyecto
                )
                for c in resultado_llamadas:
                    (rotos if c["severidad"] == "roto" else sospechosos).append(c)

            verificados_count += 1

    # ── Análisis Node/React ──────────────────────────────────────
    if tiene_js:
        archivos_js = _iterar_js(d)

        for archivo in archivos_js:
            # Imports de archivos que no existen
            resultado_imports = detectar_imports_js_rotos(archivo, d)
            for c in resultado_imports:
                (rotos if c["severidad"] == "roto" else sospechosos).append(c)

            # Handlers JSX sin definir (solo en archivos .jsx/.tsx)
            if archivo.suffix in {".jsx", ".tsx"}:
                resultado_handlers = detectar_handlers_jsx_sin_definir(archivo, d)
                for c in resultado_handlers:
                    (rotos if c["severidad"] == "roto" else sospechosos).append(c)

            # Rutas de API (sospechosos)
            resultado_api = detectar_rutas_api_js(archivo, d)
            for c in resultado_api:
                sospechosos.append(c)

            verificados_count += 1

    # ── Análisis MQL5 ────────────────────────────────────────────
    if tiene_mql:
        archivos_mql = _iterar_mql(d)

        for archivo in archivos_mql:
            resultado = detectar_conectores_mql(archivo, d)
            for c in resultado:
                (rotos if c["severidad"] == "roto" else sospechosos).append(c)
            verificados_count += 1

    return {
        "tipo_proyecto": tipo,
        "directorio": str(d),
        "rotos": rotos,
        "sospechosos": sospechosos,
        "verificados": verificados_count,
    }


# ─────────────────────────────────────────────
# GENERADOR DE REPORTE
# ─────────────────────────────────────────────

def imprimir_reporte(resultado: dict, formato_json: bool = False):
    """Imprime el reporte de conectores en formato legible o JSON."""
    if formato_json:
        print(json.dumps(resultado, ensure_ascii=False, indent=2))
        return

    rotos = resultado["rotos"]
    sospechosos = resultado["sospechosos"]
    verificados = resultado["verificados"]

    print("\n🔗 VERIFICACIÓN DE CONECTORES")
    print("═" * 60)
    print(f"  Proyecto: {resultado['tipo_proyecto'].upper()}")
    print(f"  Directorio: {resultado['directorio']}")
    print("═" * 60)

    if rotos:
        print(f"\n❌ CONECTORES ROTOS ({len(rotos)}):")
        for c in rotos:
            print(f"  [{c['archivo']}:{c['linea']}] {c['mensaje']}")

    if sospechosos:
        print(f"\n⚠️  CONECTORES SOSPECHOSOS ({len(sospechosos)}):")
        for c in sospechosos:
            print(f"  [{c['archivo']}:{c['linea']}] {c['mensaje']}")

    if not rotos and not sospechosos:
        print("\n✅ No se detectaron conectores sueltos")

    print(f"\n✅ REFERENCIAS VERIFICADAS EN: {verificados} archivo(s)")
    print("═" * 60 + "\n")

    if rotos:
        print("💡 Tip: Los conectores ROTOS son referencias que claramente apuntan a algo que no existe.")
    if sospechosos:
        print("💡 Tip: Los SOSPECHOSOS requieren verificación manual — el análisis estático tiene limitaciones.")


# ─────────────────────────────────────────────
# PUNTO DE ENTRADA
# ─────────────────────────────────────────────

def main():
    """Entry point del script."""
    args = sys.argv[1:]
    formato_json = "--json" in args
    args = [a for a in args if a != "--json"]

    directorio = args[0] if args else os.getcwd()

    if not os.path.isdir(directorio):
        print(f"❌ El directorio '{directorio}' no existe.")
        sys.exit(1)

    resultado = verificar_conectores(directorio)
    imprimir_reporte(resultado, formato_json)

    # Exit code no-cero si hay conectores rotos
    sys.exit(1 if resultado["rotos"] else 0)


if __name__ == "__main__":
    main()
