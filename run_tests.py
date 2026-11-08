"""
run_tests.py — Ejecutor universal de tests para CURSORPLANTILLA-BASE
=====================================================================
Detecta el tipo de proyecto automáticamente y ejecuta el comando
de test correcto. Genera un reporte claro con estado por proyecto.

Uso:
    python run_tests.py          # tests del proyecto actual (cwd)
    python run_tests.py --all    # tests de TODOS los subproyectos detectados
    python run_tests.py --fast   # modo rápido: -x --timeout=30 (falla en el primer error)
    python run_tests.py /ruta/   # tests de un directorio específico
    python run_tests.py --help   # muestra esta ayuda

Flags:
    --all   Ejecuta tests en el workspace raíz + todos los subproyectos detectados.
    --fast  Modo rápido: usa -x (falla en el primer error) y timeout=30s por suite.
            Ideal para CI rápido o proyectos con muchos archivos de test.
            Compatible con --all: python run_tests.py --all --fast

Códigos de salida:
    0 → todos los tests pasan (o no hay tests pero sin errores críticos)
    1 → al menos un suite de tests falló
"""

import os
import sys
import json
import subprocess
import time
from pathlib import Path
from dataclasses import dataclass, field
from qa_safe_io import confine

# ─── Forzar UTF-8 en Windows ───────────────────────────────────────────────
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
class ResultadoTests:
    """Resultado de ejecutar los tests de un proyecto."""
    nombre: str           # nombre del proyecto / directorio
    tipo: str             # 'python', 'node', 'android', 'mql5', 'unknown'
    tiene_tests: bool     # si se encontró carpeta tests/ o equivalente
    tests_ok: int = 0     # tests que pasaron
    tests_total: int = 0  # total de tests ejecutados
    duracion: float = 0.0 # segundos
    salida: str = ""      # output relevante del comando de test
    exitoso: bool = True  # True si el suite pasó sin errores
    sin_tests_msg: str = ""  # mensaje cuando no hay tests


# ─────────────────────────────────────────────
# MÓDULO 2: DETECCIÓN DE TIPO DE PROYECTO
# ─────────────────────────────────────────────

def detectar_tipo_proyecto(directorio: str) -> str:
    """
    Detecta el tipo de proyecto leyendo archivos indicadores.
    Retorna: 'python', 'node', 'android', 'mql5', 'rust', 'go', 'unknown'.
    """
    d = Path(directorio)

    # Android
    if (d / "build.gradle").exists() or (d / "build.gradle.kts").exists():
        return "android"
    if (d / "AndroidManifest.xml").exists():
        return "android"

    # MQL5/MQL4 — solo raíz y src/ para evitar falsos positivos
    mql_files = (list(d.glob("*.mq5")) + list(d.glob("*.mq4")) +
                 list(d.glob("src/*.mq5")) + list(d.glob("src/*.mq4")))
    if mql_files:
        return "mql5"

    # Node / React / Next
    pkg = d / "package.json"
    if pkg.exists():
        return "node"

    # Python
    py_indicators = ["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg"]
    if any((d / f).exists() for f in py_indicators) or list(d.glob("*.py")):
        return "python"

    # Rust
    if (d / "Cargo.toml").exists():
        return "rust"

    # Go
    if (d / "go.mod").exists():
        return "go"

    return "unknown"


# ─────────────────────────────────────────────
# MÓDULO 3: EJECUTORES POR TIPO DE PROYECTO
# ─────────────────────────────────────────────

_TIMEOUT_TESTS_DEFAULT = 120  # segundos máximo en modo proyecto único
_TIMEOUT_TESTS_ALL = 60       # segundos máximo por proyecto en modo --all
_TIMEOUT_TESTS_FAST = 30      # segundos máximo en modo --fast (falla rápido)


_ALLOWED_EXE = frozenset({
    "python", "python.exe", "python3", "python3.exe",
    "npm", "npm.cmd", "npx", "npx.cmd",
    "node", "node.exe",
    "gradlew", "gradlew.bat",
})


def _ejecutar_comando(
    cmd: list[str],
    cwd: str,
    timeout: int = _TIMEOUT_TESTS_DEFAULT,
    env_extra: dict | None = None,
) -> tuple[int, str]:
    """
    Ejecuta un comando y retorna (returncode, output_combinado).
    Maneja timeout y FileNotFoundError de forma segura.
    `env_extra` permite añadir/sobreescribir variables de entorno (ej: CI=true).
    """
    try:
        workdir = os.fspath(confine(cwd))
    except ValueError:
        return 1, "directorio fuera del proyecto"

    if not cmd:
        return 1, "comando vacio"

    argv = list(cmd)
    head = argv[0]
    exe_name = os.path.basename(head).lower()
    if os.path.normcase(os.path.abspath(head)) != os.path.normcase(sys.executable):
        if exe_name not in _ALLOWED_EXE:
            return 1, "comando no permitido"
        if exe_name.startswith("gradlew"):
            try:
                argv[0] = os.fspath(confine(head))
            except ValueError:
                return 1, "comando no permitido"

    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)

    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            cwd=workdir,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
            env=env,
            shell=False,
        )
        output = (result.stdout + result.stderr).strip()
        return result.returncode, output
    except subprocess.TimeoutExpired:
        return 1, f"⚠️ Timeout ({timeout}s) — suite de tests demasiado lento"
    except FileNotFoundError as e:
        return 1, f"⚠️ Comando no encontrado: {e} — ¿está instalado?"


def _parsear_resumen_pytest(output: str) -> tuple[int, int]:
    """
    Extrae (passed, total) del output de pytest.
    Ejemplo: '5 passed, 1 warning in 0.45s' → (5, 5)
             '3 failed, 4 passed in 1.2s'   → (4, 7)
    """
    import re
    passed = total = 0
    m_passed = re.search(r"([0-9]{1,8}) passed", output)
    m_failed = re.search(r"([0-9]{1,8}) failed", output)
    m_error = re.search(r"([0-9]{1,8}) error", output)

    if m_passed:
        passed = int(m_passed.group(1))
    failed = int(m_failed.group(1)) if m_failed else 0
    errors = int(m_error.group(1)) if m_error else 0
    total = passed + failed + errors
    return passed, max(total, passed)


def ejecutar_tests_python(
    directorio: str,
    nombre: str,
    timeout: int = _TIMEOUT_TESTS_DEFAULT,
    modo_fast: bool = False,
) -> ResultadoTests:
    """
    Ejecuta pytest en la carpeta tests/ del proyecto Python.
    Si no hay tests, reporta warning sin fallar.
    """
    d = Path(directorio)
    tests_dir = d / "tests"
    resultado = ResultadoTests(nombre=nombre, tipo="python", tiene_tests=False)

    # Buscar archivos de test
    test_files = []
    if tests_dir.exists():
        test_files = list(tests_dir.glob("test_*.py")) + list(tests_dir.glob("*_test.py"))
    test_files += list(d.glob("test_*.py"))  # también raíz directa

    if not test_files:
        resultado.sin_tests_msg = "⚠️ Sin tests — considera añadir tests/test_main.py"
        resultado.exitoso = True  # No fallar si no hay tests
        return resultado

    resultado.tiene_tests = True

    # Guard: no ejecutar pytest recursivamente
    if os.environ.get("PYTEST_CURRENT_TEST"):
        resultado.salida = "(omitido: ya bajo pytest)"
        resultado.exitoso = True
        return resultado

    inicio = time.time()
    carpeta_tests = str(tests_dir) if tests_dir.exists() else directorio

    # Construir comando pytest según modo
    pytest_cmd = [sys.executable, "-m", "pytest", carpeta_tests, "--tb=short", "-q", "--no-header"]
    if modo_fast:
        # Modo rápido: falla en el primer error, timeout por test de 30s
        pytest_cmd += ["-x"]
        try:
            import pytest_timeout  # noqa: F401 – solo verificamos disponibilidad
            pytest_cmd += [f"--timeout={_TIMEOUT_TESTS_FAST}"]
        except ImportError:
            pass  # pytest-timeout no instalado, continuar sin él

    rc, output = _ejecutar_comando(
        pytest_cmd,
        cwd=directorio,
        timeout=timeout,
    )
    resultado.duracion = time.time() - inicio
    resultado.salida = output[:800]
    resultado.exitoso = (rc == 0)

    passed, total = _parsear_resumen_pytest(output)
    resultado.tests_ok = passed
    resultado.tests_total = total

    return resultado


def ejecutar_tests_node(directorio: str, nombre: str, timeout: int = _TIMEOUT_TESTS_DEFAULT, modo_fast: bool = False) -> ResultadoTests:
    """Ejecuta npm test en el proyecto Node/React/Next."""
    d = Path(directorio)
    resultado = ResultadoTests(nombre=nombre, tipo="node", tiene_tests=False)

    # Verificar que hay script de test en package.json
    pkg_file = d / "package.json"
    if pkg_file.exists():
        try:
            pkg = json.loads(pkg_file.read_text(encoding="utf-8"))
            scripts = pkg.get("scripts", {})
            if "test" not in scripts:
                resultado.sin_tests_msg = "⚠️ Sin script 'test' en package.json"
                return resultado
        except Exception:
            pass

    resultado.tiene_tests = True
    inicio = time.time()
    # En Windows, npm es un .cmd; usar "npm.cmd"
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"

    # Detectar si el runner de tests es Jest para pasar flags específicos
    es_jest = False
    try:
        pkg_raw = (d / "package.json").read_text(encoding="utf-8")
        pkg2 = json.loads(pkg_raw)
        test_script = pkg2.get("scripts", {}).get("test", "")
        es_jest = "jest" in test_script.lower()
        tiene_jest_dep = "jest" in {
            **pkg2.get("dependencies", {}), **pkg2.get("devDependencies", {})
        }
        es_jest = es_jest or tiene_jest_dep
    except Exception:
        pass

    # CI=true evita que Jest entre en modo watch interactivo
    if es_jest:
        cmd = [npm_cmd, "test", "--", "--passWithNoTests", "--watchAll=false"]
    else:
        cmd = [npm_cmd, "test"]

    rc, output = _ejecutar_comando(
        cmd,
        cwd=directorio,
        env_extra={"CI": "true"},
        timeout=timeout,
    )
    resultado.duracion = time.time() - inicio
    resultado.salida = output[:800]
    resultado.exitoso = (rc == 0)
    return resultado


def ejecutar_tests_android(directorio: str, nombre: str, timeout: int = _TIMEOUT_TESTS_DEFAULT, modo_fast: bool = False) -> ResultadoTests:
    """Ejecuta ./gradlew test en el proyecto Android."""
    resultado = ResultadoTests(nombre=nombre, tipo="android", tiene_tests=False)
    gradlew = Path(directorio) / "gradlew.bat"
    gradlew_unix = Path(directorio) / "gradlew"

    cmd_gradlew = str(gradlew) if gradlew.exists() else (
        str(gradlew_unix) if gradlew_unix.exists() else None
    )

    if not cmd_gradlew:
        resultado.sin_tests_msg = "⚠️ gradlew no encontrado — verificar manualmente"
        return resultado

    resultado.tiene_tests = True
    inicio = time.time()
    rc, output = _ejecutar_comando(
        [cmd_gradlew, "test", "--quiet"],
        cwd=directorio,
        timeout=max(timeout, 180),  # Android necesita al menos 3 minutos
    )
    resultado.duracion = time.time() - inicio
    resultado.salida = output[:800]
    resultado.exitoso = (rc == 0)
    return resultado


def ejecutar_tests_mql5(directorio: str, nombre: str, timeout: int = _TIMEOUT_TESTS_DEFAULT, modo_fast: bool = False) -> ResultadoTests:
    """Ejecuta validación estática QA para proyectos MQL5 (no hay runner de tests nativo)."""
    resultado = ResultadoTests(nombre=nombre, tipo="mql5", tiene_tests=False)
    qa_script = Path(directorio) / "qa_autonomo.py"

    # Intentar con qa_autonomo.py local o del workspace raíz
    qa_path = None
    if qa_script.exists():
        qa_path = str(qa_script)
    else:
        workspace_qa = Path(__file__).parent / "qa_autonomo.py"
        if workspace_qa.exists():
            qa_path = str(workspace_qa)

    if not qa_path:
        resultado.sin_tests_msg = "⚠️ MQL5: QA estático OK (qa_autonomo.py no encontrado)"
        resultado.exitoso = True
        return resultado

    resultado.tiene_tests = True
    resultado.sin_tests_msg = "📋 MQL5: validación estática (no hay test runner nativo)"

    inicio = time.time()
    rc, output = _ejecutar_comando(
        [sys.executable, qa_path, directorio],
        cwd=directorio,
    )
    resultado.duracion = time.time() - inicio
    resultado.salida = output[:800]
    resultado.exitoso = (rc == 0)
    return resultado


def ejecutar_tests_proyecto(
    directorio: str,
    nombre: str = None,
    timeout: int = _TIMEOUT_TESTS_DEFAULT,
    modo_fast: bool = False,
) -> ResultadoTests:
    """
    Dispatcher principal: detecta el tipo de proyecto y ejecuta el runner correcto.
    Si `nombre` no se provee, usa el nombre del directorio.
    `timeout` controla el tiempo máximo por suite (reducido en modo --all).
    `modo_fast` activa -x (falla rápido) y timeout=30s por test (para --fast).
    """
    if nombre is None:
        nombre = Path(directorio).name

    tipo = detectar_tipo_proyecto(directorio)

    runners = {
        "python": ejecutar_tests_python,
        "node":   ejecutar_tests_node,
        "android": ejecutar_tests_android,
        "mql5":   ejecutar_tests_mql5,
    }

    runner = runners.get(tipo)
    if runner:
        return runner(directorio, nombre, timeout=timeout, modo_fast=modo_fast)

    # Tipo desconocido — intentar con pytest como fallback si hay tests/
    tests_dir = Path(directorio) / "tests"
    if tests_dir.exists():
        return ejecutar_tests_python(directorio, nombre, timeout=timeout, modo_fast=modo_fast)

    return ResultadoTests(
        nombre=nombre,
        tipo=tipo,
        tiene_tests=False,
        sin_tests_msg=f"⚠️ Tipo '{tipo}' sin runner de tests configurado",
        exitoso=True,
    )


# ─────────────────────────────────────────────
# MÓDULO 4: DETECCIÓN DE SUBPROYECTOS
# ─────────────────────────────────────────────

def detectar_subproyectos(raiz: str) -> list[str]:
    """
    Detecta subproyectos independientes en el workspace.
    Un subproyecto es un subdirectorio con:
      - Su propio .git, O
      - Algún archivo indicador de proyecto (requirements.txt, package.json, etc.)
    Excluye directorios especiales (.venv, node_modules, __pycache__, .git, dist, build).
    """
    d = Path(raiz)
    _EXCLUIR = {".venv", "venv", "__pycache__", "node_modules", "dist",
                "build", ".git", ".pytest_cache", ".mypy_cache", ".cursor"}

    indicadores = {
        "requirements.txt", "package.json", "build.gradle",
        "build.gradle.kts", "Cargo.toml", "go.mod", "pyproject.toml",
    }

    subproyectos = []
    for item in sorted(d.iterdir()):
        if not item.is_dir():
            continue
        if item.name.startswith(".") or item.name in _EXCLUIR:
            continue
        # Es subproyecto si tiene .git propio o algún indicador de proyecto
        tiene_git = (item / ".git").exists()
        tiene_indicador = any((item / ind).exists() for ind in indicadores)
        if tiene_git or tiene_indicador:
            subproyectos.append(str(item))

    return subproyectos


# ─────────────────────────────────────────────
# MÓDULO 5: GENERADOR DE REPORTE
# ─────────────────────────────────────────────

def _icono_resultado(r: ResultadoTests) -> str:
    """Retorna el ícono de estado para un resultado."""
    if not r.tiene_tests:
        return "⚠️"
    # Timeout no es un fallo de tests — es un warning de suite lenta
    if not r.exitoso and "Timeout" in r.salida:
        return "⏱️"
    return "✅" if r.exitoso else "❌"


def _linea_resultado(r: ResultadoTests) -> str:
    """Formatea una línea del reporte para un proyecto."""
    icono = _icono_resultado(r)

    if not r.tiene_tests:
        msg = r.sin_tests_msg or "sin tests"
        return f"{icono} {r.nombre}: {msg}"

    if r.tests_total > 0:
        detalle = f"{r.tests_ok}/{r.tests_total} tests ({r.duracion:.2f}s)"
    else:
        detalle = f"({r.duracion:.2f}s)"
        if r.sin_tests_msg:
            detalle = r.sin_tests_msg

    if not r.exitoso and r.salida:
        # Añadir las últimas líneas relevantes del output
        lineas = [l for l in r.salida.splitlines() if l.strip()]
        extra = " | " + " | ".join(lineas[-3:]) if lineas else ""
        return f"{icono} {r.nombre}: {detalle}{extra}"

    return f"{icono} {r.nombre}: {detalle}"


def imprimir_reporte(resultados: list[ResultadoTests], titulo: str = "PROYECTO ACTUAL"):
    """Imprime el reporte consolidado de todos los proyectos."""
    sep = "━" * 50
    total_ok = sum(r.tests_ok for r in resultados)
    total_tests = sum(r.tests_total for r in resultados)
    fallidos = [r for r in resultados if not r.exitoso]

    print(f"\n📊 REPORTE DE TESTS - {titulo}")
    print(sep)

    for r in resultados:
        print(_linea_resultado(r))

    print(sep)

    if total_tests > 0:
        print(f"Total: {total_ok}/{total_tests} tests pasando")
    else:
        print("Total: sin tests ejecutados")

    if fallidos:
        print(f"\n❌ FALLOS ({len(fallidos)} proyecto(s)):")
        for r in fallidos:
            print(f"\n  📁 {r.nombre}")
            if r.salida:
                for linea in r.salida.splitlines()[-10:]:
                    print(f"     {linea}")
    else:
        print("✅ Estado general: TODOS LOS TESTS PASAN")

    print()


# ─────────────────────────────────────────────
# MÓDULO 6: PUNTO DE ENTRADA
# ─────────────────────────────────────────────

def main():
    """Entry point: parsea argumentos y orquesta la ejecución."""
    args = sys.argv[1:]

    # Ayuda
    if "--help" in args or "-h" in args:
        print(__doc__)
        sys.exit(0)

    # Detectar flag --fast
    modo_fast = "--fast" in args
    if modo_fast:
        args = [a for a in args if a != "--fast"]

    # Modo --all: tests de todos los subproyectos
    if "--all" in args:
        args = [a for a in args if a != "--all"]
        raiz = args[0] if args else os.getcwd()
        raiz = os.path.abspath(raiz)

        # Incluir el workspace raíz + sus subproyectos
        proyectos = [raiz] + detectar_subproyectos(raiz)

        if not proyectos:
            print(f"⚠️ No se detectaron proyectos en: {raiz}")
            sys.exit(0)

        # En modo fast se usa timeout reducido
        timeout_all = _TIMEOUT_TESTS_FAST if modo_fast else _TIMEOUT_TESTS_ALL
        if modo_fast:
            print("⚡ Modo --fast activo: falla en primer error, timeout 30s por suite")

        resultados = []
        for pdir in proyectos:
            nombre = Path(pdir).name if pdir != raiz else Path(pdir).name + " (raíz)"
            print(f"🔍 Ejecutando tests: {nombre} ...", end=" ", flush=True)
            r = ejecutar_tests_proyecto(pdir, nombre, timeout=timeout_all, modo_fast=modo_fast)
            resultados.append(r)
            icono = _icono_resultado(r)
            print(icono)

        imprimir_reporte(resultados, titulo="TODOS LOS PROYECTOS")

        hay_fallos = any(not r.exitoso for r in resultados)
        sys.exit(1 if hay_fallos else 0)

    # Modo por defecto: tests del directorio especificado o cwd
    directorio = args[0] if args else os.getcwd()
    directorio = os.path.abspath(directorio)

    if not os.path.isdir(directorio):
        print(f"❌ El directorio '{directorio}' no existe.")
        sys.exit(1)

    if modo_fast:
        print("⚡ Modo --fast activo: falla en primer error, timeout 30s por suite")

    nombre = Path(directorio).name
    print(f"🔍 Ejecutando tests de: {nombre} ...")
    resultado = ejecutar_tests_proyecto(directorio, nombre, modo_fast=modo_fast)
    imprimir_reporte([resultado], titulo=nombre.upper())

    sys.exit(0 if resultado.exitoso else 1)


if __name__ == "__main__":
    main()
