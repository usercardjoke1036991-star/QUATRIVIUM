"""
Hook: post-edit-qa.py
Evento: afterFileEdit
Propósito: Auditar archivos después de que el agente los edite.
           Lee el archivo editado, valida sintaxis y lógica básica,
           retorna contexto adicional para que el agente corrija errores.
"""

import sys
import json
import os
import ast
import re
import subprocess


def leer_input_hook() -> dict:
    """Lee el JSON de entrada del hook desde stdin."""
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, Exception):
        return {}


def detectar_tipo_archivo(ruta: str) -> str:
    """Determina el tipo de archivo por extensión."""
    ext = os.path.splitext(ruta)[1].lower()
    mapa = {
        ".py": "python",
        ".js": "javascript",
        ".ts": "typescript",
        ".jsx": "javascript",
        ".tsx": "typescript",
        ".kt": "kotlin",
        ".java": "java",
        ".mq4": "mql4",
        ".mq5": "mql5",
        ".mqh": "mql_header",
        ".go": "go",
        ".rs": "rust",
        ".cs": "csharp",
    }
    return mapa.get(ext, "unknown")


def validar_python(ruta: str) -> list[str]:
    """Valida sintaxis de archivo Python. Retorna lista de errores."""
    errores = []
    try:
        with open(ruta, "r", encoding="utf-8", errors="ignore") as f:
            codigo = f.read()
        ast.parse(codigo)
    except SyntaxError as e:
        errores.append(f"SyntaxError en línea {e.lineno}: {e.msg}")
    except Exception as e:
        errores.append(f"Error leyendo archivo: {e}")
    return errores


def detectar_secretos_hardcodeados(ruta: str) -> list[str]:
    """Detecta posibles credenciales hardcodeadas en cualquier archivo de texto."""
    advertencias = []
    patrones_peligrosos = [
        (r'(?i)(api_key|apikey|secret_key|password|passwd|token)\s*=\s*["\'][^"\']{8,}["\']',
         "Posible credencial hardcodeada"),
        (r'(?i)(Bearer\s+[A-Za-z0-9\-._~+/]{20,})',
         "Posible token Bearer en código"),
        (r'(?i)(sk-[A-Za-z0-9]{20,})',
         "Posible API key de OpenAI"),
        (r'(?i)(AKIA[0-9A-Z]{16})',
         "Posible AWS Access Key ID"),
    ]
    try:
        with open(ruta, "r", encoding="utf-8", errors="ignore") as f:
            contenido = f.read()
        for patron, mensaje in patrones_peligrosos:
            if re.search(patron, contenido):
                advertencias.append(f"⚠️ {mensaje} detectado en {os.path.basename(ruta)}")
    except Exception:
        pass
    return advertencias


def auditar_mql(ruta: str) -> list[str]:
    """Auditoría específica para archivos MQL4/MQL5 (trading bots)."""
    advertencias = []
    try:
        with open(ruta, "r", encoding="utf-8", errors="ignore") as f:
            contenido = f.read()

        # Verificar presencia de StopLoss
        if "OrderSend" in contenido or "trade.Buy" in contenido or "trade.Sell" in contenido:
            if "StopLoss" not in contenido and "sl" not in contenido.lower():
                advertencias.append("🚨 CRÍTICO: OrderSend/trade detectado SIN StopLoss definido")

        # Verificar NormalizeDouble en volúmenes
        if ("Lots" in contenido or "Volume" in contenido) and "NormalizeDouble" not in contenido:
            advertencias.append("⚠️ Volumen sin NormalizeDouble() - puede causar error de lote inválido")

        # Verificar manejo de errores en OrderSend
        if "OrderSend" in contenido and "GetLastError" not in contenido:
            advertencias.append("⚠️ OrderSend sin verificación de GetLastError()")

    except Exception:
        pass
    return advertencias


def ejecutar_pytest_si_existe(proyecto_dir: str) -> list[str]:
    """
    Ejecuta pytest en la carpeta tests/ del proyecto si existe.
    Retorna lista de mensajes (vacía si todo pasa).
    Timeout de 60s para no bloquear el hook.
    """
    mensajes = []
    tests_dir = os.path.join(proyecto_dir, "tests")

    if not os.path.isdir(tests_dir):
        mensajes.append("⚠️ Sin tests — considera añadir tests/test_main.py")
        return mensajes

    # Guard: no lanzar pytest recursivamente si ya estamos bajo pytest
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return mensajes

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "tests/", "--tb=short", "-q", "--no-header"],
            capture_output=True, text=True, cwd=proyecto_dir, timeout=60
        )
        if result.returncode == 0:
            # Tests pasan — extraer la línea de resumen (última línea significativa)
            lineas = [l for l in result.stdout.strip().splitlines() if l.strip()]
            resumen = lineas[-1] if lineas else "tests OK"
            mensajes.append(f"✅ pytest: {resumen}")
        else:
            # Tests fallaron — incluir output abreviado
            output = (result.stdout + result.stderr).strip()[:600]
            mensajes.append(f"❌ pytest FALLÓ:\n{output}")
    except subprocess.TimeoutExpired:
        mensajes.append("⚠️ pytest timeout (>60s) — verifica tests colgados")
    except FileNotFoundError:
        mensajes.append("⚠️ pytest no instalado — ejecutar: pip install pytest")

    return mensajes


def construir_contexto_adicional(archivo: str, errores: list, advertencias: list) -> str:
    """Genera el texto de contexto adicional para el agente."""
    if not errores and not advertencias:
        return ""

    lineas = [f"\n🔍 **AUDITORÍA AUTOMÁTICA POST-EDICIÓN** → `{os.path.basename(archivo)}`"]

    if errores:
        lineas.append("\n❌ **ERRORES CRÍTICOS (requieren corrección inmediata):**")
        for e in errores:
            lineas.append(f"   • {e}")

    if advertencias:
        lineas.append("\n⚠️ **ADVERTENCIAS DE SEGURIDAD/CALIDAD:**")
        for a in advertencias:
            lineas.append(f"   • {a}")

    lineas.append("\n→ Corrige estos problemas antes de continuar.\n")
    return "\n".join(lineas)


def main():
    """Punto de entrada principal del hook."""
    hook_data = leer_input_hook()

    # El campo puede variar según la versión de Cursor: 'path' o 'file'
    archivo = (
        hook_data.get("path")
        or hook_data.get("file")
        or hook_data.get("filePath")
        or ""
    )

    # Si no hay archivo o no existe, salir sin error
    if not archivo or not os.path.isfile(archivo):
        print(json.dumps({"additional_context": ""}))
        return

    tipo = detectar_tipo_archivo(archivo)
    errores = []
    advertencias = []

    # Validaciones por tipo de archivo
    if tipo == "python":
        errores.extend(validar_python(archivo))

    if tipo in ("mql4", "mql5", "mql_header"):
        advertencias.extend(auditar_mql(archivo))

    # Detección de secretos aplica a todos los tipos de texto
    if tipo in ("python", "javascript", "typescript", "kotlin", "java", "csharp", "go"):
        advertencias.extend(detectar_secretos_hardcodeados(archivo))

    # Ejecutar pytest en la carpeta tests/ del proyecto (si existe)
    # Se usa el directorio del archivo editado como raíz del proyecto
    proyecto_dir = os.path.dirname(archivo) or os.getcwd()
    # Subir hasta la raíz del proyecto (donde existe tests/ o requirements.txt)
    for _ in range(4):  # máximo 4 niveles hacia arriba
        if os.path.isdir(os.path.join(proyecto_dir, "tests")) or \
           os.path.isfile(os.path.join(proyecto_dir, "requirements.txt")):
            break
        parent = os.path.dirname(proyecto_dir)
        if parent == proyecto_dir:
            break
        proyecto_dir = parent

    mensajes_pytest = ejecutar_pytest_si_existe(proyecto_dir)
    # Separar OKs de errores/advertencias de pytest
    for msg in mensajes_pytest:
        if msg.startswith("❌"):
            errores.append(msg)
        elif msg.startswith("⚠️"):
            advertencias.append(msg)
        # Los ✅ solo se muestran si hay otros errores/advertencias (para no saturar)

    contexto = construir_contexto_adicional(archivo, errores, advertencias)
    print(json.dumps({"additional_context": contexto}))


if __name__ == "__main__":
    main()
