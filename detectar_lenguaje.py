"""
detectar_lenguaje.py - Lenguaje adaptativo (NO es el cerebro del proyecto)
=========================================================================
Detecta el lenguaje de cualquier proyecto y extrae símbolos
(defs / fn / func / class) según la extensión del archivo.

El mapa (`mapa_proyecto.py`) y el README (`actualizar_readme.py`) USAN
este módulo. No orquesta conectores, lógica, módulos ni docs.

Uso:
    python detectar_lenguaje.py [ruta]
    python detectar_lenguaje.py [ruta] --json
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

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

TOPE_SIMBOLOS = 80

KIND_FUNCION = "funcion"
KIND_CLASE = "clase"
_KINDS_CLASE = frozenset({
    "clase", "class", "struct", "enum", "trait", "type",
    "interface", "object", "protocol", "actor", "record",
    "module", "typedef", "activity",
})

TIPOS_PROYECTO = (
    "python", "node", "mql5", "android",
    "go", "rust", "java", "csharp", "php", "ruby", "swift", "cpp",
    "otro",
)

_DIRS_EXCLUIDOS = {
    ".git", "node_modules", "__pycache__", "venv", ".venv",
    "dist", "build", ".pytest_cache", ".mypy_cache",
    "site-packages", ".cursor", ".github",
    "target", "vendor", ".gradle", "cmake-build-debug",
    "cmake-build-release", "bin", "obj",
    "cache", "artifacts", ".cxx", "CMakeFiles",
    "coverage", "typechain-types", "typechain", ".cache",
    ".next", ".nuxt", ".turbo", "out", "DerivedData", "Pods",
    ".expo", ".ruff_cache",
}

EXT_PY = {".py"}
EXT_JS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
EXT_MQL = {".mq5", ".mq4", ".mqh"}
EXT_AND = {".java", ".kt"}
EXT_RUST = {".rs"}
EXT_GO = {".go"}
EXT_CSHARP = {".cs"}
EXT_PHP = {".php"}
EXT_RUBY = {".rb"}
EXT_SWIFT = {".swift"}
EXT_C = {".c"}
EXT_CPP = {".cpp", ".cc", ".cxx"}
EXT_HDR = {".h", ".hpp", ".hh"}
EXT_SCALA = {".scala"}
EXT_LUA = {".lua"}
EXT_R = {".r"}
EXT_OBJC = {".m", ".mm"}
EXT_CODIGO = (
    EXT_PY | EXT_JS | EXT_MQL | EXT_AND | EXT_RUST | EXT_GO
    | EXT_CSHARP | EXT_PHP | EXT_RUBY | EXT_SWIFT | EXT_C
    | EXT_CPP | EXT_HDR | EXT_SCALA | EXT_LUA | EXT_R | EXT_OBJC
)

_NOMBRES_RUIDO = {
    "if", "for", "while", "switch", "return", "sizeof", "catch", "else",
    "do", "case", "goto", "new", "delete", "throw", "try", "typeof",
    "instanceof", "function", "class", "def", "fun", "func", "fn",
    "match", "select", "when", "with", "from", "import", "include",
    "typedef", "namespace", "template", "using", "const", "let", "var",
}

_RE_EXPORT_JS = re.compile(
    r"export\s+(?:async\s+)?(?:function|class|const|let|var|default)\s+(\w+)"
    r"|exports\.(\w+)\s*="
)
_RE_EXPORT_JS_FN = re.compile(
    r"export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)"
)
_RE_EXPORT_JS_CLASS = re.compile(r"export\s+(?:default\s+)?class\s+(\w+)")
_RE_EXPORT_JS_CONST = re.compile(r"export\s+(?:const|let|var)\s+(\w+)")
_RE_EXPORT_JS_COMMON = re.compile(r"exports\.(\w+)\s*=")
_RE_EXPORT_JS_DEFAULT = re.compile(r"export\s+default\s+(\w+)")
_RE_ACTIVITY = re.compile(
    r"""android:name\s*=\s*['"]([^'"]{0,180}Activity[^'"]{0,80})['"]""",
    re.IGNORECASE,
)
_RE_RUST_FN = re.compile(
    r"^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?"
    r"(?:const\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_RUST_TIPO = re.compile(
    r"^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+"
    r"([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_GO_FUNC = re.compile(
    r"^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(",
    re.MULTILINE,
)
_RE_GO_TIPO = re.compile(
    r"^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+",
    re.MULTILINE,
)
_RE_JVM_TIPO = re.compile(
    r"^\s*(?:(?:public|private|protected|internal|open|override|static|"
    r"final|abstract|sealed|data|inner|companion)\s+)*"
    r"(?:class|interface|enum|object|record|struct)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_KT_FUN = re.compile(
    r"^\s*(?:(?:public|private|protected|internal|open|override|static|"
    r"final|abstract|suspend|inline|tailrec)\s+)*fun\s+"
    r"(?:[A-Za-z_][A-Za-z0-9_.<>]*\.)?([A-Za-z_][A-Za-z0-9_]*)\s*[<(]",
    re.MULTILINE,
)
_RE_CS_MET = re.compile(
    r"^\s*(?:(?:public|private|protected|internal|static|async|partial|"
    r"sealed|abstract|virtual|override|extern|new|unsafe)\s+)+"
    r"[\w.<>\[\]?]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(",
    re.MULTILINE,
)
_RE_SWIFT_FN = re.compile(
    r"^\s*(?:(?:public|private|internal|open|fileprivate|static|override|"
    r"final|mutating|async)\s+)*"
    r"func\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_SWIFT_TIPO = re.compile(
    r"^\s*(?:(?:public|private|internal|open|fileprivate|static|override|"
    r"final|mutating|async)\s+)*"
    r"(?:class|struct|enum|protocol|actor)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_SCALA_FN = re.compile(
    r"^\s*(?:(?:private|protected|override|final|implicit|lazy|sealed|"
    r"abstract)\s+)*"
    r"def\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_SCALA_TIPO = re.compile(
    r"^\s*(?:(?:private|protected|override|final|implicit|lazy|sealed|"
    r"abstract)\s+)*"
    r"(?:class|object|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_PHP_FN = re.compile(
    r"^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*"
    r"function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_PHP_CLASE = re.compile(
    r"^\s*(?:(?:abstract|final)\s+)?(?:class|interface|trait|enum)\s+"
    r"([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_RUBY_DEF = re.compile(
    r"^\s*def\s+(?:self\.)?([A-Za-z_][A-Za-z0-9_?!]*)",
    re.MULTILINE,
)
_RE_RUBY_CLASE = re.compile(
    r"^\s*(?:class|module)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_C_CLASE = re.compile(
    r"^\s*(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b",
    re.MULTILINE,
)
_RE_C_FUNC = re.compile(
    r"^[ \t]*(?!\#)(?:(?:static|inline|extern|virtual|constexpr|"
    r"explicit)\s+)*(?:[\w:~]+(?:::[\w:~]+)*)(?:\s*\*+|\s*&+)?\s+"
    r"([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{",
    re.MULTILINE,
)
_RE_LUA = re.compile(
    r"^\s*(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_.:]*)",
    re.MULTILINE,
)
_RE_R = re.compile(
    r"^\s*([A-Za-z.][A-Za-z0-9._]*)\s*<-\s*function\s*\(",
    re.MULTILINE,
)
_RE_OBJC_TIPO = re.compile(
    r"^\s*@(?:interface|implementation|protocol)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
_RE_OBJC_MET = re.compile(
    r"^\s*[-+]\s*\([^)]+\)\s*([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)


# ─────────────────────────────────────────────
# I/O Y UTILIDADES
# ─────────────────────────────────────────────

def _leer(ruta: Path) -> Optional[str]:
    """Lee UTF-8; None si falla el I/O."""
    try:
        return Path(ruta).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None


def _como_path(ruta_archivo: Any) -> Optional[Path]:
    """Convierte str/Path a Path. None si no se puede."""
    try:
        return Path(ruta_archivo)
    except (TypeError, ValueError):
        return None


def _tope_efectivo(tope: Optional[int]) -> int:
    """Tope de símbolos por archivo (default compartido)."""
    if tope is None:
        return TOPE_SIMBOLOS
    try:
        return max(0, int(tope))
    except (TypeError, ValueError):
        return TOPE_SIMBOLOS


def hay_ext_cercana(d: Path, exts: set[str]) -> bool:
    """True si hay un archivo con esas extensiones en raíz, src, app, lib o cmd.

    Sin glob ** (ERR-004): solo un nivel en esas carpetas.
    """
    try:
        carpetas = [d, d / "src", d / "app", d / "lib", d / "cmd"]
        for carpeta in carpetas:
            if not carpeta.exists() or not carpeta.is_dir():
                continue
            for p in carpeta.iterdir():
                if p.is_file() and p.suffix.lower() in exts:
                    return True
    except OSError:
        pass
    return False


def formatear_simbolo(nombre: Any, kind: str = KIND_FUNCION) -> str:
    """Formato README uniforme: funciones `nombre()`, clases `class Nombre`.

    No duplica `()` ni el prefijo `class`. El mapa sigue listando nombres crudos.
    """
    n = str(nombre or "").strip()
    if not n:
        return ""
    if n.endswith("()"):
        return n
    if n.lower().startswith("class "):
        resto = n[6:].strip()
        return f"class {resto}" if resto else "class"
    k = str(kind or KIND_FUNCION).strip().lower()
    if k in _KINDS_CLASE:
        return f"class {n}"
    return f"{n}()"


def _unicos_etiquetados(
    items: list[tuple[str, str]], tope: int,
) -> list[tuple[str, str]]:
    """Dedup por nombre, preserva orden y kind. Filtra ruido."""
    vistos: set[str] = set()
    out: list[tuple[str, str]] = []
    for nombre, kind in items:
        if not nombre or nombre in vistos or nombre in _NOMBRES_RUIDO:
            continue
        vistos.add(nombre)
        out.append((nombre, kind or KIND_FUNCION))
        if len(out) >= tope:
            break
    return out


def _unicos_tope(nombres: list[str], tope: int) -> list[str]:
    """Dedup preservando orden; tope configurable. Filtra ruido obvio."""
    return [n for n, _ in _unicos_etiquetados(
        [(n, KIND_FUNCION) for n in nombres], tope,
    )]


def _simbolos_por_regex_etiquetados(
    texto: str,
    patrones: list[tuple[re.Pattern, str]],
    tope: int,
) -> list[tuple[str, str]]:
    """Aplica (patrón, kind) y ordena por posición en el archivo."""
    hits: list[tuple[int, str, str]] = []
    for pat, kind in patrones:
        for m in pat.finditer(texto):
            nombre = m.group(1)
            if nombre:
                hits.append((m.start(), nombre, kind))
    hits.sort(key=lambda x: x[0])
    return _unicos_etiquetados([(n, k) for _, n, k in hits], tope)


def _simbolos_por_regex(
    texto: str, patrones: list[re.Pattern], tope: int,
) -> list[str]:
    """Aplica patrones y ordena por posición en el archivo."""
    tagged = _simbolos_por_regex_etiquetados(
        texto, [(p, KIND_FUNCION) for p in patrones], tope,
    )
    return [n for n, _ in tagged]


# ─────────────────────────────────────────────
# DETECTOR DE TIPO / LENGUAJE DE ARCHIVO
# ─────────────────────────────────────────────

def lenguaje_de_archivo(ruta_archivo: Any, tipo_proyecto: str = "") -> str:
    """Lenguaje heurístico de un archivo (por extensión / nombre)."""
    ruta = _como_path(ruta_archivo)
    if ruta is None:
        return "otro"
    fname = ruta.name
    suf = ruta.suffix.lower()
    tipo = (tipo_proyecto or "").lower()
    if fname == "AndroidManifest.xml":
        return "android"
    if suf in EXT_PY:
        return "python"
    if suf in EXT_JS:
        return "node"
    if suf in EXT_MQL:
        return "mql5"
    if suf in {".java", ".kt"}:
        if tipo == "android":
            return "android"
        return "java" if suf == ".java" else "kotlin"
    if suf in EXT_RUST:
        return "rust"
    if suf in EXT_GO:
        return "go"
    if suf in EXT_CSHARP:
        return "csharp"
    if suf in EXT_PHP:
        return "php"
    if suf in EXT_RUBY:
        return "ruby"
    if suf in EXT_SWIFT:
        return "swift"
    if suf in EXT_C:
        return "c"
    if suf in EXT_CPP:
        return "cpp"
    if suf in EXT_HDR:
        return "header"
    if suf in EXT_SCALA:
        return "scala"
    if suf in EXT_LUA:
        return "lua"
    if suf in EXT_R:
        return "r"
    if suf in EXT_OBJC:
        return "objc"
    return "otro"


def _normalizar_tipo_proyecto(tipo: str) -> str:
    """Mapea tipos extra (c, scala, …) al conjunto público + extras útiles."""
    if tipo in TIPOS_PROYECTO:
        return tipo
    if tipo == "c":
        return "cpp"
    if tipo in {"scala", "lua", "r", "objc", "kotlin", "header"}:
        return "otro"
    return "otro"


def detectar_tipo_lenguaje(ruta: Any) -> str:
    """Autodetecta el lenguaje del proyecto: python|node|mql5|android|go|…

    Sin glob ** (ERR-004). Si la ruta es un archivo, usa el directorio padre.
    Extra (c/scala/lua/r/objc) se normaliza a cpp/otro para la API pública.
    """
    try:
        d = Path(ruta)
        if d.is_file():
            d = d.parent
        if not d.exists():
            return "otro"
        if (d / "build.gradle").exists() or (d / "build.gradle.kts").exists():
            return "android"
        if (d / "AndroidManifest.xml").exists():
            return "android"
        if (d / "app" / "src" / "main" / "AndroidManifest.xml").exists():
            return "android"
        mql = list(d.glob("*.mq5")) + list(d.glob("*.mq4"))
        mql += list(d.glob("src/*.mq5")) + list(d.glob("src/*.mq4"))
        if mql:
            return "mql5"
        if (d / "package.json").exists():
            return "node"
        if (d / "requirements.txt").exists() or (d / "pyproject.toml").exists():
            return "python"
        if (d / "setup.py").exists() or (d / "setup.cfg").exists():
            return "python"
        if hay_ext_cercana(d, EXT_PY):
            return "python"
        if (d / "Cargo.toml").exists() or hay_ext_cercana(d, EXT_RUST):
            return "rust"
        if (d / "go.mod").exists() or hay_ext_cercana(d, EXT_GO):
            return "go"
        if (d / "pom.xml").exists() or hay_ext_cercana(d, {".java"}):
            return "java"
        if list(d.glob("*.sln")) or list(d.glob("*.csproj")) or hay_ext_cercana(d, EXT_CSHARP):
            return "csharp"
        if (d / "composer.json").exists() or hay_ext_cercana(d, EXT_PHP):
            return "php"
        if (d / "Gemfile").exists() or hay_ext_cercana(d, EXT_RUBY):
            return "ruby"
        if (d / "Package.swift").exists() or hay_ext_cercana(d, EXT_SWIFT):
            return "swift"
        if (d / "CMakeLists.txt").exists() or hay_ext_cercana(d, EXT_CPP):
            return "cpp"
        if hay_ext_cercana(d, EXT_C):
            return "cpp"
        if (d / "build.sbt").exists() or hay_ext_cercana(d, EXT_SCALA):
            return _normalizar_tipo_proyecto("scala")
        if hay_ext_cercana(d, EXT_LUA):
            return _normalizar_tipo_proyecto("lua")
        if hay_ext_cercana(d, EXT_R):
            return _normalizar_tipo_proyecto("r")
        if hay_ext_cercana(d, EXT_OBJC):
            return _normalizar_tipo_proyecto("objc")
        if hay_ext_cercana(d, EXT_CODIGO):
            return "otro"
    except OSError:
        pass
    return "otro"


# ─────────────────────────────────────────────
# EXTRACTORES POR LENGUAJE
# ─────────────────────────────────────────────

def _simbolos_python(ruta: Path, tope: int) -> list[tuple[str, str]]:
    """defs/clases top-level vía ast."""
    texto = _leer(ruta)
    if not texto:
        return []
    try:
        tree = ast.parse(texto)
    except SyntaxError:
        return []
    items: list[tuple[str, str]] = []
    for nodo in tree.body:
        if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef)):
            items.append((nodo.name, KIND_FUNCION))
        elif isinstance(nodo, ast.ClassDef):
            items.append((nodo.name, KIND_CLASE))
    return _unicos_etiquetados(items, tope)


def _exports_js(ruta: Path, tope: int) -> list[tuple[str, str]]:
    """Exports aproximados en JS/TS."""
    texto = _leer(ruta)
    if not texto:
        return []
    tagged = _simbolos_por_regex_etiquetados(texto, [
        (_RE_EXPORT_JS_FN, KIND_FUNCION),
        (_RE_EXPORT_JS_CLASS, KIND_CLASE),
        (_RE_EXPORT_JS_CONST, KIND_FUNCION),
        (_RE_EXPORT_JS_COMMON, KIND_FUNCION),
        (_RE_EXPORT_JS_DEFAULT, KIND_FUNCION),
    ], tope)
    return [(n, k) for n, k in tagged if not n.startswith("_")]


def _handlers_mql(ruta: Path, tope: int) -> list[tuple[str, str]]:
    """Handlers OnTick/OnInit y similares."""
    texto = _leer(ruta)
    if not texto:
        return []
    nombres = re.findall(
        r"\b(OnTick|OnInit|OnDeinit|OnCalculate|OnTimer|OnTrade)\s*\(",
        texto,
    )
    return _unicos_etiquetados([(n, KIND_FUNCION) for n in nombres], tope)


def _activities_manifest(ruta: Path, tope: int) -> list[tuple[str, str]]:
    """Activities declaradas en AndroidManifest.xml."""
    texto = _leer(ruta)
    if not texto:
        return []
    return _unicos_etiquetados(
        [(n, KIND_CLASE) for n in _RE_ACTIVITY.findall(texto)], tope,
    )


def _simbolos_c_cpp(ruta: Path, tope: int) -> list[tuple[str, str]]:
    """Funciones/clases C/C++: poco y preciso (evita macros)."""
    texto = _leer(ruta)
    if not texto:
        return []
    items: list[tuple[str, str]] = []
    for m in _RE_C_CLASE.finditer(texto):
        items.append((m.group(1), KIND_CLASE))
    for m in _RE_C_FUNC.finditer(texto):
        nom = m.group(1)
        if nom.isupper():
            continue
        items.append((nom, KIND_FUNCION))
    return _unicos_etiquetados(items, tope)


def _extraer_por_lenguaje(
    ruta: Path, lenguaje: str, tope: int,
) -> list[tuple[str, str]]:
    """Despacha extractor por lenguaje. Heurística, no compilador."""
    if lenguaje == "python":
        return _simbolos_python(ruta, tope)
    if lenguaje == "node":
        return _exports_js(ruta, tope)
    if lenguaje == "mql5":
        return _handlers_mql(ruta, tope)
    if lenguaje == "android":
        if ruta.name == "AndroidManifest.xml":
            return _activities_manifest(ruta, tope)
        texto = _leer(ruta) or ""
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_JVM_TIPO, KIND_CLASE),
            (_RE_KT_FUN, KIND_FUNCION),
            (_RE_CS_MET, KIND_FUNCION),
        ], tope)
    texto = _leer(ruta)
    if not texto:
        return []
    if lenguaje == "rust":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_RUST_FN, KIND_FUNCION),
            (_RE_RUST_TIPO, KIND_CLASE),
        ], tope)
    if lenguaje == "go":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_GO_FUNC, KIND_FUNCION),
            (_RE_GO_TIPO, KIND_CLASE),
        ], tope)
    if lenguaje in {"java", "kotlin"}:
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_JVM_TIPO, KIND_CLASE),
            (_RE_KT_FUN, KIND_FUNCION),
            (_RE_CS_MET, KIND_FUNCION),
        ], tope)
    if lenguaje == "csharp":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_JVM_TIPO, KIND_CLASE),
            (_RE_CS_MET, KIND_FUNCION),
        ], tope)
    if lenguaje == "swift":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_SWIFT_FN, KIND_FUNCION),
            (_RE_SWIFT_TIPO, KIND_CLASE),
        ], tope)
    if lenguaje == "scala":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_SCALA_FN, KIND_FUNCION),
            (_RE_SCALA_TIPO, KIND_CLASE),
        ], tope)
    if lenguaje == "php":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_PHP_FN, KIND_FUNCION),
            (_RE_PHP_CLASE, KIND_CLASE),
        ], tope)
    if lenguaje == "ruby":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_RUBY_DEF, KIND_FUNCION),
            (_RE_RUBY_CLASE, KIND_CLASE),
        ], tope)
    if lenguaje in {"c", "cpp", "header"}:
        return _simbolos_c_cpp(ruta, tope)
    if lenguaje == "lua":
        return _simbolos_por_regex_etiquetados(
            texto, [(_RE_LUA, KIND_FUNCION)], tope,
        )
    if lenguaje == "r":
        return _simbolos_por_regex_etiquetados(
            texto, [(_RE_R, KIND_FUNCION)], tope,
        )
    if lenguaje == "objc":
        return _simbolos_por_regex_etiquetados(texto, [
            (_RE_OBJC_TIPO, KIND_CLASE),
            (_RE_OBJC_MET, KIND_FUNCION),
        ], tope)
    return []


def extraer_simbolos_etiquetados(
    ruta_archivo: Any,
    tope: Optional[int] = None,
    tipo_proyecto: str = "",
) -> list[tuple[str, str]]:
    """Símbolos (nombre, kind). kind es funcion o clase. Heurística."""
    try:
        ruta = _como_path(ruta_archivo)
        if ruta is None or not ruta.is_file():
            return []
        limite = _tope_efectivo(tope)
        lenguaje = lenguaje_de_archivo(ruta, tipo_proyecto)
        return _extraer_por_lenguaje(ruta, lenguaje, limite)
    except Exception:
        return []


def extraer_simbolos(
    ruta_archivo: Any,
    tope: Optional[int] = None,
    tipo_proyecto: str = "",
) -> list[str]:
    """Extrae defs/fn/func/class según la extensión. Heurística, no compilador.

    tope: máximo de símbolos (default TOPE_SIMBOLOS). tipo_proyecto distingue
    Android vs Java/Kotlin en .java/.kt. Nombres crudos (el mapa los usa así).
    """
    return [n for n, _ in extraer_simbolos_etiquetados(
        ruta_archivo, tope=tope, tipo_proyecto=tipo_proyecto,
    )]


def extraer_simbolos_formateados(
    ruta_archivo: Any,
    tope: Optional[int] = None,
    tipo_proyecto: str = "",
    omitir_privados: bool = False,
) -> list[str]:
    """Símbolos con formato README: `nombre()` / `class Nombre`."""
    items = extraer_simbolos_etiquetados(
        ruta_archivo, tope=tope, tipo_proyecto=tipo_proyecto,
    )
    if omitir_privados:
        items = [(n, k) for n, k in items if not str(n).startswith("_")]
    return [formatear_simbolo(n, k) for n, k in items]


# ─────────────────────────────────────────────
# INVENTARIO LIGERO (CLI; no es el mapa)
# ─────────────────────────────────────────────

def _listar_archivos_codigo(directorio: Path) -> list[Path]:
    """Recorre código podando caches y subproyectos .git. Sin glob ** (ERR-004)."""
    encontrados: list[Path] = []
    excluir = set(_DIRS_EXCLUIDOS)
    try:
        for d in directorio.iterdir():
            if d.is_dir() and (d / ".git").exists():
                excluir.add(d.name)
    except OSError:
        pass
    try:
        for dirpath, dirnames, filenames in os.walk(str(directorio)):
            dirnames[:] = [
                d for d in dirnames
                if d not in excluir and not d.startswith("Auditoria")
            ]
            for fname in filenames:
                f = Path(dirpath) / fname
                suf = f.suffix.lower()
                if suf in EXT_CODIGO or fname == "AndroidManifest.xml":
                    encontrados.append(f)
    except OSError:
        return []
    return encontrados


def analizar_ruta(ruta: Any) -> dict[str, Any]:
    """Detecta tipo y extrae símbolos de un archivo o directorio."""
    try:
        p = Path(ruta).resolve()
    except (TypeError, ValueError, OSError):
        return {
            "ruta": str(ruta),
            "tipo": "otro",
            "es_archivo": False,
            "archivos": [],
            "simbolos": [],
        }

    if p.is_file():
        tipo = detectar_tipo_lenguaje(str(p.parent))
        lenguaje = lenguaje_de_archivo(p, tipo)
        simbolos = extraer_simbolos(p, tipo_proyecto=tipo)
        return {
            "ruta": str(p),
            "tipo": tipo,
            "es_archivo": True,
            "lenguaje": lenguaje,
            "simbolos": simbolos,
            "archivos": [{
                "archivo": p.name,
                "lenguaje": lenguaje,
                "simbolos": simbolos,
            }],
        }

    tipo = detectar_tipo_lenguaje(str(p))
    archivos: list[dict[str, Any]] = []
    todos: list[str] = []
    for f in _listar_archivos_codigo(p):
        try:
            rel = str(f.relative_to(p)).replace("\\", "/")
        except ValueError:
            rel = f.name
        lenguaje = lenguaje_de_archivo(f, tipo)
        sims = extraer_simbolos(f, tipo_proyecto=tipo)
        archivos.append({
            "archivo": rel,
            "lenguaje": lenguaje,
            "simbolos": sims,
        })
        todos.extend(sims)
    return {
        "ruta": str(p),
        "tipo": tipo,
        "es_archivo": False,
        "archivos": archivos,
        "simbolos": todos,
    }


def imprimir_reporte(resultado: dict, formato_json: bool = False) -> None:
    """Imprime JSON o resumen en español."""
    if formato_json:
        print(json.dumps(resultado, ensure_ascii=False, indent=2, default=str))
        return
    print("\n🔤 LENGUAJE ADAPTATIVO")
    print("═" * 60)
    print(f"  Ruta: {resultado.get('ruta')}")
    print(f"  Tipo: {resultado.get('tipo')}")
    if resultado.get("es_archivo"):
        print(f"  Lenguaje archivo: {resultado.get('lenguaje')}")
    sims = resultado.get("simbolos") or []
    print(f"  Símbolos: {len(sims)}")
    print("═" * 60)
    for a in resultado.get("archivos") or []:
        extra = ""
        lista = a.get("simbolos") or []
        if lista:
            extra = f" — {', '.join(lista)}"
        print(f"  {a.get('archivo')} [{a.get('lenguaje')}]{extra}")
    print("═" * 60 + "\n")


def _parsear_argv(argv: list[str]) -> tuple[str, bool]:
    """Parsea [ruta] [--json]."""
    formato_json = False
    ruta: Optional[str] = None
    for a in argv:
        if a == "--json":
            formato_json = True
        elif not a.startswith("-"):
            ruta = a
    return ruta or os.getcwd(), formato_json


def main(argv: Optional[list[str]] = None) -> int:
    """Entry point. Exit 0 salvo ruta inexistente."""
    args = sys.argv[1:] if argv is None else argv
    ruta, formato_json = _parsear_argv(args)

    if not os.path.exists(ruta):
        print(f"❌ La ruta '{ruta}' no existe.")
        return 1

    try:
        resultado = analizar_ruta(ruta)
    except Exception as e:
        print(f"⚠️ Error al detectar lenguaje: {e}")
        return 0

    imprimir_reporte(resultado, formato_json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
