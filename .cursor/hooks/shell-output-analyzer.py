"""
Hook: shell-output-analyzer.py
Evento: afterShellExecution
Propósito: Analizar el output de comandos de terminal para detectar errores
           automáticamente y dar contexto al agente para que los corrija.
"""

import sys
import json
import re


def leer_input_hook() -> dict:
    """Lee el JSON del hook desde stdin."""
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, Exception):
        return {}


# Patrones de error clasificados por severidad
PATRONES_ERROR_CRITICO = [
    (r"Traceback \(most recent call last\)", "Python: Excepción no capturada"),
    (r"SyntaxError:", "Python: Error de sintaxis"),
    (r"ModuleNotFoundError:", "Python: Módulo no encontrado"),
    (r"ImportError:", "Python: Error de importación"),
    (r"BUILD FAILED", "Gradle: Build fallido"),
    (r"error TS\d+", "TypeScript: Error de compilación"),
    (r"npm ERR!", "npm: Error en instalación/ejecución"),
    (r"FAILED\s+tests/", "pytest: Tests fallaron"),
    (r"AssertionError", "Test: Assertion fallida"),
    (r"PermissionError:", "Python: Error de permisos"),
    (r"ConnectionRefusedError:", "Python: Conexión rechazada (¿servidor levantado?)"),
    (r"KeyError:", "Python: Clave no encontrada en diccionario"),
    (r"AttributeError:", "Python: Atributo no existe en objeto"),
    (r"TypeError:", "Python: Tipo de dato incorrecto"),
    (r"ValueError:", "Python: Valor inválido"),
    (r"FileNotFoundError:", "Python: Archivo no encontrado"),
    (r"error\[E\d+\]", "Rust: Error de compilación"),
    (r"COMPILATION ERROR", "Error de compilación genérico"),
    (r"fatal error:", "Error fatal del compilador"),
    (r"cannot find symbol", "Java/Kotlin: Símbolo no encontrado"),
]

PATRONES_ADVERTENCIA = [
    (r"DeprecationWarning:", "Python: API deprecada"),
    (r"UserWarning:", "Python: Advertencia de usuario"),
    (r"WARNING:", "Advertencia general"),
    (r"npm warn", "npm: Advertencia"),
    (r"WARN\s", "Advertencia en build"),
    (r"vulnerability|vulnerabilities", "Seguridad: Vulnerabilidades detectadas"),
]

PATRONES_EXITO = [
    r"✅|SUCCESS|PASSED|All tests passed|Build successful|Done in",
    r"\d+ passed",
    r"successfully installed",
]


def analizar_output(output: str) -> tuple[list, list, bool]:
    """
    Analiza el output del terminal.
    Retorna: (errores_criticos, advertencias, hay_exito)
    """
    errores = []
    advertencias = []
    hay_exito = False

    if not output:
        return errores, advertencias, hay_exito

    # Verificar éxito
    for patron in PATRONES_EXITO:
        if re.search(patron, output, re.IGNORECASE):
            hay_exito = True
            break

    # Detectar errores críticos
    for patron, descripcion in PATRONES_ERROR_CRITICO:
        match = re.search(patron, output, re.IGNORECASE | re.MULTILINE)
        if match:
            # Extraer contexto alrededor del error (2 líneas antes y después)
            lineas = output.split("\n")
            for i, linea in enumerate(lineas):
                if re.search(patron, linea, re.IGNORECASE):
                    contexto_start = max(0, i - 1)
                    contexto_end = min(len(lineas), i + 3)
                    contexto = " | ".join(l.strip() for l in lineas[contexto_start:contexto_end] if l.strip())
                    errores.append(f"{descripcion}: `{contexto[:200]}`")
                    break

    # Detectar advertencias (solo si no hay errores críticos del mismo tipo)
    for patron, descripcion in PATRONES_ADVERTENCIA:
        if re.search(patron, output, re.IGNORECASE):
            advertencias.append(descripcion)

    return errores, advertencias, hay_exito


def construir_contexto(comando: str, output: str, errores: list, advertencias: list, hay_exito: bool) -> str:
    """Genera el texto de contexto adicional para el agente."""
    # Si todo fue exitoso y sin advertencias, no agregar ruido
    if hay_exito and not errores and not advertencias:
        return ""

    # Si no hay errores ni advertencias, no agregar nada
    if not errores and not advertencias:
        return ""

    lineas = [f"\n🖥️ **ANÁLISIS AUTOMÁTICO DE TERMINAL** → `{comando[:80] if comando else 'comando'}`"]

    if errores:
        lineas.append("\n❌ **ERRORES DETECTADOS (actuar inmediatamente):**")
        for e in errores[:5]:  # Máximo 5 errores para no saturar el contexto
            lineas.append(f"   • {e}")

    if advertencias and not errores:
        lineas.append("\n⚠️ **ADVERTENCIAS:**")
        for a in advertencias[:3]:
            lineas.append(f"   • {a}")

    if errores:
        lineas.append("\n→ **Analiza y corrige estos errores antes de continuar.**")

    return "\n".join(lineas)


def main():
    """Punto de entrada principal del hook."""
    hook_data = leer_input_hook()

    # Extraer datos del hook
    comando = hook_data.get("command", "")
    output = hook_data.get("output", "") or hook_data.get("stdout", "") or ""
    stderr = hook_data.get("stderr", "") or ""
    output_completo = output + "\n" + stderr

    errores, advertencias, hay_exito = analizar_output(output_completo)
    contexto = construir_contexto(comando, output_completo, errores, advertencias, hay_exito)

    print(json.dumps({"additional_context": contexto}))


if __name__ == "__main__":
    main()
