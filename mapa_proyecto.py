"""
mapa_proyecto.py - Cerebro del proyecto activo (cwd o [ruta])
=============================================================
Inventario de piezas del PROYECTO ACTIVO, desfase docs/código y
orquestación de conectores / lógica / módulos.

NO es el detector de lenguaje. Los símbolos multi-lenguaje se extraen
con `detectar_lenguaje.py` (función adaptativa separada).

Describe ESE directorio (cwd o la ruta pasada), no la plantilla padre.
No es un compilador ni afirma runtime 100%. Profundidad extra de QA
en python / node / mql5 / android; el resto es inventario heurístico.

Uso:
    python mapa_proyecto.py              # proyecto = cwd
    python mapa_proyecto.py [ruta]       # proyecto = esa ruta
    python mapa_proyecto.py --json [ruta]
    python mapa_proyecto.py --actualizar [ruta]
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

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
    ".git", "node_modules", "__pycache__", "venv", ".venv",
    "dist", "build", ".pytest_cache", ".mypy_cache",
    "site-packages", ".cursor", ".github",
    "target", "vendor", ".gradle", "cmake-build-debug",
    "cmake-build-release", "bin", "obj",
    "cache", "artifacts", ".cxx", "CMakeFiles",
    "coverage", "typechain-types", "typechain", ".cache",
    ".next", ".nuxt", ".turbo", "out", "DerivedData", "Pods",
    ".expo", ".ruff_cache",
    "lib", "forge-out", "forge-cache",
}

_DOCS = ("CONTEXTO.md", "VISION.md", "MEMORIA.md", "README.md")
_SCRIPTS_QA_KIT = {
    "crear_proyecto.py", "qa_autonomo.py", "sincronizar_plantilla.py",
    "aprender_error.py", "actualizar_contexto.py", "verificar_conectores.py",
    "detectar_logica.py", "vision_proyecto.py", "actualizar_readme.py",
    "memoria_proyecto.py", "reestructurar_peticion.py", "run_tests.py",
    "verificar_modulos.py", "mapa_proyecto.py", "detectar_lenguaje.py",
    "io_utf8.py",
}
_TOPE_SIMBOLOS_FALLBACK = 80
_TIPOS_QA_PROFUNDO = frozenset({"python", "node", "mql5", "android"})
_EXT_CODIGO_FALLBACK = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".mq5", ".mq4", ".mqh", ".java", ".kt",
    ".rs", ".go", ".cs", ".php", ".rb", ".swift",
    ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh",
    ".scala", ".lua", ".r", ".m", ".mm",
}

# Extensiones en menciones de docs: sin c/h/r/m sueltos (MAPA.md ≠ MAPA.m).
_EXTS_DOC = (
    "json|jsx|tsx|mjs|cjs|mq5|mq4|mqh|java|kts|mdc|yaml|yml|"
    "swift|scala|cpp|hpp|php|lua|py|js|ts|kt|rs|go|cs|rb|mm"
)
_RE_ARCHIVO = re.compile(
    r"(?<![\w./])("
    r"[A-Za-z0-9][A-Za-z0-9_.-]{0,80}(?:/[A-Za-z0-9_.-]{1,80}){0,8}"
    rf"\.(?:{_EXTS_DOC})"
    r")(?![\w])"
)
_RE_ARBOL = re.compile(
    rf"[├└]──\s+([A-Za-z0-9][A-Za-z0-9_.-]{{0,80}}\.(?:{_EXTS_DOC}))(?![\w])"
)
_PLACEHOLDERS = ("[descripción", "[describe", "[añadir", "[agregar")

_SCRIPTS_SUBCHECK = (
    ("verificar_conectores.py", "verificar_conectores", "conectores"),
    ("detectar_logica.py", "analizar_directorio", "logica"),
    ("verificar_modulos.py", "verificar_modulos", "modulos"),
)


def _importar_detectar_lenguaje() -> Optional[Any]:
    """Carga detectar_lenguaje.py. None si falta (fallback mínimo, no crash)."""
    try:
        import detectar_lenguaje as mod
        return mod
    except Exception:
        pass
    try:
        here = Path(__file__).resolve().parent / "detectar_lenguaje.py"
        if not here.is_file():
            return None
        spec = importlib.util.spec_from_file_location(
            "_mapa_detectar_lenguaje", here,
        )
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        return None


_DL = _importar_detectar_lenguaje()
_TOPE_SIMBOLOS = (
    int(getattr(_DL, "TOPE_SIMBOLOS", _TOPE_SIMBOLOS_FALLBACK))
    if _DL is not None else _TOPE_SIMBOLOS_FALLBACK
)
_EXT_CODIGO = (
    set(getattr(_DL, "EXT_CODIGO", _EXT_CODIGO_FALLBACK))
    if _DL is not None else set(_EXT_CODIGO_FALLBACK)
)


# ─────────────────────────────────────────────
# UTILIDADES
# ─────────────────────────────────────────────

def _leer(ruta: Path) -> Optional[str]:
    """Lee UTF-8; None si falla el I/O."""
    try:
        return ruta.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None


def _subproyectos_inmediatos(raiz: Path) -> set[str]:
    """Subdirectorios ajenos: .git propio (ERR-004) o CONTEXTO.md propio."""
    nombres: set[str] = set()
    try:
        for item in raiz.iterdir():
            if not item.is_dir():
                continue
            if (item / ".git").exists() or (item / "CONTEXTO.md").exists():
                nombres.add(item.name)
    except OSError:
        pass
    return nombres


def _nombres_excluidos(raiz: Path) -> set[str]:
    """Directorios a podar: caches, venv y subproyectos independientes."""
    return set(_DIRS_EXCLUIDOS) | _subproyectos_inmediatos(raiz)


def _rel(archivo: Path, raiz: Path) -> str:
    """Ruta relativa al proyecto, con /."""
    try:
        return str(archivo.relative_to(raiz)).replace("\\", "/")
    except ValueError:
        return str(archivo).replace("\\", "/")


def _seccion(texto: str, patron: str) -> str:
    """Extrae el cuerpo de una sección markdown ##."""
    m = re.search(patron, texto, re.IGNORECASE | re.MULTILINE)
    if not m:
        return ""
    resto = texto[m.end():]
    nxt = re.search(r"^##\s+", resto, re.MULTILINE)
    return (resto[:nxt.start()] if nxt else resto).strip()


def _primera_frase(texto: str) -> str:
    """Primera línea útil (sin placeholder)."""
    for linea in texto.splitlines():
        limpio = linea.strip().strip("#").strip()
        if not limpio:
            continue
        if any(p in limpio.lower() for p in _PLACEHOLDERS):
            continue
        if len(limpio) <= 240:
            return limpio
        return limpio[:240].rsplit(" ", 1)[0] + "…"
    return ""


def _hay_ext_cercana(d: Path, exts: set[str]) -> bool:
    """True si hay un archivo con esas extensiones cerca (fallback / tests)."""
    if _DL is not None and hasattr(_DL, "hay_ext_cercana"):
        try:
            return bool(_DL.hay_ext_cercana(d, exts))
        except Exception:
            pass
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


def _fallback_tipo_proyecto(directorio: str) -> str:
    """Tipo mínimo si detectar_lenguaje no está disponible."""
    d = Path(directorio)
    try:
        if (d / "build.gradle").exists() or (d / "build.gradle.kts").exists():
            return "android"
        if (d / "AndroidManifest.xml").exists():
            return "android"
        if (d / "package.json").exists():
            return "node"
        mql = list(d.glob("*.mq5")) + list(d.glob("*.mq4"))
        if mql:
            return "mql5"
        if (d / "requirements.txt").exists() or (d / "pyproject.toml").exists():
            return "python"
        if _hay_ext_cercana(d, {".py"}):
            return "python"
    except OSError:
        pass
    return "otro"


def detectar_tipo_proyecto(directorio: str) -> str:
    """Tipo del proyecto activo. Delega en detectar_lenguaje (no es el cerebro)."""
    if _DL is not None and hasattr(_DL, "detectar_tipo_lenguaje"):
        try:
            return str(_DL.detectar_tipo_lenguaje(directorio) or "otro")
        except Exception:
            pass
    return _fallback_tipo_proyecto(directorio)


# ─────────────────────────────────────────────
# 1. INVENTARIO / MAPA DE PARTES
# ─────────────────────────────────────────────

def _fallback_simbolos_python(ruta: Path, tope: int) -> list[str]:
    """AST mínimo si detectar_lenguaje no está disponible."""
    texto = _leer(ruta)
    if not texto:
        return []
    try:
        tree = ast.parse(texto)
    except SyntaxError:
        return []
    nombres: list[str] = []
    for nodo in tree.body:
        if isinstance(nodo, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            nombres.append(nodo.name)
        if len(nombres) >= tope:
            break
    return nombres


def extraer_simbolos(
    ruta: Any,
    lenguaje: Optional[str] = None,
    tope: Optional[int] = None,
    tipo_proyecto: str = "",
) -> list[str]:
    """Símbolos del archivo. Delega en detectar_lenguaje; no duplica extractores."""
    limite = _TOPE_SIMBOLOS if tope is None else tope
    hint = tipo_proyecto or (lenguaje or "")
    if _DL is not None and hasattr(_DL, "extraer_simbolos"):
        try:
            return list(_DL.extraer_simbolos(ruta, tope=limite, tipo_proyecto=hint))
        except Exception:
            pass
    try:
        p = Path(ruta)
        if p.suffix.lower() == ".py":
            return _fallback_simbolos_python(p, limite)
    except Exception:
        pass
    return []


def _lenguaje_archivo(suf: str, fname: str, tipo_proyecto: str) -> str:
    """Lenguaje heurístico de un archivo (delega en detectar_lenguaje)."""
    if _DL is not None and hasattr(_DL, "lenguaje_de_archivo"):
        try:
            return str(_DL.lenguaje_de_archivo(fname, tipo_proyecto) or "otro")
        except Exception:
            pass
    if fname == "AndroidManifest.xml":
        return "android"
    if suf == ".py":
        return "python"
    return "otro"


_ROLES_LENGUAJE = {
    "python": "módulo Python",
    "node": "módulo JS/TS",
    "mql5": "MQL",
    "android": "Android",
    "java": "módulo Java",
    "kotlin": "módulo Kotlin",
    "rust": "módulo Rust",
    "go": "módulo Go",
    "csharp": "módulo C#",
    "php": "módulo PHP",
    "ruby": "módulo Ruby",
    "swift": "módulo Swift",
    "c": "módulo C",
    "cpp": "módulo C++",
    "header": "cabecera C/C++",
    "scala": "módulo Scala",
    "lua": "módulo Lua",
    "r": "módulo R",
    "objc": "módulo Objective-C",
    "otro": "código",
}


def _rol_archivo(rel: str, lenguaje: str, _simbolos: list[str] | None = None) -> str:
    """Rol breve (sin volcar 80 símbolos: van en MAPA.md aparte)."""
    nombre = Path(rel).name.lower()
    if nombre in {n.lower() for n in _DOCS}:
        return "documentación"
    if nombre == "androidmanifest.xml":
        return "manifiesto Android"
    if "activity" in nombre and lenguaje in {"android", "java", "kotlin"}:
        return "Activity Android"
    if nombre.startswith("test_") or "/tests/" in rel.replace("\\", "/"):
        return "test"
    return _ROLES_LENGUAJE.get(lenguaje, "código")


def inventariar_partes(directorio: str) -> dict[str, Any]:
    """Recorre el proyecto activo y agrupa archivos por lenguaje heurístico."""
    raiz = Path(directorio).resolve()
    tipo = detectar_tipo_proyecto(str(raiz))
    excluir = _nombres_excluidos(raiz)
    partes: list[dict[str, Any]] = []
    nombres: set[str] = set()
    rutas: set[str] = set()
    lenguajes: set[str] = set()

    try:
        for dirpath, dirnames, filenames in os.walk(str(raiz)):
            dirnames[:] = [
                d for d in dirnames
                if d not in excluir and not d.startswith("Auditoria")
            ]
            for fname in filenames:
                f = Path(dirpath) / fname
                rel = _rel(f, raiz)
                nombres.add(fname)
                rutas.add(rel)
                suf = f.suffix.lower()
                if not (suf in _EXT_CODIGO or fname == "AndroidManifest.xml"):
                    continue
                lenguaje = _lenguaje_archivo(suf, fname, tipo)
                simbolos = extraer_simbolos(
                    f, tope=_TOPE_SIMBOLOS, tipo_proyecto=tipo,
                )
                lenguajes.add(lenguaje)
                partes.append({
                    "archivo": rel,
                    "tipo": lenguaje,
                    "simbolos": simbolos,
                    "rol": _rol_archivo(rel, lenguaje, simbolos),
                })
    except OSError:
        pass

    docs: list[dict[str, str]] = []
    for doc in _DOCS:
        ruta = raiz / doc
        docs.append({
            "archivo": doc,
            "existe": ruta.is_file(),
            "rol": "documentación",
        })
        if ruta.is_file():
            nombres.add(doc)
            rutas.add(doc)

    return {
        "tipo": tipo,
        "partes": partes,
        "docs": docs,
        "nombres": nombres,
        "rutas": rutas,
        "lenguajes": sorted(lenguajes),
    }


def _que_es(raiz: Path, nombre: str) -> str:
    """Una línea: CONTEXTO, VISION o nombre de carpeta."""
    ctx = _leer(under_root(raiz, "CONTEXTO.md")) or ""
    if ctx:
        bloque = _seccion(ctx, r"##\s*(?:¿)?Qué es este proyecto\??")
        frase = _primera_frase(bloque)
        if frase:
            return frase
        tit = re.search(
            r"#\s*(?:🧠\s*)?CONTEXTO DEL PROYECTO:\s*(.+)", ctx, re.I,
        )
        if tit:
            return f"Proyecto {tit.group(1).strip()}"
    vis = _leer(under_root(raiz, "VISION.md")) or ""
    if vis:
        idea = _seccion(vis, r"##\s*💡\s*Idea Central")
        frase = _primera_frase(idea)
        if frase:
            return frase
    return nombre


# ─────────────────────────────────────────────
# 2. AL DÍA (DOCS VS CÓDIGO)
# ─────────────────────────────────────────────

def _extraer_mencionados(texto: str) -> list[tuple[str, int]]:
    """Archivos citados en árbol, tabla de módulos o bullets ✅/🔄 (no 💡)."""
    hallados: list[tuple[str, int]] = []
    vistos: set[str] = set()
    en_tabla = False
    for num, linea in enumerate(texto.splitlines(), 1):
        if "💡" in linea and "✅" not in linea and "🔄" not in linea:
            continue
        strip = linea.strip()
        if strip.startswith("##"):
            en_tabla = ("Módulos" in strip) or ("Modulos" in strip)
        candidatos: list[str] = []
        resto_est = resto_bullet_estado(linea)
        if resto_est:
            resto = resto_est.strip().strip("`")
            primer = re.split(r"[\s—–]+", resto, maxsplit=1)[0].strip("`")
            if primer and (Path(primer).suffix or "/" in primer):
                candidatos.append(primer)
            candidatos.extend(t.group(1) for t in _RE_ARCHIVO.finditer(resto))
        candidatos.extend(t.group(1) for t in _RE_ARBOL.finditer(linea))
        if en_tabla and "|" in linea:
            candidatos.extend(t.group(1) for t in _RE_ARCHIVO.finditer(linea))
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


def _bloque_auto_readme(texto: str) -> str:
    """Solo el bloque AUTO-README si existe; si no, el README entero."""
    m = re.search(
        r"<!--\s*AUTO-README:START\s*-->.*?<!--\s*AUTO-README:END\s*-->",
        texto,
        re.DOTALL | re.IGNORECASE,
    )
    return m.group(0) if m else texto


def _existe_mencionado(raiz: Path, nombre: str, inventario: dict) -> bool:
    """True si el path o el basename está en disco."""
    limpio = nombre.strip().rstrip("/").replace("\\", "/")
    if not limpio:
        return True
    try:
        if (raiz / nombre).exists() or (raiz / limpio).exists():
            return True
    except OSError:
        pass
    base = Path(limpio).name
    # .cursor y .github se podan del walk; las reglas/workflows sí existen
    for extra in (
        raiz / ".cursor" / "rules" / base,
        raiz / ".cursor" / "hooks" / base,
        raiz / ".github" / "workflows" / base,
    ):
        try:
            if extra.exists():
                return True
        except OSError:
            continue
    if base in inventario.get("nombres", set()):
        return True
    rutas = inventario.get("rutas", set())
    if limpio in rutas:
        return True
    return any(
        r.endswith("/" + limpio) or r.startswith(limpio + "/")
        for r in rutas
    )


def _es_relevante_nuevo(rel: str) -> bool:
    """Código en raíz o src/app/include (no tests ni docs)."""
    if rel in _DOCS or rel == "MAPA.md":
        return False
    nombre = Path(rel).name
    if nombre in _SCRIPTS_QA_KIT:
        return False
    if nombre.startswith("test_") or nombre.endswith("_test.py"):
        return False
    if nombre in {"conftest.py", "__init__.py"}:
        return False
    partes = rel.replace("\\", "/").split("/")
    if partes[0] in {"tests", "test", "__tests__"}:
        return False
    if len(partes) == 1:
        return True
    return partes[0] in {
        "src", "app", "include", "Include", "lib",
        "cmd", "pkg", "internal", "jni", "kotlin", "java", "Classes",
    }


def comprobar_al_dia(directorio: str, inventario: dict) -> dict[str, Any]:
    """Compara CONTEXTO/VISION/README con el código real."""
    raiz = Path(directorio).resolve()
    criticos: list[dict[str, Any]] = []
    avisos: list[dict[str, Any]] = []
    mencionados: set[str] = set()

    for doc_name in ("CONTEXTO.md", "VISION.md"):
        ruta = under_root(raiz, doc_name)
        if not ruta.is_file():
            continue
        texto = _leer(ruta)
        if not texto:
            continue
        for nombre, linea in _extraer_mencionados(texto):
            mencionados.add(Path(nombre).name)
            mencionados.add(nombre)
            if _existe_mencionado(raiz, nombre, inventario):
                continue
            criticos.append({
                "tipo": "doc_fantasma",
                "archivo": doc_name,
                "linea": linea,
                "mensaje": (
                    f"Módulo '{nombre}' listado en {doc_name} no existe en disco"
                ),
                "severidad": "critico",
            })

    readme = under_root(raiz, "README.md")
    if readme.is_file():
        texto_r = _leer(readme) or ""
        bloque = _bloque_auto_readme(texto_r)
        for nombre, _linea in _extraer_mencionados(bloque):
            mencionados.add(Path(nombre).name)
            mencionados.add(nombre)
        for m in _RE_ARCHIVO.finditer(bloque):
            mencionados.add(Path(m.group(1)).name)

    for parte in inventario.get("partes") or []:
        rel = parte.get("archivo") or ""
        if not _es_relevante_nuevo(rel):
            continue
        base = Path(rel).name
        if base in mencionados or rel in mencionados:
            continue
        avisos.append({
            "tipo": "codigo_no_documentado",
            "archivo": rel,
            "linea": 0,
            "mensaje": (
                f"Archivo '{rel}' no aparece en CONTEXTO/VISION/"
                f"README AUTO-README"
            ),
            "severidad": "advertencia",
        })

    if avisos and (raiz / "actualizar_readme.py").is_file():
        avisos.append({
            "tipo": "sugerir_readme",
            "archivo": "README.md",
            "linea": 0,
            "mensaje": "Sugerencia: python actualizar_readme.py",
            "severidad": "advertencia",
        })

    return {"criticos": criticos, "avisos": avisos, "mencionados": sorted(mencionados)}


# ─────────────────────────────────────────────
# 3. CONEXIÓN (ORQUESTACIÓN, SIN DUPLICAR)
# ─────────────────────────────────────────────

def _encontrar_script(nombre: str, directorio: Path) -> Optional[Path]:
    """Busca el script en el proyecto o en la raíz de la plantilla."""
    for cand in (directorio / nombre, Path(__file__).resolve().parent / nombre):
        try:
            if cand.is_file():
                return cand
        except OSError:
            continue
    return None


def _cargar_modulo(script: Path, alias: str) -> Optional[Any]:
    """Importa un .py por ruta. None si falla."""
    try:
        spec = importlib.util.spec_from_file_location(alias, script)
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        return None


def _a_dict_problema(p: Any) -> dict[str, Any]:
    """Normaliza dataclass o dict de un sub-check."""
    if isinstance(p, dict):
        return p
    return {
        "archivo": getattr(p, "archivo", ""),
        "linea": getattr(p, "linea", 0),
        "tipo": getattr(p, "tipo", ""),
        "mensaje": getattr(p, "mensaje", str(p)),
        "severidad": getattr(p, "severidad", "advertencia"),
    }


def _cli_json(script: Path, directorio: str) -> Optional[dict]:
    """Fallback: CLI --json del mismo intérprete Python."""
    try:
        proc = subprocess.run(
            [sys.executable, str(script), "--json", directorio],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=45,
        )
        if not proc.stdout:
            return None
        return json.loads(proc.stdout)
    except Exception:
        return None


def _run_conectores(script: Path, directorio: str) -> dict[str, Any]:
    """Llama verificar_conectores(); CLI si el import falla."""
    mod = _cargar_modulo(script, "mapa_dep_conectores")
    data: Optional[dict] = None
    if mod is not None and hasattr(mod, "verificar_conectores"):
        try:
            data = mod.verificar_conectores(directorio)
        except Exception:
            data = None
    if data is None:
        data = _cli_json(script, directorio)
    if not isinstance(data, dict):
        return {"ok": False, "aviso": "No se pudo ejecutar verificar_conectores",
                "criticos": [], "avisos": []}
    rotos = [_a_dict_problema(c) for c in (data.get("rotos") or [])]
    sospe = [_a_dict_problema(c) for c in (data.get("sospechosos") or [])]
    return {
        "ok": True,
        "verificados": data.get("verificados", 0),
        "criticos": rotos,
        "avisos": sospe,
    }


def _run_logica(script: Path, directorio: str) -> dict[str, Any]:
    """Llama analizar_directorio(); CLI si el import falla."""
    mod = _cargar_modulo(script, "mapa_dep_logica")
    problemas: Optional[list] = None
    if mod is not None and hasattr(mod, "analizar_directorio"):
        try:
            problemas, _total = mod.analizar_directorio(directorio)
        except Exception:
            problemas = None
    if problemas is None:
        raw = _cli_json(script, directorio)
        if isinstance(raw, dict):
            problemas = raw.get("problemas") or []
    if problemas is None:
        return {"ok": False, "aviso": "No se pudo ejecutar detectar_logica",
                "criticos": [], "avisos": []}
    items = [_a_dict_problema(p) for p in problemas]
    return {
        "ok": True,
        "criticos": [p for p in items if p.get("severidad") == "critico"],
        "avisos": [p for p in items if p.get("severidad") != "critico"],
    }


def _run_modulos(script: Path, directorio: str) -> dict[str, Any]:
    """Llama verificar_modulos(); CLI si el import falla."""
    mod = _cargar_modulo(script, "mapa_dep_modulos")
    data: Optional[dict] = None
    if mod is not None and hasattr(mod, "verificar_modulos"):
        try:
            data = mod.verificar_modulos(directorio)
        except Exception:
            data = None
    if data is None:
        data = _cli_json(script, directorio)
    if not isinstance(data, dict):
        return {"ok": False, "aviso": "No se pudo ejecutar verificar_modulos",
                "criticos": [], "avisos": []}
    return {
        "ok": True,
        "verificados": data.get("verificados", 0),
        "criticos": [_a_dict_problema(c) for c in (data.get("criticos") or [])],
        "avisos": [_a_dict_problema(a) for a in (data.get("advertencias") or [])],
    }


def comprobar_conexion(directorio: str) -> dict[str, Any]:
    """Orquesta sub-checks existentes. Aviso si un script falta; no crash."""
    raiz = Path(directorio).resolve()
    resumen: dict[str, Any] = {
        "conectores": {},
        "logica": {},
        "modulos": {},
        "scripts_ausentes": [],
        "criticos": [],
        "avisos": [],
    }
    runners = {
        "conectores": _run_conectores,
        "logica": _run_logica,
        "modulos": _run_modulos,
    }
    for fname, _fn, clave in _SCRIPTS_SUBCHECK:
        script = _encontrar_script(fname, raiz)
        if script is None:
            resumen["scripts_ausentes"].append(fname)
            resumen["avisos"].append({
                "tipo": "script_ausente",
                "archivo": fname,
                "mensaje": f"{fname} no encontrado — omitiendo sub-check",
                "severidad": "advertencia",
            })
            resumen[clave] = {"ok": False, "aviso": "script ausente",
                              "criticos": [], "avisos": []}
            continue
        try:
            bloque = runners[clave](script, str(raiz))
        except Exception as e:
            bloque = {
                "ok": False,
                "aviso": f"Error al ejecutar {fname}: {e}",
                "criticos": [],
                "avisos": [],
            }
        resumen[clave] = bloque
        resumen["criticos"].extend(bloque.get("criticos") or [])
        resumen["avisos"].extend(bloque.get("avisos") or [])
    return resumen


# ─────────────────────────────────────────────
# MAPA.md + FUNCIÓN UNIFICADA
# ─────────────────────────────────────────────

def _estado_final(docs: dict, conexion: dict, incluir_subchecks: bool) -> str:
    """DESCONECTADO > DESFASADO > AL DÍA."""
    if incluir_subchecks and conexion.get("criticos"):
        return "DESCONECTADO"
    if docs.get("criticos") or docs.get("avisos"):
        return "DESFASADO"
    return "AL DÍA"


def _linea_tipo(resultado: dict) -> str:
    """Tipo del proyecto + hint de lenguajes inventariados."""
    tipo = resultado.get("tipo") or "otro"
    langs = resultado.get("lenguajes") or []
    if tipo in _TIPOS_QA_PROFUNDO:
        extra = ""
        otros = [x for x in langs if x != tipo]
        if otros:
            extra = f" (también: {', '.join(otros)})"
        return f"{tipo} — QA profundo{extra}"
    if langs:
        return f"{tipo} — inventario heurístico ({', '.join(langs)})"
    return f"{tipo} — inventario heurístico"


def _render_mapa(resultado: dict) -> str:
    """Genera el markdown de MAPA.md (estático + docs; no afirma runtime)."""
    ruta = resultado.get("directorio") or ""
    lineas = [
        f"# Mapa del proyecto: {resultado.get('nombre', '')}",
        "",
        f"**Ruta activa:** `{ruta}`",
        "",
        "## Qué es",
        resultado.get("que_es") or resultado.get("nombre") or "",
        "",
        "## Tipo",
        _linea_tipo(resultado),
        "",
        "## Cómo leer este mapa",
        "Cerebro del proyecto activo: piezas, docs vs código y conexión.",
        "Los símbolos multi-lenguaje los extrae `detectar_lenguaje.py` (no este script).",
        "Inventario heurístico (no es un compilador). Describe cwd o `[ruta]`, no otro repo.",
        "Profundidad extra de conectores/lógica/módulos: python, node, mql5, android.",
        "Si el tipo es otro lenguaje, esos sub-checks se llaman si existen; no crashean.",
        "Conexión = análisis estático. No afirma ejecución 100% en runtime.",
        "",
        "## Partes",
    ]
    for p in resultado.get("partes") or []:
        lineas.append(f"- `{p['archivo']}` — {p.get('rol', '')}")
        sims = p.get("simbolos") or []
        if sims:
            lineas.append(f"  - Funciones/clases: {', '.join(sims)}")
    docs = resultado.get("docs") or []
    if docs:
        lineas.append("")
        lineas.append("### Docs")
        for d in docs:
            marca = "sí" if d.get("existe") else "no"
            lineas.append(f"- `{d['archivo']}` — {d.get('rol', 'documentación')} ({marca})")

    dv = resultado.get("docs_vs_codigo") or {}
    lineas.extend(["", "## Docs vs código"])
    crit_d = dv.get("criticos") or []
    avis_d = dv.get("avisos") or []
    if crit_d:
        lineas.append("### Críticos")
        for h in crit_d:
            lineas.append(f"- {h.get('mensaje', '')}")
    if avis_d:
        lineas.append("### Avisos")
        for h in avis_d:
            lineas.append(f"- {h.get('mensaje', '')}")
    if not crit_d and not avis_d:
        lineas.append("Sin desfases detectados entre docs y código.")

    cx = resultado.get("conexion") or {}
    lineas.extend(["", "## Conexión"])
    if not resultado.get("incluir_subchecks", True):
        lineas.append(
            "Sub-checks omitidos en esta corrida. "
            "Ejecutar `python mapa_proyecto.py --actualizar` para orquestar "
            "verificar_conectores, detectar_logica y verificar_modulos."
        )
    else:
        for clave, titulo in (
            ("conectores", "verificar_conectores"),
            ("logica", "detectar_logica"),
            ("modulos", "verificar_modulos"),
        ):
            b = cx.get(clave) or {}
            if b.get("aviso") and not b.get("ok"):
                lineas.append(f"- {titulo}: aviso — {b['aviso']}")
                continue
            n_c = len(b.get("criticos") or [])
            n_a = len(b.get("avisos") or [])
            lineas.append(f"- {titulo}: {n_c} crítico(s), {n_a} aviso(s)")
        ausentes = cx.get("scripts_ausentes") or []
        if ausentes:
            lineas.append(f"- Scripts ausentes: {', '.join(ausentes)}")

    estado = resultado.get("estado") or "AL DÍA"
    lineas.extend([
        "",
        "## Estado",
        f"**{estado}**",
        "",
        "_Inventario heurístico + docs + conexión estática. "
        "No afirma ejecución 100% en runtime._",
        "",
    ])
    return "\n".join(lineas)


def escribir_mapa_md(directorio: str, resultado: dict) -> bool:
    """Escribe MAPA.md en UTF-8. False si el I/O falla (no crash)."""
    ruta = Path(directorio).resolve() / "MAPA.md"
    try:
        ruta.write_text(_render_mapa(resultado), encoding="utf-8")
        return True
    except OSError:
        return False


def mapa_proyecto(
    directorio: str,
    escribir_mapa: bool = True,
    incluir_subchecks: bool = True,
) -> dict[str, Any]:
    """
    Función unificada: inventario de piezas, docs vs código y conexión.

    incluir_subchecks=False evita re-ejecutar conectores/lógica/módulos
    (p. ej. módulo 4f de qa_autonomo, que ya corrió 4c-4e).
    """
    raiz = Path(directorio).resolve()
    nombre = raiz.name
    inventario = inventariar_partes(str(raiz))
    docs = comprobar_al_dia(str(raiz), inventario)
    if incluir_subchecks:
        conexion = comprobar_conexion(str(raiz))
    else:
        conexion = {
            "conectores": {},
            "logica": {},
            "modulos": {},
            "scripts_ausentes": [],
            "criticos": [],
            "avisos": [],
            "omitido": True,
        }

    estado = _estado_final(docs, conexion, incluir_subchecks)
    criticos = list(docs.get("criticos") or [])
    if incluir_subchecks:
        criticos.extend(conexion.get("criticos") or [])

    resultado: dict[str, Any] = {
        "directorio": str(raiz),
        "nombre": nombre,
        "que_es": _que_es(raiz, nombre),
        "tipo": inventario["tipo"],
        "lenguajes": inventario.get("lenguajes") or [],
        "partes": inventario["partes"],
        "docs": inventario["docs"],
        "docs_vs_codigo": {
            "criticos": docs.get("criticos") or [],
            "avisos": docs.get("avisos") or [],
        },
        "conexion": conexion,
        "incluir_subchecks": incluir_subchecks,
        "estado": estado,
        "criticos": criticos,
        "ok": len(criticos) == 0,
        "mapa_escrito": False,
    }
    if escribir_mapa:
        resultado["mapa_escrito"] = escribir_mapa_md(str(raiz), resultado)
    return resultado


def imprimir_reporte(resultado: dict, formato_json: bool = False) -> None:
    """Imprime JSON o resumen en español."""
    if formato_json:
        serializable = dict(resultado)
        print(json.dumps(serializable, ensure_ascii=False, indent=2, default=str))
        return

    print("\n🗺️  MAPA DEL PROYECTO")
    print("═" * 60)
    print(f"  Proyecto: {resultado.get('nombre')}")
    print(f"  Ruta: {resultado.get('directorio')}")
    print(f"  Qué es: {resultado.get('que_es')}")
    print(f"  Tipo: {resultado.get('tipo')}")
    langs = resultado.get("lenguajes") or []
    if langs:
        print(f"  Lenguajes: {', '.join(langs)}")
    print(f"  Estado: {resultado.get('estado')}")
    print("═" * 60)
    print(f"\n📦 Partes: {len(resultado.get('partes') or [])} archivo(s) de código")
    dv = resultado.get("docs_vs_codigo") or {}
    print(f"📄 Docs vs código: {len(dv.get('criticos') or [])} crítico(s), "
          f"{len(dv.get('avisos') or [])} aviso(s)")
    if resultado.get("incluir_subchecks"):
        cx = resultado.get("conexion") or {}
        print(f"🔗 Conexión: {len(cx.get('criticos') or [])} crítico(s)")
    else:
        print("🔗 Conexión: sub-checks omitidos en esta corrida")
    if resultado.get("mapa_escrito"):
        print("📝 MAPA.md actualizado")
    print("═" * 60 + "\n")


def _parsear_argv(argv: list[str]) -> tuple[str, bool, bool]:
    """Parsea [ruta] [--json] [--actualizar]. Proyecto activo = ruta o cwd."""
    formato_json = False
    actualizar = False
    directorio: Optional[str] = None
    for a in argv:
        if a == "--json":
            formato_json = True
        elif a == "--actualizar":
            actualizar = True
        elif not a.startswith("-"):
            directorio = a
    return directorio or os.getcwd(), formato_json, actualizar


def main(argv: Optional[list[str]] = None) -> int:
    """Entry point. Exit 0 si solo avisos; 1 si hay críticos."""
    args = sys.argv[1:] if argv is None else argv
    directorio, formato_json, _actualizar = _parsear_argv(args)

    if not os.path.isdir(directorio):
        print(f"❌ El directorio '{directorio}' no existe.")
        return 1

    try:
        resultado = mapa_proyecto(directorio, escribir_mapa=True)
    except Exception as e:
        print(f"⚠️ Error al generar el mapa: {e}")
        return 0

    imprimir_reporte(resultado, formato_json)
    return 1 if resultado.get("criticos") else 0


if __name__ == "__main__":
    sys.exit(main())
