"""
aprender_error.py - Registrador de Errores Aprendidos
======================================================
CLI para añadir nuevos patrones de error al sistema de memoria QA.
Los patrones registrados son usados por qa_autonomo.py para detectar
el mismo error automáticamente en futuros proyectos.

Uso interactivo:
    python aprender_error.py

Uso con argumentos:
    python aprender_error.py --descripcion "Error X" --tipo python --severidad critico

Tipos válidos:
    python, node, mql5, android, todos

Severidades válidas:
    critico, advertencia, cosmético
"""

import os
import sys
import json
import re
import argparse
from datetime import date
from pathlib import Path
from qa_safe_io import confine_write

# Forzar UTF-8 en Windows
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ruta al JSON de errores aprendidos (siempre en el workspace raíz de la plantilla)
WORKSPACE_ROOT = Path(__file__).parent
ERRORES_JSON = WORKSPACE_ROOT / "errores_aprendidos.json"

TIPOS_VALIDOS = ["python", "node", "mql5", "android", "todos"]
SEVERIDADES_VALIDAS = ["critico", "advertencia", "cosmético"]


# ─────────────────────────────────────────────
# MÓDULO 1: GESTIÓN DEL JSON
# ─────────────────────────────────────────────

def cargar_errores() -> dict:
    """Carga el JSON de errores aprendidos. Crea estructura vacía si no existe."""
    if not ERRORES_JSON.exists():
        datos = {
            "version": "1.0",
            "ultimo_actualizado": str(date.today()),
            "total_errores_aprendidos": 0,
            "patrones": []
        }
        guardar_errores(datos)
        return datos

    try:
        return json.loads(ERRORES_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"❌ Error leyendo {ERRORES_JSON}: {e}")
        sys.exit(1)


def guardar_errores(datos: dict):
    """Guarda el JSON de errores aprendidos con formato legible."""
    confine_write(
        ERRORES_JSON,
        json.dumps(datos, ensure_ascii=False, indent=2),
    )


def generar_id(datos: dict) -> str:
    """Genera el próximo ID correlativo (ERR-001, ERR-002, ...)."""
    patrones = datos.get("patrones", [])
    if not patrones:
        return "ERR-001"

    # Buscar el número más alto entre los IDs existentes
    ids_numericos = []
    for p in patrones:
        match = re.match(r"ERR-(\d+)", p.get("id", ""))
        if match:
            ids_numericos.append(int(match.group(1)))

    siguiente = max(ids_numericos, default=0) + 1
    return f"ERR-{siguiente:03d}"


# ─────────────────────────────────────────────
# MÓDULO 2: VALIDACIÓN DE ENTRADAS
# ─────────────────────────────────────────────

def validar_tipos(tipos_str: str) -> list[str]:
    """
    Valida y parsea una cadena de tipos separada por comas.
    Ejemplo: 'python,node' → ['python', 'node']
    """
    tipos = [t.strip().lower() for t in tipos_str.split(",") if t.strip()]
    invalidos = [t for t in tipos if t not in TIPOS_VALIDOS]
    if invalidos:
        print(f"❌ Tipos inválidos: {', '.join(invalidos)}")
        print(f"   Válidos: {', '.join(TIPOS_VALIDOS)}")
        return []
    return tipos


def validar_severidad(severidad: str) -> str:
    """Valida que la severidad sea una de las permitidas."""
    sev = severidad.strip().lower()
    if sev not in SEVERIDADES_VALIDAS:
        print(f"❌ Severidad inválida: '{sev}'")
        print(f"   Válidas: {', '.join(SEVERIDADES_VALIDAS)}")
        return ""
    return sev


def validar_patron_regex(patron: str) -> bool:
    """Verifica que el patrón de detección sea regex válido y acotado."""
    if len(patron) > 120 or re.search(r'(\+|\*|\{).{0,8}(\+|\*|\{)', patron):
        print("⚠️  El patrón es demasiado amplio. Se usará como texto fijo.")
        return False
    try:
        re.compile(patron)
        return True
    except re.error as e:
        print(f"⚠️  El patrón '{patron}' no es regex válido: {e}")
        print("   Se usará como búsqueda de substring simple.")
        return False


# ─────────────────────────────────────────────
# MÓDULO 3: MODO INTERACTIVO
# ─────────────────────────────────────────────

def _preguntar(prompt: str, obligatorio: bool = True) -> str:
    """Pide input al usuario, repitiendo si está vacío y es obligatorio."""
    while True:
        valor = input(f"  {prompt}: ").strip()
        if valor or not obligatorio:
            return valor
        print("  ⚠️  Este campo es obligatorio. Intenta de nuevo.")


def modo_interactivo() -> dict:
    """
    Guía al usuario paso a paso para registrar un nuevo error.
    Retorna el diccionario del nuevo patrón.
    """
    print("\n" + "─" * 55)
    print("  📚 REGISTRAR NUEVO ERROR APRENDIDO")
    print("─" * 55)
    print("  Completa los campos (Enter para continuar):\n")

    # Descripción
    descripcion = _preguntar("Descripción del error (qué sale mal)")

    # Tipos de proyecto
    print(f"\n  Tipos disponibles: {', '.join(TIPOS_VALIDOS)}")
    while True:
        tipos_str = _preguntar("Tipo(s) de proyecto (separados por coma, ej: python,node)")
        tipos = validar_tipos(tipos_str)
        if tipos:
            break

    # Severidad
    print(f"\n  Severidades: {', '.join(SEVERIDADES_VALIDAS)}")
    while True:
        sev_input = _preguntar("Severidad")
        severidad = validar_severidad(sev_input)
        if severidad:
            break

    # Patrón de detección
    print("\n  Patrón de detección: texto simple o regex que identifica el error en el código")
    patron = _preguntar("Patrón de detección")
    validar_patron_regex(patron)  # Solo advierte, no bloquea

    # Ejemplo malo (opcional)
    print("\n  (Opcional) Ejemplo de código con el error:")
    ejemplo_malo = _preguntar("Ejemplo malo", obligatorio=False)

    # Ejemplo correcto (opcional)
    print("\n  (Opcional) Ejemplo de código correcto:")
    ejemplo_correcto = _preguntar("Ejemplo correcto", obligatorio=False)

    # Notas (opcional)
    print("\n  (Opcional) Notas adicionales o contexto:")
    notas = _preguntar("Notas", obligatorio=False)

    return {
        "descripcion": descripcion,
        "tipo_proyecto": tipos,
        "severidad": severidad,
        "patron_deteccion": patron,
        "ejemplo_malo": ejemplo_malo or "",
        "ejemplo_correcto": ejemplo_correcto or "",
        "notas": notas or ""
    }


# ─────────────────────────────────────────────
# MÓDULO 4: REGISTRO DEL ERROR
# ─────────────────────────────────────────────

def registrar_error(datos_patron: dict) -> str:
    """
    Añade el nuevo patrón al JSON y retorna el ID asignado.
    Actualiza los contadores y la fecha de última modificación.
    """
    datos = cargar_errores()
    nuevo_id = generar_id(datos)

    nuevo_patron = {
        "id": nuevo_id,
        "tipo_proyecto": datos_patron["tipo_proyecto"],
        "descripcion": datos_patron["descripcion"],
        "patron_deteccion": datos_patron["patron_deteccion"],
        "ejemplo_malo": datos_patron.get("ejemplo_malo", ""),
        "ejemplo_correcto": datos_patron.get("ejemplo_correcto", ""),
        "fecha_aprendido": str(date.today()),
        "veces_detectado": 0,
        "severidad": datos_patron["severidad"],
        "notas": datos_patron.get("notas", "")
    }

    datos["patrones"].append(nuevo_patron)
    datos["total_errores_aprendidos"] = len(datos["patrones"])
    datos["ultimo_actualizado"] = str(date.today())

    guardar_errores(datos)
    return nuevo_id


def mostrar_confirmacion(nuevo_id: str, patron: dict):
    """Muestra el mensaje de confirmación tras registrar el error."""
    print("\n" + "═" * 55)
    print("  ✅ ERROR APRENDIDO REGISTRADO EXITOSAMENTE")
    print("═" * 55)
    print(f"  ID asignado  : {nuevo_id}")
    print(f"  Descripción  : {patron['descripcion']}")
    print(f"  Tipos        : {', '.join(patron['tipo_proyecto'])}")
    print(f"  Severidad    : {patron['severidad']}")
    print(f"  Patrón       : {patron['patron_deteccion']}")
    print(f"\n  📄 Guardado en: {ERRORES_JSON}")
    print(f"\n  💡 Próximos pasos:")
    print(f"     python qa_autonomo.py          ← Verificará este patrón en el próximo QA")
    print(f"     python sincronizar_plantilla.py ← Propaga el aprendizaje a subproyectos")
    print("═" * 55 + "\n")


# ─────────────────────────────────────────────
# PUNTO DE ENTRADA
# ─────────────────────────────────────────────

def main():
    """Entry point del script."""
    parser = argparse.ArgumentParser(
        description="Registra un nuevo error aprendido en errores_aprendidos.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python aprender_error.py
  python aprender_error.py --descripcion "Sin StopLoss" --tipo mql5 --severidad critico
  python aprender_error.py --descripcion "Credencial hardcodeada" --tipo todos --severidad critico --patron "api_key\\s*=\\s*['\\\"][^'\\\"]{8,}['\\\"]"
        """
    )
    parser.add_argument("--descripcion", help="Descripción del error")
    parser.add_argument(
        "--tipo",
        help=f"Tipo(s) de proyecto, separados por coma. Opciones: {', '.join(TIPOS_VALIDOS)}"
    )
    parser.add_argument(
        "--severidad",
        help=f"Severidad. Opciones: {', '.join(SEVERIDADES_VALIDAS)}"
    )
    parser.add_argument("--patron", help="Patrón de detección (texto simple o regex)")
    parser.add_argument("--ejemplo-malo", help="Ejemplo de código con el error", dest="ejemplo_malo")
    parser.add_argument("--ejemplo-correcto", help="Ejemplo de código correcto", dest="ejemplo_correcto")
    parser.add_argument("--notas", help="Notas adicionales")
    parser.add_argument("--lista", action="store_true", help="Lista los errores aprendidos registrados")

    args = parser.parse_args()

    # Modo listar
    if args.lista:
        datos = cargar_errores()
        patrones = datos.get("patrones", [])
        print(f"\n📚 Errores aprendidos ({len(patrones)} total):\n")
        for p in patrones:
            tipos_str = ", ".join(p.get("tipo_proyecto", []))
            print(f"  [{p['id']}] {p['severidad'].upper():12} | {tipos_str:20} | {p['descripcion']}")
        print()
        return

    # Determinar modo: argumentos o interactivo
    if args.descripcion or args.tipo or args.severidad:
        # Modo argumentos: validar campos obligatorios
        errores = []
        if not args.descripcion:
            errores.append("--descripcion es obligatorio")
        if not args.tipo:
            errores.append("--tipo es obligatorio")
        if not args.severidad:
            errores.append("--severidad es obligatorio")

        if errores:
            for e in errores:
                print(f"❌ {e}")
            parser.print_help()
            sys.exit(1)

        tipos = validar_tipos(args.tipo)
        if not tipos:
            sys.exit(1)

        severidad = validar_severidad(args.severidad)
        if not severidad:
            sys.exit(1)

        patron = args.patron or args.descripcion  # Fallback: usar descripción como patrón
        if args.patron:
            validar_patron_regex(args.patron)

        datos_patron = {
            "descripcion": args.descripcion,
            "tipo_proyecto": tipos,
            "severidad": severidad,
            "patron_deteccion": patron,
            "ejemplo_malo": args.ejemplo_malo or "",
            "ejemplo_correcto": args.ejemplo_correcto or "",
            "notas": args.notas or ""
        }
    else:
        # Modo interactivo
        datos_patron = modo_interactivo()

    # Registrar y confirmar
    nuevo_id = registrar_error(datos_patron)
    mostrar_confirmacion(nuevo_id, datos_patron)


if __name__ == "__main__":
    main()
