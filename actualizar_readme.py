"""
actualizar_readme.py - README real del proyecto (aditivo)
=========================================================
Actualiza README.md con la descripción y funciones reales del proyecto.
Solo toca el bloque entre <!-- AUTO-README:START --> y <!-- AUTO-README:END -->.

Uso:
    python actualizar_readme.py                # actualiza README.md del cwd
    python actualizar_readme.py [ruta]         # actualiza README de esa ruta
    python actualizar_readme.py --dry          # preview sin escribir
    python actualizar_readme.py --json         # estado en JSON
"""

import ast
import json
import os
import re
import sys
import importlib.util
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from qa_safe_io import confine, confine_read, confine_write
from typing import Any, Optional

# ERR-003: no reemplazar sys.stdout; usar reconfigure si existe
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ─────────────────────────────────────────────
# MÓDULO 1: CONSTANTES
# ─────────────────────────────────────────────

MARKER_START = "<!-- AUTO-README:START -->"
MARKER_END = "<!-- AUTO-README:END -->"

_EXCLUIR_DIRS = {
    ".git", ".venv", "venv", "__pycache__", "node_modules",
    "dist", "build", ".pytest_cache", ".mypy_cache",
    ".cursor", ".github", ".idea", ".vscode",
    "cache", "artifacts", ".cxx", "CMakeFiles",
    "coverage", "typechain-types", ".cache",
    ".next", ".nuxt", ".turbo", "out", "DerivedData", "Pods",
}

_EXTENSIONES_CODIGO = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs",
    ".mq5", ".mq4", ".mqh",
    ".java", ".kt",
    ".rs", ".go", ".cs", ".php", ".rb", ".swift",
    ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh",
    ".scala", ".lua", ".r", ".m", ".mm",
}

_PLACEHOLDERS = (
    "[descripción",
    "[describe",
    "[añadir",
    "[agregar",
    "descripción del proyecto.",
    "estructura técnica sugerida",
)

_HERRAMIENTAS_QA = (
    ("crear_proyecto.py", "python crear_proyecto.py [Nombre]",
     "Crea un proyecto con QA, CI/CD y git"),
    ("qa_autonomo.py", "python qa_autonomo.py",
     "Auditoría QA del proyecto"),
    ("sincronizar_plantilla.py", "python sincronizar_plantilla.py",
     "Propaga el kit QA a subproyectos"),
    ("aprender_error.py", "python aprender_error.py --lista",
     "Memoria de errores (ERR-XXX)"),
    ("actualizar_contexto.py", "python actualizar_contexto.py --mostrar",
     "Gestiona CONTEXTO.md"),
    ("vision_proyecto.py", "python vision_proyecto.py --mostrar",
     "Gestiona VISION.md"),
    ("verificar_conectores.py", "python verificar_conectores.py",
     "Detecta conectores sueltos (ERR-008)"),
    ("detectar_logica.py", "python detectar_logica.py",
     "Detecta errores de lógica (ERR-009..012)"),
    ("verificar_modulos.py", "python verificar_modulos.py",
     "Verifica módulos documentados y modales UI"),
    ("mapa_proyecto.py", "python mapa_proyecto.py --actualizar",
     "Cerebro del proyecto activo: piezas, docs vs código y conexión (MAPA.md)"),
    ("detectar_lenguaje.py", "python detectar_lenguaje.py [ruta]",
     "Lenguaje adaptativo: detecta tipo y extrae símbolos multi-lenguaje"),
    ("run_tests.py", "python run_tests.py",
     "Ejecuta tests según el tipo de proyecto"),
    ("actualizar_readme.py", "python actualizar_readme.py",
     "Actualiza este README con el estado real"),
    ("memoria_proyecto.py", "python memoria_proyecto.py --mostrar",
     "Memoria de sesión (MEMORIA.md)"),
    ("reestructurar_peticion.py", 'python reestructurar_peticion.py "texto"',
     "Reestructura una petición informal en prompt profesional"),
    ("qa_check.py", "python qa_check.py",
     "Verificación local del proyecto"),
)

_MAX_ARCHIVOS = 20
_MAX_SIMBOLOS = 12
_MAX_ITEMS_ESTADO = 12


# ─────────────────────────────────────────────
# MÓDULO 2: MODELO
# ─────────────────────────────────────────────

@dataclass
class InfoReadme:
    """Datos reales del proyecto usados para generar el bloque AUTO-README."""
    directorio: str
    nombre: str
    tipo: str
    descripcion: str = ""
    estado: str = ""
    funciona: list[str] = field(default_factory=list)
    en_progreso: list[str] = field(default_factory=list)
    pendientes: list[str] = field(default_factory=list)
    modulos_contexto: list[str] = field(default_factory=list)
    archivos: list[dict] = field(default_factory=list)
    comandos: list[str] = field(default_factory=list)
    herramientas_qa: list[dict] = field(default_factory=list)
    tests_count: int = 0

    def to_dict(self) -> dict:
        return {
            "directorio": self.directorio,
            "nombre": self.nombre,
            "tipo": self.tipo,
            "descripcion": self.descripcion,
            "estado": self.estado,
            "funciona": self.funciona,
            "en_progreso": self.en_progreso,
            "pendientes": self.pendientes,
            "modulos_contexto": self.modulos_contexto,
            "archivos": self.archivos,
            "comandos": self.comandos,
            "herramientas_qa": self.herramientas_qa,
            "tests_count": self.tests_count,
        }


# ─────────────────────────────────────────────
# MÓDULO 3: I/O SEGURO
# ─────────────────────────────────────────────

def _leer_texto(ruta: Path) -> Optional[str]:
    """Lee un archivo en UTF-8. Retorna None si falla."""
    try:
        ruta = confine(ruta)
        if not ruta.exists() or not ruta.is_file():
            return None
        return confine_read(ruta)
    except (OSError, ValueError):
        return None


def _escribir_texto(ruta: Path, contenido: str) -> bool:
    """Escribe UTF-8. Retorna False si falla."""
    try:
        confine_write(ruta, contenido)
        return True
    except (OSError, ValueError) as e:
        print(f"❌ Error escribiendo {ruta}: {e}", file=sys.stderr)
        return False


def _es_placeholder(texto: str) -> bool:
    """True si el texto es un stub de plantilla, no descripción real."""
    t = (texto or "").strip().lower()
    if not t:
        return True
    return any(p in t for p in _PLACEHOLDERS)


def _seccion_md(contenido: str, patron_h2: str) -> str:
    """Extrae el cuerpo de un H2 markdown hasta el siguiente H2."""
    match = re.search(
        patron_h2 + r"[^\n]*\n(.*?)(?=\n## |\Z)",
        contenido,
        re.DOTALL | re.IGNORECASE,
    )
    return match.group(1).strip() if match else ""


def _bullets(seccion: str) -> list[str]:
    """Extrae ítems de lista markdown, omitiendo placeholders."""
    items = []
    for linea in seccion.splitlines():
        linea = linea.strip()
        if not linea.startswith("- "):
            continue
        item = linea[2:].strip()
        if item.startswith("|"):
            continue
        if _es_placeholder(item):
            continue
        if item.lower() in ("[añadir]", "[añadir funcionalidades completas]"):
            continue
        items.append(item)
    return items


def _importar_detectar_lenguaje() -> Optional[Any]:
    """Carga detectar_lenguaje.py. None si falta (fallback local)."""
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
            "_readme_detectar_lenguaje", here,
        )
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:
        return None


_DL = _importar_detectar_lenguaje()
if _DL is not None:
    try:
        extra = getattr(_DL, "EXT_CODIGO", None)
        if extra:
            _EXTENSIONES_CODIGO.update(extra)
    except Exception:
        pass


# ─────────────────────────────────────────────
# MÓDULO 4: DETECCIÓN DE TIPO
# ─────────────────────────────────────────────

def detectar_tipo_proyecto(directorio: str) -> str:
    """
    Detecta el tipo del proyecto. Prefiere detectar_lenguaje (multi-idioma).
    Fallback local: python / node / mql5 / android. Sin glob ** (ERR-004).
    """
    if _DL is not None and hasattr(_DL, "detectar_tipo_lenguaje"):
        try:
            tipo = _DL.detectar_tipo_lenguaje(directorio)
            if tipo:
                return str(tipo)
        except Exception:
            pass

    d = Path(directorio)

    if (d / "build.gradle").exists() or (d / "build.gradle.kts").exists():
        return "android"
    if (d / "AndroidManifest.xml").exists():
        return "android"

    mql = list(d.glob("*.mq5")) + list(d.glob("*.mq4"))
    mql += list(d.glob("src/*.mq5")) + list(d.glob("src/*.mq4"))
    if mql:
        return "mql5"

    pkg = d / "package.json"
    if pkg.exists():
        return "node"

    indicadores_py = ("requirements.txt", "pyproject.toml", "setup.py", "setup.cfg")
    if any((d / f).exists() for f in indicadores_py):
        return "python"

    try:
        if any(p.suffix == ".py" and p.is_file() for p in d.iterdir()):
            return "python"
    except OSError:
        pass

    return "python"


def _nombre_package_json(directorio: Path) -> tuple[str, str]:
    """Retorna (nombre, descripcion) desde package.json si existe."""
    pkg = directorio / "package.json"
    texto = _leer_texto(pkg)
    if not texto:
        return "", ""
    try:
        data = json.loads(texto)
        return str(data.get("name") or ""), str(data.get("description") or "")
    except (json.JSONDecodeError, TypeError):
        return "", ""


# ─────────────────────────────────────────────
# MÓDULO 5: CONTEXTO Y VISIÓN
# ─────────────────────────────────────────────

def _parsear_contexto(directorio: Path) -> dict:
    """Extrae campos útiles de CONTEXTO.md si existe."""
    texto = _leer_texto(directorio / "CONTEXTO.md")
    if not texto:
        return {}

    datos: dict = {}
    titulo = re.search(
        r"#\s*(?:🧠\s*)?CONTEXTO DEL PROYECTO:\s*(.+)",
        texto,
        re.IGNORECASE,
    )
    if titulo:
        datos["nombre"] = titulo.group(1).strip()

    que_es = _seccion_md(texto, r"##\s*(?:¿)?Qué es este proyecto\??")
    if que_es and not _es_placeholder(que_es):
        datos["descripcion"] = " ".join(que_es.split())

    tipo_sec = _seccion_md(texto, r"##\s*Tipo de proyecto")
    estado_m = re.search(r"\*\*Estado actual:\*\*\s*(.+)", tipo_sec)
    if estado_m:
        datos["estado"] = estado_m.group(1).strip()

    datos["funciona"] = _bullets(_seccion_md(texto, r"##\s*Lo que está funcionando"))
    datos["en_progreso"] = _bullets(_seccion_md(texto, r"##\s*Lo que está en progreso"))
    datos["pendientes"] = _bullets(
        _seccion_md(texto, r"##\s*Lo que NO funciona o está pendiente")
    )

    mods = []
    mods_sec = _seccion_md(texto, r"##\s*Módulos del proyecto")
    for linea in mods_sec.splitlines():
        if not linea.strip().startswith("|"):
            continue
        celdas = [c.strip() for c in linea.strip().strip("|").split("|")]
        if len(celdas) < 2:
            continue
        if celdas[0].lower() in ("módulo", "modulo") or set(celdas[0]) <= {"-", " "}:
            continue
        archivo = celdas[1] if len(celdas) > 1 else ""
        mods.append(f"{celdas[0]} — {archivo}".strip(" —"))
    datos["modulos"] = mods
    return datos


def _parsear_vision(directorio: Path) -> dict:
    """Extrae idea central y módulos de VISION.md si existe."""
    texto = _leer_texto(directorio / "VISION.md")
    if not texto:
        return {}

    datos: dict = {}
    titulo = re.search(r"#\s*🎯\s*Visión del Proyecto:\s*(.+)", texto)
    if titulo:
        datos["nombre"] = titulo.group(1).strip()

    idea = _seccion_md(texto, r"##\s*💡\s*Idea Central")
    if idea and not _es_placeholder(idea):
        datos["descripcion"] = " ".join(idea.split())

    mods = []
    for linea in _seccion_md(texto, r"##\s*📦\s*Módulos").splitlines():
        linea = linea.strip()
        if linea.startswith("- ") and not _es_placeholder(linea[2:]):
            mods.append(linea[2:].strip())
    datos["modulos"] = mods
    return datos


# ─────────────────────────────────────────────
# MÓDULO 6: ESCANEO DE CÓDIGO (ERR-004)
# ─────────────────────────────────────────────

def _raices_ajenas(raiz: Path) -> set[str]:
    """
    Subdirectorios inmediatos que son otro proyecto (ERR-004).
    Se omiten si tienen .git propio o su propio CONTEXTO.md.
    """
    nombres = set()
    try:
        for item in raiz.iterdir():
            if not item.is_dir():
                continue
            if (item / ".git").exists() or (item / "CONTEXTO.md").exists():
                nombres.add(item.name)
    except OSError:
        pass
    return nombres


def iterar_fuentes(directorio: str) -> list[Path]:
    """
    Recorre archivos de código podando .git, node_modules, __pycache__
    y subproyectos con .git propio. No usa glob **.
    """
    raiz = Path(directorio)
    excluidos = set(_EXCLUIR_DIRS) | _raices_ajenas(raiz)
    encontrados: list[Path] = []

    try:
        for dirpath, dirnames, filenames in os.walk(str(raiz)):
            dirnames[:] = [
                d for d in dirnames
                if d not in excluidos and not d.startswith(".") and not d.startswith("Auditoria")
            ]
            for fname in filenames:
                if fname.startswith("."):
                    continue
                ruta = Path(dirpath) / fname
                if (
                    ruta.suffix.lower() in _EXTENSIONES_CODIGO
                    or fname == "AndroidManifest.xml"
                ):
                    encontrados.append(ruta)
    except OSError:
        return []

    return encontrados


def _formatear_simbolo_local(nombre: str, kind: str = "funcion") -> str:
    """Delega en detectar_lenguaje.formatear_simbolo; fallback local."""
    if _DL is not None and hasattr(_DL, "formatear_simbolo"):
        try:
            return str(_DL.formatear_simbolo(nombre, kind))
        except Exception:
            pass
    n = (nombre or "").strip()
    if not n:
        return ""
    if n.endswith("()"):
        return n
    if n.lower().startswith("class "):
        resto = n[6:].strip()
        return f"class {resto}" if resto else "class"
    if (kind or "").lower() in {"clase", "class", "struct", "enum", "trait"}:
        return f"class {n}"
    return f"{n}()"


def extraer_simbolos_python(ruta: Path) -> list[str]:
    """Funciones y clases de primer nivel (no anidadas, no privadas)."""
    texto = _leer_texto(ruta)
    if not texto:
        return []
    try:
        tree = ast.parse(texto)
    except SyntaxError:
        return []

    simbolos = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith("_"):
                continue
            simbolos.append(_formatear_simbolo_local(node.name, "funcion"))
        elif isinstance(node, ast.ClassDef):
            if node.name.startswith("_"):
                continue
            simbolos.append(_formatear_simbolo_local(node.name, "clase"))
    return simbolos


def extraer_exports_js(ruta: Path) -> list[str]:
    """Exports públicos en JS/TS."""
    texto = _leer_texto(ruta)
    if not texto:
        return []
    simbolos = []
    patrones = (
        r"export\s+(?:async\s+)?function\s+(\w+)",
        r"export\s+class\s+(\w+)",
        r"export\s+(?:const|let|var)\s+(\w+)",
        r"exports\.(\w+)\s*=",
        r"function\s+(\w+)\s*\(",
        r"class\s+(\w+)\s*",
    )
    vistos = set()
    for patron in patrones:
        for match in re.finditer(patron, texto):
            nombre = match.group(1)
            if not nombre or nombre.startswith("_") or nombre in vistos:
                continue
            if nombre in ("if", "for", "while", "switch"):
                continue
            vistos.add(nombre)
            es_clase = "class" in patron
            kind = "clase" if es_clase else "funcion"
            simbolos.append(_formatear_simbolo_local(nombre, kind))
    return simbolos


def extraer_handlers_mql(ruta: Path) -> list[str]:
    """Handlers y funciones MQL4/5 (OnTick, OnInit, etc.)."""
    texto = _leer_texto(ruta)
    if not texto:
        return []
    simbolos = []
    vistos = set()
    for match in re.finditer(
        r"\b(OnTick|OnInit|OnDeinit|OnCalculate|OnTimer|OnTrade|OnChartEvent)\s*\(",
        texto,
    ):
        nombre = match.group(1)
        if nombre not in vistos:
            vistos.add(nombre)
            simbolos.append(_formatear_simbolo_local(nombre, "funcion"))
    for match in re.finditer(
        r"\b(?:void|int|double|bool|string|long|datetime)\s+(\w+)\s*\(",
        texto,
    ):
        nombre = match.group(1)
        if nombre.startswith("On") or nombre.startswith("_") or nombre in vistos:
            continue
        vistos.add(nombre)
        simbolos.append(_formatear_simbolo_local(nombre, "funcion"))
    return simbolos


def extraer_tipos_android(ruta: Path) -> list[str]:
    """Clases Kotlin/Java de primer vistazo."""
    texto = _leer_texto(ruta)
    if not texto:
        return []
    simbolos = []
    for match in re.finditer(r"\b(?:class|object|interface)\s+(\w+)", texto):
        nombre = match.group(1)
        if not nombre.startswith("_"):
            simbolos.append(_formatear_simbolo_local(nombre, "clase"))
    return simbolos


def _es_archivo_test(ruta: Path) -> bool:
    nombre = ruta.name.lower()
    return (
        nombre.startswith("test_")
        or nombre.endswith("_test.py")
        or nombre.endswith(".test.js")
        or nombre.endswith(".test.ts")
        or nombre == "conftest.py"
    )


def extraer_simbolos_archivo(ruta: Path) -> list[str]:
    """Símbolos reales con formato uniforme: `nombre()` / `class Nombre`."""
    if _DL is not None and hasattr(_DL, "extraer_simbolos_formateados"):
        try:
            pretty = list(_DL.extraer_simbolos_formateados(
                ruta, omitir_privados=True,
            ))
            if pretty:
                return pretty
        except Exception:
            pass
    if _DL is not None and hasattr(_DL, "extraer_simbolos"):
        try:
            crudos = list(_DL.extraer_simbolos(ruta))
            if crudos:
                return [
                    _formatear_simbolo_local(n, "funcion")
                    for n in crudos
                    if n and not str(n).startswith("_")
                ]
        except Exception:
            pass
    suf = ruta.suffix.lower()
    if suf == ".py":
        return extraer_simbolos_python(ruta)
    if suf in {".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"}:
        return extraer_exports_js(ruta)
    if suf in {".mq5", ".mq4", ".mqh"}:
        return extraer_handlers_mql(ruta)
    if suf in {".java", ".kt"}:
        return extraer_tipos_android(ruta)
    return []


def analizar_codigo(directorio: str) -> tuple[list[dict], int]:
    """
    Retorna (archivos con símbolos, cantidad de tests).
    Omite detalle de test_*.py; solo cuenta tests.
    """
    raiz = Path(directorio)
    fuentes = iterar_fuentes(directorio)
    tests = [f for f in fuentes if _es_archivo_test(f)]
    utiles = [f for f in fuentes if not _es_archivo_test(f)]

    def _clave(ruta: Path) -> tuple:
        try:
            rel = ruta.relative_to(raiz)
        except ValueError:
            rel = Path(ruta.name)
        return (len(rel.parts), str(rel).lower())

    utiles.sort(key=_clave)
    archivos = []
    for ruta in utiles[: _MAX_ARCHIVOS * 2]:
        simbolos = extraer_simbolos_archivo(ruta)[:_MAX_SIMBOLOS]
        if not simbolos:
            continue
        try:
            rel = str(ruta.relative_to(raiz)).replace("\\", "/")
        except ValueError:
            rel = ruta.name
        archivos.append({"archivo": rel, "simbolos": simbolos})
        if len(archivos) >= _MAX_ARCHIVOS:
            break
    return archivos, len(tests)


# ─────────────────────────────────────────────
# MÓDULO 7: COMANDOS Y HERRAMIENTAS
# ─────────────────────────────────────────────

def detectar_comandos(directorio: str, tipo: str) -> list[str]:
    """Comandos reales según archivos presentes (no genéricos inventados)."""
    d = Path(directorio)
    cmds: list[str] = []

    if (d / "requirements.txt").exists():
        cmds.append("pip install -r requirements.txt")
    if (d / "package.json").exists():
        texto = _leer_texto(d / "package.json") or ""
        try:
            scripts = json.loads(texto).get("scripts") or {}
            for nombre in scripts:
                cmds.append(f"npm run {nombre}")
        except (json.JSONDecodeError, TypeError):
            cmds.append("npm install")
    if (d / "main.py").exists():
        cmds.append("python main.py")
    tests_dir = d / "tests"
    if tests_dir.exists():
        try:
            if any(tests_dir.glob("test_*.py")):
                cmds.append("python -m pytest tests/ -v")
        except OSError:
            pass
    if (d / "crear_proyecto.py").exists():
        cmds.append("python crear_proyecto.py NombreProyecto")
    if (d / "qa_autonomo.py").exists():
        cmds.append("python qa_autonomo.py")
    if (d / "actualizar_contexto.py").exists():
        cmds.append("python actualizar_contexto.py --mostrar")
    if (d / "vision_proyecto.py").exists():
        cmds.append("python vision_proyecto.py --mostrar")
    cmds.append("python actualizar_readme.py")
    if tipo == "mql5":
        cmds.append("Compilar el Expert Advisor en MetaEditor (MetaTrader 5)")
    if tipo == "android":
        cmds.append("Abrir el proyecto en Android Studio y ejecutar Gradle sync")

    # Deduplicar preservando orden
    vistos = set()
    unicos = []
    for c in cmds:
        if c not in vistos:
            vistos.add(c)
            unicos.append(c)
    return unicos


def detectar_herramientas_qa(directorio: str) -> list[dict]:
    """Lista scripts QA que existen en el directorio."""
    d = Path(directorio)
    encontradas = []
    for archivo, uso, desc in _HERRAMIENTAS_QA:
        if (d / archivo).exists():
            encontradas.append({"archivo": archivo, "uso": uso, "descripcion": desc})
    return encontradas


# ─────────────────────────────────────────────
# MÓDULO 8: RECOLECCIÓN
# ─────────────────────────────────────────────

def recolectar_info(directorio: str) -> InfoReadme:
    """Junta CONTEXTO, VISION, código y comandos del proyecto real."""
    d = Path(os.path.abspath(directorio))
    ctx = _parsear_contexto(d)
    vis = _parsear_vision(d)
    tipo = detectar_tipo_proyecto(str(d))
    pkg_nombre, pkg_desc = _nombre_package_json(d)

    nombre = (
        ctx.get("nombre")
        or vis.get("nombre")
        or pkg_nombre
        or d.name
    )
    descripcion = (
        ctx.get("descripcion")
        or vis.get("descripcion")
        or (pkg_desc if pkg_desc and not _es_placeholder(pkg_desc) else "")
        or f"Proyecto {nombre} (tipo {tipo})."
    )

    archivos, tests_count = analizar_codigo(str(d))
    modulos = ctx.get("modulos") or vis.get("modulos") or []

    return InfoReadme(
        directorio=str(d),
        nombre=nombre,
        tipo=tipo,
        descripcion=descripcion,
        estado=ctx.get("estado", ""),
        funciona=(ctx.get("funciona") or [])[:_MAX_ITEMS_ESTADO],
        en_progreso=(ctx.get("en_progreso") or [])[:_MAX_ITEMS_ESTADO],
        pendientes=(ctx.get("pendientes") or [])[:_MAX_ITEMS_ESTADO],
        modulos_contexto=modulos[:15],
        archivos=archivos,
        comandos=detectar_comandos(str(d), tipo),
        herramientas_qa=detectar_herramientas_qa(str(d)),
        tests_count=tests_count,
    )


# ─────────────────────────────────────────────
# MÓDULO 9: GENERACIÓN DEL BLOQUE
# ─────────────────────────────────────────────

def generar_bloque(info: InfoReadme) -> str:
    """Genera el markdown del bloque AUTO-README (con marcadores)."""
    lineas = [MARKER_START, ""]
    lineas.append(f"## {info.nombre}")
    lineas.append("")
    lineas.append(info.descripcion)
    lineas.append("")
    lineas.append(f"- **Tipo de proyecto:** `{info.tipo}` (detectado automáticamente)")
    if info.estado:
        lineas.append(f"- **Estado:** {info.estado}")
    if info.tests_count:
        lineas.append(f"- **Tests detectados:** {info.tests_count} archivo(s)")
    lineas.append("")

    if info.funciona:
        lineas.append("### Qué funciona")
        for item in info.funciona:
            lineas.append(f"- {item}")
        lineas.append("")

    if info.en_progreso:
        lineas.append("### En progreso")
        for item in info.en_progreso:
            lineas.append(f"- {item}")
        lineas.append("")

    if info.pendientes:
        lineas.append("### Pendiente")
        for item in info.pendientes:
            lineas.append(f"- {item}")
        lineas.append("")

    if info.modulos_contexto:
        lineas.append("### Módulos")
        for mod in info.modulos_contexto:
            lineas.append(f"- {mod}")
        lineas.append("")

    if info.archivos:
        lineas.append("### Funciones reales (código)")
        for entrada in info.archivos:
            lineas.append(f"- `{entrada['archivo']}`")
            for sim in entrada["simbolos"]:
                lineas.append(f"  - `{sim}`")
        lineas.append("")

    if info.comandos:
        lineas.append("### Cómo usarlo")
        lineas.append("")
        lineas.append("```powershell")
        for cmd in info.comandos:
            lineas.append(cmd)
        lineas.append("```")
        lineas.append("")

    if info.herramientas_qa:
        lineas.append("### Herramientas QA")
        lineas.append("")
        lineas.append("| Script | Uso | Descripción |")
        lineas.append("|--------|-----|-------------|")
        for h in info.herramientas_qa:
            lineas.append(f"| `{h['archivo']}` | `{h['uso']}` | {h['descripcion']} |")
        lineas.append("")

    lineas.append(
        f"_Actualizado automáticamente el {date.today().isoformat()} "
        "por `actualizar_readme.py`. El texto fuera de estos marcadores no se toca._"
    )
    lineas.append("")
    lineas.append(MARKER_END)
    return "\n".join(lineas)


# ─────────────────────────────────────────────
# MÓDULO 10: ESCRITURA ADITIVA
# ─────────────────────────────────────────────

def _es_readme_generico(contenido: str) -> bool:
    """True si parece el stub de crear_proyecto (no un README a medida)."""
    if MARKER_START in contenido:
        return False
    lineas = [ln for ln in contenido.splitlines() if ln.strip()]
    if len(lineas) <= 20:
        return True
    senales = (
        "Descripción del proyecto.",
        "## QA y verificación",
        "python qa_check.py   # Verificación automática",
    )
    return any(s in contenido for s in senales) and len(contenido) < 2000


def _insertar_tras_h1(contenido: str, bloque: str) -> str:
    """Inserta el bloque después del primer H1 (README stub de plantilla)."""
    lineas = contenido.splitlines(keepends=True)
    if not lineas:
        return bloque + "\n"
    idx = 0
    for i, linea in enumerate(lineas):
        if linea.startswith("# "):
            idx = i
            break
    insert_at = idx + 1
    while insert_at < len(lineas) and lineas[insert_at].strip() == "":
        insert_at += 1
    return "".join(lineas[:insert_at]) + "\n" + bloque + "\n" + "".join(lineas[insert_at:])


def aplicar_bloque(contenido: Optional[str], bloque: str, nombre: str) -> str:
    """
    Fusiona el bloque generado con el README existente.
    Nunca borra texto fuera de AUTO-README.
    """
    if not contenido or not contenido.strip():
        return f"# {nombre}\n\n{bloque}\n"

    start = contenido.find(MARKER_START)
    end = contenido.find(MARKER_END)
    if start != -1 and end != -1 and end > start:
        fin = end + len(MARKER_END)
        return contenido[:start] + bloque + contenido[fin:]
    if start != -1 and end == -1:
        return contenido[:start].rstrip() + "\n\n" + bloque + "\n"

    if _es_readme_generico(contenido):
        return _insertar_tras_h1(contenido, bloque)

    extra = "" if contenido.endswith("\n") else "\n"
    return contenido + extra + "\n" + bloque + "\n"


def actualizar_readme(directorio: str, dry: bool = False) -> dict:
    """
    Recolecta info y actualiza README.md del directorio.
    Retorna un dict de estado (útil para --json y tests).
    """
    d = Path(os.path.abspath(directorio))
    info = recolectar_info(str(d))
    bloque = generar_bloque(info)
    ruta = d / "README.md"
    existia = ruta.exists()
    actual = _leer_texto(ruta) if existia else None
    nuevo = aplicar_bloque(actual, bloque, info.nombre)
    escrito = False

    if not dry:
        if not _escribir_texto(ruta, nuevo):
            return {
                "ok": False,
                "escrito": False,
                "dry": dry,
                "existia": existia,
                "readme": str(ruta),
                "error": f"No se pudo escribir {ruta}",
                **info.to_dict(),
            }
        escrito = True

    return {
        "ok": True,
        "escrito": escrito,
        "dry": dry,
        "existia": existia,
        "readme": str(ruta),
        "preview": bloque if dry else "",
        **info.to_dict(),
    }


# ─────────────────────────────────────────────
# MÓDULO 11: CLI
# ─────────────────────────────────────────────

def _imprimir_ayuda() -> None:
    print(
        "Uso:\n"
        "  python actualizar_readme.py                # actualiza README.md del cwd\n"
        "  python actualizar_readme.py [ruta]         # actualiza README de esa ruta\n"
        "  python actualizar_readme.py --dry          # preview sin escribir\n"
        "  python actualizar_readme.py --json         # estado en JSON\n"
    )


def _parsear_argv(argv: list[str]) -> tuple[str, bool, bool, bool]:
    """Retorna (ruta, dry, as_json, help)."""
    if any(a in ("-h", "--help") for a in argv):
        return os.getcwd(), False, False, True
    dry = "--dry" in argv
    as_json = "--json" in argv
    resto = [a for a in argv if a not in ("--dry", "--json")]
    ruta = resto[0] if resto else os.getcwd()
    return ruta, dry, as_json, False


def main() -> int:
    """Punto de entrada CLI."""
    ruta, dry, as_json, ayuda = _parsear_argv(sys.argv[1:])
    if ayuda:
        _imprimir_ayuda()
        return 0

    if not os.path.isdir(ruta):
        msg = f"❌ La ruta no es un directorio: {ruta}"
        if as_json:
            print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False, indent=2))
        else:
            print(msg, file=sys.stderr)
        return 1

    try:
        estado = actualizar_readme(ruta, dry=dry)
    except Exception as e:
        if as_json:
            print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False, indent=2))
        else:
            print(f"❌ Error actualizando README: {e}", file=sys.stderr)
        return 1

    if as_json:
        print(json.dumps(estado, ensure_ascii=False, indent=2))
        return 0 if estado.get("ok") else 1

    nombre = estado.get("nombre", Path(ruta).name)
    tipo = estado.get("tipo", "?")
    if dry:
        print(f"ℹ️  DRY RUN — no se escribió README.md ({nombre}, tipo={tipo})")
        preview = estado.get("preview") or ""
        print(preview)
        return 0

    accion = "actualizado" if estado.get("existia") else "creado"
    print(f"✅ README.md {accion} → {estado.get('readme')}")
    print(f"   Proyecto: {nombre} | Tipo: {tipo}")
    print(f"   Funciones/archivos: {len(estado.get('archivos') or [])}")
    return 0 if estado.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
