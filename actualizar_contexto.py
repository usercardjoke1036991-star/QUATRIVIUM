"""
actualizar_contexto.py - Gestión de CONTEXTO.md del proyecto
=============================================================
Script para leer y actualizar el archivo CONTEXTO.md del proyecto actual.
Compatible con Windows/PowerShell.

Uso:
    python actualizar_contexto.py --mostrar
        Muestra el contenido actual de CONTEXTO.md

    python actualizar_contexto.py --estado "En producción"
        Actualiza el campo "Estado actual" en CONTEXTO.md

    python actualizar_contexto.py --agregar-cambio "Descripción del cambio"
        Añade una entrada al historial de cambios con la fecha de hoy

    python actualizar_contexto.py --init
        Crea un CONTEXTO.md vacío desde la plantilla si no existe
"""

import sys
import os
import argparse
from pathlib import Path
from qa_safe_io import confine, confine_read, confine_write
from datetime import date

# Forzar UTF-8 en Windows (seguro bajo pytest con reconfigure)
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ─────────────────────────────────────────────
# MÓDULO 1: LOCALIZACIÓN DE ARCHIVOS
# ─────────────────────────────────────────────

# Raíz donde vive este script (workspace base)
SCRIPT_DIR = Path(__file__).parent

# Plantilla de referencia
PLANTILLA_CONTEXTO = SCRIPT_DIR / ".cursor" / "templates" / "CONTEXTO.md"


def _encontrar_contexto_md() -> Path | None:
    """
    Busca CONTEXTO.md en el directorio actual y directorios padre.
    Devuelve la ruta al primer CONTEXTO.md encontrado, o None si no existe.
    """
    candidatos = [
        Path.cwd() / "CONTEXTO.md",        # directorio actual (subproyecto)
        SCRIPT_DIR / "CONTEXTO.md",         # workspace raíz
    ]
    for ruta in candidatos:
        try:
            safe = confine(ruta)
        except ValueError:
            continue
        if safe.exists():
            return safe
    return None


def _inferir_directorio_proyecto() -> Path:
    """
    Devuelve el directorio del proyecto actual:
    - Si estamos en un subproyecto (distinto del workspace raíz), retorna cwd
    - Si estamos en el workspace raíz, retorna el workspace raíz
    """
    cwd = Path.cwd()
    if cwd.resolve() != SCRIPT_DIR.resolve():
        return cwd
    return SCRIPT_DIR


# ─────────────────────────────────────────────
# MÓDULO 2: LECTURA
# ─────────────────────────────────────────────

def cmd_mostrar(ruta: Path | None):
    """Muestra el contenido actual de CONTEXTO.md."""
    if ruta is None:
        print("⚠️  No se encontró CONTEXTO.md en este proyecto.")
        print("   Crea uno con: python actualizar_contexto.py --init")
        return

    print(f"\n{'═' * 60}")
    print(f"  📄 CONTEXTO.MD — {ruta.parent.name}")
    print(f"  Ruta: {ruta}")
    print(f"{'═' * 60}\n")
    print(confine_read(ruta))
    print(f"{'═' * 60}\n")


# ─────────────────────────────────────────────
# MÓDULO 3: ACTUALIZACIÓN DE CAMPOS
# ─────────────────────────────────────────────

def cmd_actualizar_estado(ruta: Path | None, nuevo_estado: str):
    """
    Reemplaza la línea de 'Estado actual' en CONTEXTO.md.
    Si CONTEXTO.md no existe, advierte sin fallar.
    """
    if ruta is None:
        print("⚠️  No se encontró CONTEXTO.md — nada que actualizar.")
        print("   Crea uno con: python actualizar_contexto.py --init")
        return

    contenido = confine_read(ruta)
    lineas = contenido.splitlines(keepends=True)
    nueva_linea = f"- **Estado actual:** {nuevo_estado}\n"
    modificado = False

    for i, linea in enumerate(lineas):
        if linea.strip().startswith("- **Estado actual:**"):
            lineas[i] = nueva_linea
            modificado = True
            break

    if not modificado:
        print("⚠️  No se encontró la línea '- **Estado actual:**' en CONTEXTO.md")
        print(f"   Añade manualmente: {nueva_linea.strip()}")
        return

    confine_write(ruta, "".join(lineas))
    print(f"✅ Estado actualizado → {nuevo_estado}")
    print(f"   Archivo: {ruta}")


def cmd_agregar_cambio(ruta: Path | None, descripcion: str):
    """
    Añade una nueva fila al historial de cambios en CONTEXTO.md.
    Si CONTEXTO.md no existe, advierte sin fallar.
    """
    if ruta is None:
        print("⚠️  No se encontró CONTEXTO.md — nada que actualizar.")
        print("   Crea uno con: python actualizar_contexto.py --init")
        return

    ruta = confine(ruta)
    fecha_hoy = date.today().strftime("%Y-%m-%d")
    contenido = confine_read(ruta)

    # Buscar la línea de encabezado de la tabla del historial
    MARCADOR_TABLA = "| Fecha | Cambio | Razón |"
    SEPARADOR = "|-------|--------|-------|"

    if MARCADOR_TABLA not in contenido:
        print("⚠️  No se encontró la tabla 'Historial de cambios' en CONTEXTO.md")
        print(f"   Añade manualmente: | {fecha_hoy} | {descripcion} | [razón] |")
        return

    nueva_fila = f"| {fecha_hoy} | {descripcion} | — |"

    # Insertar la nueva fila debajo del separador de la tabla
    contenido_nuevo = contenido.replace(
        SEPARADOR,
        f"{SEPARADOR}\n{nueva_fila}",
        1  # solo la primera ocurrencia
    )

    if contenido_nuevo == contenido:
        # Separador no encontrado, insertar debajo del encabezado
        contenido_nuevo = contenido.replace(
            MARCADOR_TABLA,
            f"{MARCADOR_TABLA}\n{nueva_fila}",
            1
        )

    confine_write(ruta, contenido_nuevo)
    print(f"✅ Cambio registrado en CONTEXTO.md:")
    print(f"   {nueva_fila}")


# ─────────────────────────────────────────────
# MÓDULO 4: INICIALIZACIÓN
# ─────────────────────────────────────────────

def cmd_init():
    """
    Crea un CONTEXTO.md vacío desde la plantilla si no existe.
    No sobreescribe si ya existe.
    """
    proyecto_dir = confine(_inferir_directorio_proyecto())
    destino = proyecto_dir / "CONTEXTO.md"

    if destino.exists():
        print(f"ℹ️  CONTEXTO.md ya existe en: {destino}")
        print("   Usa --mostrar para ver su contenido actual.")
        return

    nombre = proyecto_dir.name

    if PLANTILLA_CONTEXTO.exists():
        contenido = PLANTILLA_CONTEXTO.read_text(encoding="utf-8")
        contenido = contenido.replace("[NOMBRE]", nombre)
        contenido = contenido.replace("[fecha]", date.today().strftime("%Y-%m-%d"))
        contenido = contenido.replace("[qué se hizo]", "Archivo de contexto inicializado")
        contenido = contenido.replace("[por qué]", "Creado manualmente")
    else:
        # Fallback mínimo si la plantilla no existe
        contenido = f"""# 🧠 CONTEXTO DEL PROYECTO: {nombre}

## ¿Qué es este proyecto?
[Descripción clara en 2-3 líneas de qué hace y para quién]

## Tipo de proyecto
- **Stack:** [tecnología principal]
- **Tipo:** [tipo de aplicación]
- **Estado actual:** En desarrollo

## Lo que está funcionando ✅
- [Añadir funcionalidades completas]

## Lo que está en progreso 🔄
- [Añadir tareas en curso]

## Lo que NO funciona o está pendiente ❌
- [Añadir problemas conocidos]

## Historial de cambios importantes
| Fecha | Cambio | Razón |
|-------|--------|-------|
| {date.today().strftime("%Y-%m-%d")} | Archivo de contexto inicializado | Creado manualmente |
"""

    confine_write(destino, contenido)
    print(f"✅ CONTEXTO.md creado en: {destino}")
    print("   Rellena las secciones para que el agente entienda tu proyecto.")


# ─────────────────────────────────────────────
# PUNTO DE ENTRADA
# ─────────────────────────────────────────────

def main():
    """Punto de entrada con argumentos de línea de comandos."""
    parser = argparse.ArgumentParser(
        prog="actualizar_contexto.py",
        description=(
            "🧠 Gestión del archivo CONTEXTO.md del proyecto.\n"
            "Permite leer y actualizar el contexto persistente para el agente IA."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Ejemplos:\n"
            "  python actualizar_contexto.py --mostrar\n"
            "  python actualizar_contexto.py --estado \"En producción\"\n"
            "  python actualizar_contexto.py --agregar-cambio \"Añadí autenticación JWT\"\n"
            "  python actualizar_contexto.py --init\n"
        )
    )

    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument(
        "--mostrar",
        action="store_true",
        help="Muestra el contenido actual de CONTEXTO.md"
    )
    grupo.add_argument(
        "--estado",
        metavar="ESTADO",
        help="Actualiza el campo 'Estado actual' (ej: 'En producción')"
    )
    grupo.add_argument(
        "--agregar-cambio",
        metavar="DESCRIPCION",
        dest="agregar_cambio",
        help="Añade una entrada al historial de cambios con la fecha de hoy"
    )
    grupo.add_argument(
        "--init",
        action="store_true",
        help="Crea CONTEXTO.md desde la plantilla si no existe (no sobreescribe)"
    )

    args = parser.parse_args()

    # Localizar CONTEXTO.md (puede ser None si no existe)
    ruta_contexto = _encontrar_contexto_md()

    if args.mostrar:
        cmd_mostrar(ruta_contexto)
    elif args.estado:
        cmd_actualizar_estado(ruta_contexto, args.estado)
    elif args.agregar_cambio:
        cmd_agregar_cambio(ruta_contexto, args.agregar_cambio)
    elif args.init:
        cmd_init()


if __name__ == "__main__":
    main()
