"""
qa_autonomo.py - Sistema de QA y Auditoría Autónoma
====================================================
Detecta el tipo de proyecto automáticamente y ejecuta
las verificaciones apropiadas según el stack tecnológico.

Uso:
    python qa_autonomo.py              # Audita el directorio actual
    python qa_autonomo.py /ruta/       # Audita una ruta específica
    python qa_autonomo.py --json       # Output en formato JSON
"""

import os
import sys
import json
import subprocess
import ast
import re
from pathlib import Path
from qa_safe_io import confine, confine_write
from dataclasses import dataclass, field
from typing import Optional

try:
    from io_utf8 import run_utf8
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from io_utf8 import run_utf8

# Forzar UTF-8 en Windows para que los símbolos Unicode se impriman correctamente
# Usa reconfigure() para no reemplazar el objeto stdout (seguro bajo pytest/CI)
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ─────────────────────────────────────────────
# MÓDULO 1: ESTRUCTURAS DE DATOS
# ─────────────────────────────────────────────

@dataclass
class ResultadoQA:
    """Resultado de una verificación individual."""
    categoria: str
    mensaje: str
    severidad: str  # "critico" | "advertencia" | "info" | "ok"
    archivo: Optional[str] = None
    linea: Optional[int] = None


@dataclass
class ReporteQA:
    """Reporte completo de auditoría del proyecto."""
    tipo_proyecto: str
    directorio: str
    resultados: list[ResultadoQA] = field(default_factory=list)

    @property
    def criticos(self) -> list[ResultadoQA]:
        return [r for r in self.resultados if r.severidad == "critico"]

    @property
    def advertencias(self) -> list[ResultadoQA]:
        return [r for r in self.resultados if r.severidad == "advertencia"]

    @property
    def oks(self) -> list[ResultadoQA]:
        return [r for r in self.resultados if r.severidad == "ok"]

    def agregar(self, categoria: str, mensaje: str, severidad: str,
                archivo: str = None, linea: int = None):
        self.resultados.append(ResultadoQA(categoria, mensaje, severidad, archivo, linea))


# ─────────────────────────────────────────────
# MÓDULO 2: DETECTOR DE TIPO DE PROYECTO
# ─────────────────────────────────────────────

def detectar_tipo_proyecto(directorio: str) -> str:
    """
    Detecta el tipo de proyecto analizando archivos indicadores.
    Retorna una cadena que identifica el tipo (ej: 'python', 'android', 'mql5').
    """
    d = confine(directorio)

    # Android
    if (d / "build.gradle").exists() or (d / "build.gradle.kts").exists():
        return "android"
    if (d / "AndroidManifest.xml").exists():
        return "android"

    # MQL5 / MQL4 (Trading bots MetaTrader)
    # NOTA: se busca solo en raíz y src/ para evitar clasificar el workspace raíz
    # como MQL5 cuando contiene subproyectos con archivos .mq5 en sus propias carpetas.
    mql_files = (list(d.glob("*.mq5")) + list(d.glob("*.mq4")) +
                 list(d.glob("src/*.mq5")) + list(d.glob("src/*.mq4")))
    if mql_files:
        return "mql5"

    # Node / React / Next
    pkg = d / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            if "react-native" in deps:
                return "react-native"
            if "next" in deps:
                return "nextjs"
            if "react" in deps:
                return "react"
            if "express" in deps or "fastify" in deps or "koa" in deps:
                return "nodejs-api"
        except Exception:
            pass
        return "nodejs"

    # Python
    py_indicators = ["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg"]
    if any((d / f).exists() for f in py_indicators) or list(d.glob("*.py")):
        # Sub-tipo de Python
        req_file = d / "requirements.txt"
        if req_file.exists():
            req = req_file.read_text(encoding="utf-8", errors="ignore").lower()
            if any(x in req for x in ["django", "flask", "fastapi", "starlette"]):
                return "python-web"
            if any(x in req for x in ["tensorflow", "torch", "sklearn", "keras"]):
                return "python-ml"
            if any(x in req for x in ["ccxt", "binance", "alpaca", "MetaTrader5"]):
                return "python-trading"
        return "python"

    # Rust
    if (d / "Cargo.toml").exists():
        return "rust"

    # Go
    if (d / "go.mod").exists():
        return "go"

    # .NET / C#
    cs_files = list(d.glob("*.sln")) + list(d.glob("*.csproj"))
    if cs_files:
        return "dotnet"

    return "unknown"


# ─────────────────────────────────────────────
# MÓDULO 3: VERIFICACIONES POR TIPO
# ─────────────────────────────────────────────

def verificar_python(directorio: str, reporte: ReporteQA):
    """Verifica proyectos Python: sintaxis, estructura, tests, seguridad."""
    d = Path(directorio)

    # 3.1 Validar sintaxis de archivos .py del proyecto.
    # Usa os.walk con poda de directorios para evitar descender en node_modules,
    # subproyectos independientes, etc. (drásticamente más rápido que glob "**/*.py").
    py_files = _iterar_archivos_auditables(directorio, extensiones={".py"})

    errores_sintaxis = 0
    for py_file in py_files:
        try:
            codigo = py_file.read_text(encoding="utf-8", errors="ignore")
            ast.parse(codigo)
        except SyntaxError as e:
            reporte.agregar("sintaxis", f"SyntaxError: {e.msg}", "critico",
                            str(py_file), e.lineno)
            errores_sintaxis += 1

    if errores_sintaxis == 0 and py_files:
        reporte.agregar("sintaxis", f"Todos los {len(py_files)} archivos .py tienen sintaxis válida", "ok")

    # 3.2 Verificar si hay tests — solo en tests/ directo del proyecto (sin recursar en subproyectos)
    tests_dir = d / "tests"
    test_files = list(tests_dir.glob("test_*.py")) + list(tests_dir.glob("*_test.py")) if tests_dir.exists() else []
    # También buscar test_*.py en la raíz directa del proyecto
    test_files += list(d.glob("test_*.py"))
    if not test_files:
        reporte.agregar("tests", "No se encontraron archivos de test en tests/ (test_*.py)", "advertencia")
    else:
        reporte.agregar("tests", f"{len(test_files)} archivo(s) de test encontrado(s)", "ok")

    # 3.3 Ejecutar pytest solo si hay carpeta tests/ directa (evita descubrir tests de subproyectos)
    # Guard: si ya estamos corriendo bajo pytest, no lanzar otro pytest (evita recursión infinita)
    ya_bajo_pytest = bool(os.environ.get("PYTEST_CURRENT_TEST"))
    if test_files and tests_dir.exists() and not ya_bajo_pytest:
        try:
            env_pytest = os.environ.copy()
            env_pytest["QA_AUTONOMO_RUNNING"] = "1"
            result = run_utf8(
                [
                    sys.executable, "-m", "pytest", str(tests_dir),
                    "--tb=short", "-q", "--no-header",
                    "-k", "not test_qa_autonomo_rendimiento",
                ],
                cwd=directorio, timeout=120, env=env_pytest,
            )
            if result.returncode == 0:
                reporte.agregar("pytest", f"Todos los tests pasaron: {result.stdout.strip()[:200]}", "ok")
            else:
                output = (result.stdout + result.stderr)[:500]
                reporte.agregar("pytest", f"Tests fallaron:\n{output}", "critico")
        except subprocess.TimeoutExpired:
            reporte.agregar("pytest", "Timeout ejecutando pytest (>120s)", "advertencia")
        except FileNotFoundError:
            reporte.agregar("pytest", "pytest no instalado (pip install pytest)", "advertencia")
    elif ya_bajo_pytest and test_files:
        reporte.agregar("pytest", f"{len(test_files)} archivo(s) de test presente(s) (ejecución omitida: ya bajo pytest)", "info")

    # 3.4 Verificar credenciales hardcodeadas
    _verificar_secretos(directorio, reporte, extensiones=["*.py"])

    # 3.5 Verificar .env en .gitignore
    _verificar_gitignore(directorio, reporte)

    # 3.6 Verificar requirements.txt
    req = d / "requirements.txt"
    if not req.exists():
        reporte.agregar("estructura", "No existe requirements.txt", "advertencia")
    else:
        reporte.agregar("estructura", "requirements.txt presente", "ok")


def verificar_mql5(directorio: str, reporte: ReporteQA):
    """Verifica proyectos MQL4/MQL5: lógica de trading, gestión de riesgo."""
    d = Path(directorio)
    mql_files = list(d.glob("**/*.mq5")) + list(d.glob("**/*.mq4"))

    if not mql_files:
        reporte.agregar("estructura", "No se encontraron archivos MQL", "advertencia")
        return

    reporte.agregar("estructura", f"{len(mql_files)} archivo(s) MQL encontrado(s)", "info")

    for mql_file in mql_files:
        try:
            contenido = mql_file.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        nombre = mql_file.name

        # Verificar StopLoss
        tiene_order = re.search(r"OrderSend|trade\.Buy|trade\.Sell|trade\.Open", contenido)
        tiene_sl = re.search(r"StopLoss|sl\s*=|SL\s*=", contenido)
        if tiene_order and not tiene_sl:
            reporte.agregar("riesgo", f"CRÍTICO: Operaciones de trading SIN StopLoss definido",
                            "critico", nombre)
        elif tiene_order and tiene_sl:
            reporte.agregar("riesgo", "StopLoss detectado en operaciones", "ok", nombre)

        # Verificar NormalizeDouble en volúmenes
        tiene_lots = re.search(r"Lots|Volume|lot\s*=", contenido, re.IGNORECASE)
        tiene_normalize = "NormalizeDouble" in contenido
        if tiene_lots and not tiene_normalize:
            reporte.agregar("precision", "Volumen sin NormalizeDouble() - riesgo de lote inválido",
                            "advertencia", nombre)

        # Verificar manejo de errores en OrderSend
        if "OrderSend" in contenido and "GetLastError" not in contenido:
            reporte.agregar("errores", "OrderSend sin verificación de GetLastError()",
                            "advertencia", nombre)

        # Verificar OnTick sin guard de nueva barra
        if "void OnTick" in contenido:
            tiene_time_guard = re.search(r"(datetime\s+\w+\s*=\s*iTime|Time\[0\]|CopyTime)", contenido)
            if not tiene_time_guard:
                reporte.agregar("logica", "OnTick() sin guard de nueva barra - puede sobre-operar",
                                "advertencia", nombre)


def verificar_nodejs(directorio: str, reporte: ReporteQA):
    """Verifica proyectos Node.js / React / Next."""
    d = Path(directorio)
    pkg_file = d / "package.json"

    if not pkg_file.exists():
        reporte.agregar("estructura", "package.json no encontrado", "critico")
        return

    try:
        pkg = json.loads(pkg_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        reporte.agregar("estructura", f"package.json inválido: {e}", "critico")
        return

    # Verificar scripts
    scripts = pkg.get("scripts", {})
    if "build" not in scripts:
        reporte.agregar("scripts", "No hay script 'build' en package.json", "advertencia")
    if "test" not in scripts:
        reporte.agregar("scripts", "No hay script 'test' en package.json", "advertencia")

    # Verificar node_modules
    if not (d / "node_modules").exists():
        reporte.agregar("dependencias", "node_modules no instalado - ejecutar npm install", "advertencia")
    else:
        reporte.agregar("dependencias", "node_modules presente", "ok")

    # Intentar npm run build
    if "build" in scripts and (d / "node_modules").exists():
        try:
            result = subprocess.run(
                ["npm", "run", "build", "--silent"],
                capture_output=True, text=True, cwd=directorio, timeout=120
            )
            if result.returncode == 0:
                reporte.agregar("build", "npm run build: exitoso", "ok")
            else:
                output = (result.stdout + result.stderr)[:500]
                reporte.agregar("build", f"npm run build falló:\n{output}", "critico")
        except (subprocess.TimeoutExpired, FileNotFoundError):
            reporte.agregar("build", "No se pudo ejecutar npm run build", "advertencia")

    # Verificar .env.example
    if not (d / ".env.example").exists() and not (d / ".env").exists():
        reporte.agregar("configuracion", "No hay .env ni .env.example", "advertencia")

    _verificar_gitignore(directorio, reporte)
    _verificar_secretos(directorio, reporte, extensiones=["*.js", "*.ts", "*.jsx", "*.tsx"])


def verificar_android(directorio: str, reporte: ReporteQA):
    """Verifica proyectos Android (Gradle)."""
    d = Path(directorio)

    # Verificar archivos clave
    manifest = list(d.glob("**/AndroidManifest.xml"))
    if not manifest:
        reporte.agregar("estructura", "AndroidManifest.xml no encontrado", "critico")
    else:
        reporte.agregar("estructura", "AndroidManifest.xml encontrado", "ok")

    gradle_file = d / "build.gradle"
    gradle_kts = d / "build.gradle.kts"
    if not gradle_file.exists() and not gradle_kts.exists():
        reporte.agregar("estructura", "build.gradle no encontrado en raíz", "advertencia")

    # Intentar gradle check
    gradlew = d / "gradlew.bat"  # Windows
    if gradlew.exists():
        try:
            result = subprocess.run(
                [str(gradlew), "check", "--quiet"],
                capture_output=True, text=True, cwd=directorio, timeout=180
            )
            if result.returncode == 0:
                reporte.agregar("gradle", "gradle check: exitoso", "ok")
            else:
                output = (result.stdout + result.stderr)[:500]
                reporte.agregar("gradle", f"gradle check falló:\n{output}", "critico")
        except subprocess.TimeoutExpired:
            reporte.agregar("gradle", "Timeout en gradle check (>3min)", "advertencia")
    else:
        reporte.agregar("gradle", "gradlew.bat no encontrado - verificar manualmente", "advertencia")

    _verificar_gitignore(directorio, reporte)


def verificar_rust(directorio: str, reporte: ReporteQA):
    """Verifica proyectos Rust."""
    try:
        result = subprocess.run(
            ["cargo", "check", "--quiet"],
            capture_output=True, text=True, cwd=directorio, timeout=120
        )
        if result.returncode == 0:
            reporte.agregar("compilacion", "cargo check: exitoso", "ok")
        else:
            reporte.agregar("compilacion", f"cargo check falló:\n{result.stderr[:400]}", "critico")
    except FileNotFoundError:
        reporte.agregar("compilacion", "cargo no encontrado - instalar Rust", "advertencia")
    except subprocess.TimeoutExpired:
        reporte.agregar("compilacion", "Timeout en cargo check", "advertencia")


def verificar_go(directorio: str, reporte: ReporteQA):
    """Verifica proyectos Go."""
    try:
        result = subprocess.run(
            ["go", "build", "./..."],
            capture_output=True, text=True, cwd=directorio, timeout=120
        )
        if result.returncode == 0:
            reporte.agregar("compilacion", "go build: exitoso", "ok")
        else:
            reporte.agregar("compilacion", f"go build falló:\n{result.stderr[:400]}", "critico")
    except FileNotFoundError:
        reporte.agregar("compilacion", "go no encontrado en PATH", "advertencia")
    except subprocess.TimeoutExpired:
        reporte.agregar("compilacion", "Timeout en go build", "advertencia")


# ─────────────────────────────────────────────
# MÓDULO 4: VERIFICACIONES UNIVERSALES
# ─────────────────────────────────────────────

# Directorios que se excluyen durante el walk (nunca se desciende en ellos)
_EXCLUIR_SEGMENTOS_UNIVERSAL = {
    ".venv", "venv", "__pycache__", "node_modules", "dist", "build",
    ".pytest_cache", ".mypy_cache",
    "cache", "artifacts", ".cxx", "CMakeFiles",
    "coverage", "typechain-types", ".cache",
    ".next", ".nuxt", ".turbo", "out", "DerivedData", "Pods",
}

# Extensiones auditables por defecto para la búsqueda de patrones de error
_EXTENSIONES_AUDITABLES = {
    ".py", ".mq5", ".mq4", ".mqh", ".js", ".ts", ".jsx", ".tsx",
    ".java", ".kt", ".go", ".rs", ".cs"
}


def _iterar_archivos_auditables(
    directorio: str,
    extensiones: set[str] | None = None,
    solo_raiz: bool = False
) -> list["Path"]:
    """
    Itera archivos auditables usando os.walk con poda de directorios.
    Evita descender en:
      - Directorios excluidos (_EXCLUIR_SEGMENTOS_UNIVERSAL)
      - Subproyectos independientes (tienen .git propio)
    Esto es drásticamente más rápido que glob("**/*") + filtro post-hoc.

    Args:
        directorio: Ruta raíz de la búsqueda.
        extensiones: Conjunto de extensiones a incluir (ej: {".py", ".js"}).
                     Si es None, usa _EXTENSIONES_AUDITABLES.
        solo_raiz: Si True, solo devuelve archivos directamente en `directorio`
                   (sin recursión).
    """
    extensiones = extensiones if extensiones is not None else _EXTENSIONES_AUDITABLES
    raiz = Path(directorio)
    resultado: list[Path] = []

    if solo_raiz:
        for f in raiz.iterdir():
            if f.is_file() and f.suffix in extensiones:
                resultado.append(f)
        return resultado

    # Precomputar subproyectos inmediatos para poda eficiente
    raices_subproyecto = _obtener_raices_subproyectos(raiz)
    nombres_excluidos = _EXCLUIR_SEGMENTOS_UNIVERSAL | {p.name for p in raices_subproyecto}

    for dirpath, dirnames, filenames in os.walk(str(raiz)):
        # Podar directorios excluidos y subproyectos EN SITIO (evita descender)
        dirnames[:] = [
            d for d in dirnames
            if d not in nombres_excluidos and not d.startswith("Auditoria")
        ]
        dp = Path(dirpath)
        for fname in filenames:
            f = dp / fname
            if extensiones and f.suffix not in extensiones:
                continue
            resultado.append(f)

    return resultado


_SUBPROYECTO_RAICES_CACHE: dict[str, frozenset] = {}


def _obtener_raices_subproyectos(raiz: "Path") -> frozenset:
    """
    Retorna el conjunto de rutas absolutas de subdirectorios inmediatos con .git propio.
    El resultado se cachea por raíz para evitar llamadas redundantes al sistema de archivos.
    """
    clave = str(raiz)
    if clave not in _SUBPROYECTO_RAICES_CACHE:
        raices = frozenset(
            d for d in raiz.iterdir()
            if d.is_dir() and (d / ".git").exists()
        )
        _SUBPROYECTO_RAICES_CACHE[clave] = raices
    return _SUBPROYECTO_RAICES_CACHE[clave]


def _es_subproyecto(archivo: "Path", raiz: "Path") -> bool:
    """
    Retorna True si el archivo pertenece a un subdirectorio que tiene su propio .git.
    Usa caché de raíces de subproyectos para evitar I/O redundante por archivo.
    """
    try:
        partes = archivo.relative_to(raiz).parts
        if not partes:
            return False
        # Comprobación rápida: ¿el primer componente es una raíz de subproyecto conocida?
        primer_nivel = raiz / partes[0]
        raices = _obtener_raices_subproyectos(raiz)
        if primer_nivel in raices:
            return True
        # Comprobación completa para rutas más profundas (subproyectos anidados)
        for i in range(2, len(partes)):
            subdir = raiz.joinpath(*partes[:i])
            if (subdir / ".git").exists():
                return True
    except ValueError:
        pass
    return False


def _verificar_secretos(directorio: str, reporte: ReporteQA, extensiones: list[str] = None):
    """Detecta credenciales hardcodeadas en archivos de código.
    Excluye archivos de subproyectos con su propio .git, .venv, dist, etc.
    """
    d = Path(directorio)
    extensiones = extensiones or ["*.py", "*.js", "*.ts", "*.env"]
    patrones = [
        (r'(?i)(api_key|apikey|secret_key|password|passwd)\s*=\s*["\'][^"\']{8,}["\']',
         "Credencial hardcodeada"),
        (r'sk-[A-Za-z0-9]{20,}', "API key de OpenAI"),
        (r'AKIA[0-9A-Z]{16}', "AWS Access Key ID"),
        (r'(?i)(Bearer\s+[A-Za-z0-9\-._~+/]{20,})', "Token Bearer en código"),
    ]

    # Convertir lista de extensiones glob (["*.py"]) a set de sufijos ({".py"})
    ext_set = {("." + e.lstrip("*.")) for e in extensiones} if extensiones else _EXTENSIONES_AUDITABLES
    archivos_a_revisar = _iterar_archivos_auditables(directorio, extensiones=ext_set)

    encontrados = []
    for archivo in archivos_a_revisar:
        try:
            contenido = archivo.read_text(encoding="utf-8", errors="ignore")
            for patron, descripcion in patrones:
                if re.search(patron, contenido):
                    encontrados.append(f"{descripcion} en {archivo.name}")
                    break
        except Exception:
            continue

    if encontrados:
        for e in encontrados:
            reporte.agregar("seguridad", f"🚨 {e}", "critico")
    else:
        reporte.agregar("seguridad", "No se detectaron credenciales hardcodeadas", "ok")


def _verificar_gitignore(directorio: str, reporte: ReporteQA):
    """Verifica que .gitignore excluya archivos sensibles."""
    d = confine(directorio)
    gitignore = d / ".gitignore"

    if not gitignore.exists():
        reporte.agregar("gitignore", ".gitignore no existe - credenciales podrían subirse a git", "advertencia")
        return

    contenido = gitignore.read_text(encoding="utf-8", errors="ignore")
    entradas_requeridas = [".env", "__pycache__", "node_modules", ".venv"]
    faltantes = [e for e in entradas_requeridas if e not in contenido]

    if faltantes:
        reporte.agregar("gitignore", f".gitignore falta: {', '.join(faltantes)}", "advertencia")
    else:
        reporte.agregar("gitignore", ".gitignore cubre entradas sensibles esenciales", "ok")


def verificar_ci(directorio: str, reporte: ReporteQA):
    """Verifica configuración de CI/CD."""
    d = Path(directorio)
    workflows = list(d.glob(".github/workflows/*.yml")) + list(d.glob(".github/workflows/*.yaml"))

    if not workflows:
        reporte.agregar("ci", "No hay workflows de GitHub Actions configurados", "advertencia")
    else:
        reporte.agregar("ci", f"{len(workflows)} workflow(s) de CI configurado(s)", "ok")


def verificar_readme(directorio: str, reporte: ReporteQA):
    """
    Check suave: README.md existe.
    No es crítico — solo advertencia si falta (no falla QA).
    """
    readme = Path(directorio) / "README.md"
    if not readme.exists():
        reporte.agregar(
            "documentacion",
            "README.md no existe — ejecutar: python actualizar_readme.py",
            "advertencia",
        )
    else:
        reporte.agregar("documentacion", "README.md presente", "ok")


# ─────────────────────────────────────────────
# MÓDULO 4b: SISTEMA DE MEMORIA DE ERRORES
# ─────────────────────────────────────────────

# Ubicación canónica del JSON de errores (workspace raíz de la plantilla)
_ERRORES_JSON_NOMBRE = "errores_aprendidos.json"


def _encontrar_errores_json(directorio: str) -> "Path | None":
    """
    Busca errores_aprendidos.json en el directorio del proyecto primero,
    luego sube al directorio padre (workspace raíz de la plantilla).
    Retorna None si no se encuentra en ninguno de los dos niveles.
    """
    d = Path(directorio)
    # 1. Mismo directorio del proyecto (subproyecto que recibió la copia)
    candidato_local = d / _ERRORES_JSON_NOMBRE
    if candidato_local.exists():
        return candidato_local
    # 2. Directorio padre (workspace raíz CURSORPLANTILLA-BASE)
    candidato_raiz = d.parent / _ERRORES_JSON_NOMBRE
    if candidato_raiz.exists():
        return candidato_raiz
    return None


def verificar_errores_aprendidos(directorio: str, reporte: "ReporteQA"):
    """
    Verifica si el proyecto contiene errores previamente aprendidos y registrados
    en errores_aprendidos.json.

    Pasos:
      1. Busca errores_aprendidos.json (local o en el workspace raíz).
      2. Para cada patrón, busca el patron_deteccion en los archivos del proyecto.
      3. Reporta coincidencias respetando la severidad del patrón.
      4. Incrementa veces_detectado en el JSON cuando detecta un match.
    """
    directorio = str(confine(directorio))
    ruta_json = _encontrar_errores_json(directorio)
    if ruta_json is None:
        # No bloquear: el JSON es opcional (subproyectos recién creados pueden no tenerlo)
        return

    try:
        datos = json.loads(ruta_json.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return

    patrones = datos.get("patrones", [])
    if not patrones:
        return

    # Recolectar archivos auditables usando os.walk con poda de directorios
    # (evita iterar node_modules, .venv y subproyectos independientes)
    archivos_auditables = _iterar_archivos_auditables(directorio)

    hubo_deteccion = False
    patrones_actualizados = False

    for patron in patrones:
        pid = patron.get("id", "???")
        descripcion = patron.get("descripcion", "")
        patron_str = patron.get("patron_deteccion", "")
        severidad = patron.get("severidad", "advertencia")
        tipos_patron = patron.get("tipo_proyecto", ["todos"])
        min_matches = patron.get("min_matches", 1)  # Por defecto, 1 coincidencia es suficiente

        # Filtrar por tipo: solo verificar si el patrón aplica a este tipo de proyecto
        tipo_proyecto = reporte.tipo_proyecto
        aplica = (
            "todos" in tipos_patron
            or tipo_proyecto in tipos_patron
            or any(tipo_proyecto.startswith(t) for t in tipos_patron)
        )
        if not aplica:
            continue

        # Compilar patrón: intentar como regex, fallback a substring
        try:
            regex = re.compile(patron_str, re.IGNORECASE)
            usar_regex = True
        except re.error:
            usar_regex = False

        archivos_con_match = []
        for archivo in archivos_auditables:
            try:
                contenido = archivo.read_text(encoding="utf-8", errors="ignore")
                if usar_regex:
                    coincidencias = regex.findall(contenido)
                    if len(coincidencias) >= min_matches:
                        archivos_con_match.append(archivo.name)
                else:
                    count = contenido.lower().count(patron_str.lower())
                    if count >= min_matches:
                        archivos_con_match.append(archivo.name)
            except OSError:
                continue

        if archivos_con_match:
            hubo_deteccion = True
            lista_archivos = ", ".join(archivos_con_match[:3])
            if len(archivos_con_match) > 3:
                lista_archivos += f" (+{len(archivos_con_match) - 3} más)"
            reporte.agregar(
                "memoria_errores",
                f"[{pid}] {descripcion} — detectado en: {lista_archivos}",
                severidad
            )
            # Incrementar contador de detecciones
            patron["veces_detectado"] = patron.get("veces_detectado", 0) + 1
            patrones_actualizados = True

    # Persistir los contadores actualizados si hubo detecciones
    if patrones_actualizados:
        try:
            datos["patrones"] = patrones
            confine_write(
                ruta_json,
                json.dumps(datos, ensure_ascii=False, indent=2),
            )
        except (OSError, ValueError):
            pass  # No crítico: fallo silencioso al actualizar contadores

    if not hubo_deteccion and patrones:
        reporte.agregar(
            "memoria_errores",
            f"Ningún patrón conocido detectado ({len(patrones)} patrones verificados)",
            "ok"
        )


# ─────────────────────────────────────────────
# MÓDULO 4c: DETECCIÓN DE ERRORES DE LÓGICA (ERR-009 a ERR-012)
# ─────────────────────────────────────────────

def verificar_logica(directorio: str, reporte: "ReporteQA"):
    """
    Ejecuta el detector de errores de lógica (detectar_logica.py) importándolo
    como módulo. Detecta: división por cero, None sin verificar, bucles infinitos,
    lógica de trading invertida, useEffect sin deps, mutación de estado React, etc.
    Si el script no existe, omite la verificación sin fallar.
    Limitado a 5 segundos adicionales al QA total.
    """
    import importlib.util
    import time

    raiz = Path(__file__).parent
    script = raiz / "detectar_logica.py"
    if not script.exists():
        script = Path(directorio) / "detectar_logica.py"
        if not script.exists():
            reporte.agregar(
                "logica",
                "detectar_logica.py no encontrado — omitiendo detección de errores de lógica",
                "info",
            )
            return

    t0 = time.time()
    try:
        spec = importlib.util.spec_from_file_location("detectar_logica", script)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        problemas, total_archivos = mod.analizar_directorio(directorio)
        elapsed = time.time() - t0

        criticos = [p for p in problemas if p.severidad == "critico"]
        advertencias = [p for p in problemas if p.severidad == "advertencia"]

        for p in criticos:
            nombre = Path(p.archivo).name
            reporte.agregar(
                "logica",
                f"[ERR-LOGICA] {nombre}:{p.linea} — {p.mensaje}",
                "critico",
                archivo=nombre,
                linea=p.linea,
            )
        for p in advertencias:
            nombre = Path(p.archivo).name
            reporte.agregar(
                "logica",
                f"[ERR-LOGICA] {nombre}:{p.linea} — {p.mensaje}",
                "advertencia",
                archivo=nombre,
                linea=p.linea,
            )

        if not criticos and not advertencias:
            reporte.agregar(
                "logica",
                (
                    f"Sin errores de lógica detectados "
                    f"({total_archivos} archivo(s) verificados, {elapsed:.2f}s)"
                ),
                "ok",
            )
        elif not criticos:
            reporte.agregar(
                "logica",
                (
                    f"{len(advertencias)} advertencia(s) de lógica — "
                    f"revisión recomendada ({elapsed:.2f}s)"
                ),
                "advertencia",
            )

    except Exception as e:
        elapsed = time.time() - t0
        reporte.agregar(
            "logica",
            f"Error al ejecutar detectar_logica: {e} ({elapsed:.2f}s)",
            "advertencia",
        )


# ─────────────────────────────────────────────
# MÓDULO 4d: VERIFICACIÓN DE CONECTORES SUELTOS (ERR-008)
# ─────────────────────────────────────────────

def verificar_conectores_sueltos(directorio: str, reporte: "ReporteQA"):
    """
    Ejecuta verificar_conectores.py como módulo importado para detectar
    referencias rotas (imports, llamadas a funciones, handlers JSX, etc.).
    Si el script no existe, omite la verificación sin fallar.
    Limitado a 5 segundos adicionales máximo (timeout de seguridad).
    """
    import importlib.util
    import time

    raiz = Path(__file__).parent
    script = raiz / "verificar_conectores.py"

    if not script.exists():
        # Intentar en el directorio del proyecto (subproyecto con copia)
        script = Path(directorio) / "verificar_conectores.py"
        if not script.exists():
            reporte.agregar(
                "conectores",
                "verificar_conectores.py no encontrado — omitiendo verificación ERR-008",
                "info",
            )
            return

    t0 = time.time()
    try:
        spec = importlib.util.spec_from_file_location("verificar_conectores", script)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        resultado = mod.verificar_conectores(directorio)
        elapsed = time.time() - t0

        rotos = resultado.get("rotos", [])
        sospechosos = resultado.get("sospechosos", [])
        verificados = resultado.get("verificados", 0)

        if rotos:
            for c in rotos:
                reporte.agregar(
                    "conectores",
                    f"[ERR-008] {c['mensaje']}",
                    "critico",
                    archivo=c.get("archivo"),
                    linea=c.get("linea"),
                )
        if sospechosos:
            for c in sospechosos:
                reporte.agregar(
                    "conectores",
                    f"[ERR-008] {c['mensaje']}",
                    "advertencia",
                    archivo=c.get("archivo"),
                    linea=c.get("linea"),
                )
        if not rotos and not sospechosos:
            reporte.agregar(
                "conectores",
                f"No se detectaron conectores sueltos ({verificados} archivo(s) verificados, {elapsed:.2f}s)",
                "ok",
            )
        elif not rotos:
            reporte.agregar(
                "conectores",
                f"{len(sospechosos)} conector(es) sospechoso(s) — revisión manual recomendada",
                "advertencia",
            )

    except Exception as e:
        elapsed = time.time() - t0
        reporte.agregar(
            "conectores",
            f"Error al ejecutar verificar_conectores: {e} ({elapsed:.2f}s)",
            "advertencia",
        )


# ─────────────────────────────────────────────
# MÓDULO 4e: VERIFICACIÓN DE MÓDULOS Y MODALES UI
# ─────────────────────────────────────────────

def verificar_modulos_proyecto(directorio: str, reporte: "ReporteQA"):
    """
    Ejecuta verificar_modulos.py (módulos documentados + modales UI).
    Si el import falla, aviso — no crash.
    """
    import importlib.util
    import time

    raiz = Path(__file__).parent
    script = raiz / "verificar_modulos.py"
    if not script.exists():
        script = Path(directorio) / "verificar_modulos.py"
        if not script.exists():
            reporte.agregar(
                "modulos",
                "verificar_modulos.py no encontrado — omitiendo módulos/modales",
                "info",
            )
            return

    t0 = time.time()
    try:
        spec = importlib.util.spec_from_file_location("verificar_modulos", script)
        if spec is None or spec.loader is None:
            reporte.agregar(
                "modulos",
                "No se pudo cargar verificar_modulos.py — omitiendo",
                "advertencia",
            )
            return
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        resultado = mod.verificar_modulos(directorio)
        elapsed = time.time() - t0

        criticos = resultado.get("criticos", [])
        advertencias = resultado.get("advertencias", [])
        verificados = resultado.get("verificados", 0)

        for h in criticos:
            reporte.agregar(
                "modulos",
                f"[MODULOS] {h.get('mensaje', '')}",
                "critico",
                archivo=h.get("archivo"),
                linea=h.get("linea"),
            )
        for h in advertencias:
            reporte.agregar(
                "modulos",
                f"[MODULOS] {h.get('mensaje', '')}",
                "advertencia",
                archivo=h.get("archivo"),
                linea=h.get("linea"),
            )
        if not criticos and not advertencias:
            reporte.agregar(
                "modulos",
                (
                    f"Módulos y modales OK "
                    f"({verificados} archivo(s), {elapsed:.2f}s)"
                ),
                "ok",
            )
        elif not criticos:
            reporte.agregar(
                "modulos",
                (
                    f"{len(advertencias)} aviso(s) de módulos/modales "
                    f"({elapsed:.2f}s)"
                ),
                "advertencia",
            )
    except Exception as e:
        elapsed = time.time() - t0
        reporte.agregar(
            "modulos",
            f"Error al ejecutar verificar_modulos: {e} ({elapsed:.2f}s)",
            "advertencia",
        )


# ─────────────────────────────────────────────
# MÓDULO 4f: MAPA DEL PROYECTO (PIEZAS + DOCS + CONEXIÓN)
# ─────────────────────────────────────────────

def verificar_mapa_proyecto(directorio: str, reporte: "ReporteQA"):
    """
    Ejecuta mapa_proyecto.py (inventario + desfase docs/código).
    Si MAPA.md ya existe, no lo pisa: 4c-4e ya corrieron y un rewrite
    con incluir_subchecks=False borraría la sección Conexión.
    Si falta, lo crea con sub-checks para que nazca completo.
    """
    import importlib.util
    import time

    raiz = Path(__file__).parent
    script = raiz / "mapa_proyecto.py"
    if not script.exists():
        script = Path(directorio) / "mapa_proyecto.py"
        if not script.exists():
            reporte.agregar(
                "mapa",
                "mapa_proyecto.py no encontrado — omitiendo mapa unificado",
                "info",
            )
            return

    t0 = time.time()
    try:
        spec = importlib.util.spec_from_file_location("mapa_proyecto", script)
        if spec is None or spec.loader is None:
            reporte.agregar(
                "mapa",
                "No se pudo cargar mapa_proyecto.py — omitiendo",
                "advertencia",
            )
            return
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        mapa_path = Path(directorio) / "MAPA.md"
        falta_mapa = not mapa_path.exists()
        resultado = mod.mapa_proyecto(
            directorio,
            escribir_mapa=falta_mapa,
            incluir_subchecks=falta_mapa,
        )
        elapsed = time.time() - t0

        estado = resultado.get("estado") or "?"
        dv = resultado.get("docs_vs_codigo") or {}
        criticos = dv.get("criticos") or []
        avisos = dv.get("avisos") or []

        for h in criticos:
            reporte.agregar(
                "mapa",
                f"[MAPA] {h.get('mensaje', '')}",
                "critico",
                archivo=h.get("archivo"),
                linea=h.get("linea"),
            )
        for h in avisos:
            reporte.agregar(
                "mapa",
                f"[MAPA] {h.get('mensaje', '')}",
                "advertencia",
                archivo=h.get("archivo"),
            )
        extra = ""
        if falta_mapa and resultado.get("mapa_escrito"):
            extra = " — MAPA.md creado"
        if not criticos and not avisos:
            reporte.agregar(
                "mapa",
                f"Mapa {estado} ({elapsed:.2f}s){extra}",
                "ok",
            )
        elif not criticos:
            reporte.agregar(
                "mapa",
                f"Mapa {estado}: {len(avisos)} aviso(s) ({elapsed:.2f}s)",
                "advertencia",
            )
    except Exception as e:
        elapsed = time.time() - t0
        reporte.agregar(
            "mapa",
            f"Error al ejecutar mapa_proyecto: {e} ({elapsed:.2f}s)",
            "advertencia",
        )


# ─────────────────────────────────────────────
# MÓDULO 5: ORQUESTADOR PRINCIPAL
# ─────────────────────────────────────────────

def ejecutar_qa(directorio: str) -> ReporteQA:
    """
    Ejecuta el ciclo completo de QA para el proyecto en el directorio dado.
    Detecta el tipo automáticamente y aplica las verificaciones correspondientes.
    """
    directorio = os.path.abspath(directorio)
    tipo = detectar_tipo_proyecto(directorio)
    reporte = ReporteQA(tipo_proyecto=tipo, directorio=directorio)

    # Verificaciones universales
    verificar_ci(directorio, reporte)
    verificar_readme(directorio, reporte)

    # Verificaciones por tipo de proyecto
    tipo_handlers = {
        "python": verificar_python,
        "python-web": verificar_python,
        "python-ml": verificar_python,
        "python-trading": verificar_python,
        "mql5": verificar_mql5,
        "nodejs": verificar_nodejs,
        "nodejs-api": verificar_nodejs,
        "react": verificar_nodejs,
        "react-native": verificar_nodejs,
        "nextjs": verificar_nodejs,
        "android": verificar_android,
        "rust": verificar_rust,
        "go": verificar_go,
    }

    handler = tipo_handlers.get(tipo)
    if handler:
        handler(directorio, reporte)
    else:
        reporte.agregar("deteccion", f"Tipo de proyecto '{tipo}' no tiene verificaciones específicas", "info")
        # Verificaciones genéricas para tipo desconocido
        _verificar_gitignore(directorio, reporte)

    # Verificación de patrones aprendidos (memoria QA acumulada)
    verificar_errores_aprendidos(directorio, reporte)

    # Verificación de errores de lógica (ERR-009 a ERR-012) — módulo 4c
    verificar_logica(directorio, reporte)

    # Verificación de conectores sueltos (ERR-008) — módulo 4d
    verificar_conectores_sueltos(directorio, reporte)

    # Verificación de módulos y modales UI — módulo 4e
    verificar_modulos_proyecto(directorio, reporte)

    # Mapa unificado (piezas + docs vs código) — módulo 4f
    verificar_mapa_proyecto(directorio, reporte)

    return reporte


# ─────────────────────────────────────────────
# MÓDULO 6: GENERADOR DE REPORTE
# ─────────────────────────────────────────────

def imprimir_reporte(reporte: ReporteQA, formato_json: bool = False):
    """Imprime el reporte de QA en formato legible o JSON."""
    if formato_json:
        data = {
            "tipo_proyecto": reporte.tipo_proyecto,
            "directorio": reporte.directorio,
            "resumen": {
                "criticos": len(reporte.criticos),
                "advertencias": len(reporte.advertencias),
                "oks": len(reporte.oks),
            },
            "resultados": [
                {
                    "categoria": r.categoria,
                    "mensaje": r.mensaje,
                    "severidad": r.severidad,
                    "archivo": r.archivo,
                    "linea": r.linea,
                }
                for r in reporte.resultados
            ],
        }
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    # Formato visual
    print("\n" + "═" * 60)
    print(f"  🔍 REPORTE DE AUDITORÍA AUTÓNOMA")
    print(f"  Proyecto: {reporte.tipo_proyecto.upper()}")
    print(f"  Directorio: {reporte.directorio}")
    print("═" * 60)

    # Críticos
    if reporte.criticos:
        print(f"\n❌ ERRORES CRÍTICOS ({len(reporte.criticos)}):")
        for r in reporte.criticos:
            ubicacion = f" [{r.archivo}:{r.linea}]" if r.archivo else ""
            print(f"   [{r.categoria.upper()}]{ubicacion} {r.mensaje}")

    # Advertencias
    if reporte.advertencias:
        print(f"\n⚠️  ADVERTENCIAS ({len(reporte.advertencias)}):")
        for r in reporte.advertencias:
            ubicacion = f" [{r.archivo}]" if r.archivo else ""
            print(f"   [{r.categoria.upper()}]{ubicacion} {r.mensaje}")

    # OKs
    if reporte.oks:
        print(f"\n✅ VERIFICACIONES EXITOSAS ({len(reporte.oks)}):")
        for r in reporte.oks:
            print(f"   [{r.categoria.upper()}] {r.mensaje}")

    # Info
    infos = [r for r in reporte.resultados if r.severidad == "info"]
    if infos:
        print(f"\nℹ️  INFO:")
        for r in infos:
            print(f"   {r.mensaje}")

    # Resumen final
    print("\n" + "─" * 60)
    estado = "🚨 PROYECTO CON ERRORES" if reporte.criticos else (
        "⚠️  PROYECTO CON ADVERTENCIAS" if reporte.advertencias else "✅ PROYECTO EN BUEN ESTADO"
    )
    print(f"  {estado}")
    print(f"  Críticos: {len(reporte.criticos)} | "
          f"Advertencias: {len(reporte.advertencias)} | "
          f"OK: {len(reporte.oks)}")
    print("═" * 60 + "\n")


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

    reporte = ejecutar_qa(directorio)
    imprimir_reporte(reporte, formato_json)

    # Exit code no-cero si hay errores críticos (útil para CI/CD)
    sys.exit(1 if reporte.criticos else 0)


if __name__ == "__main__":
    main()
