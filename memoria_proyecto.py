"""
memoria_proyecto.py - Memoria de sesión persistente del proyecto
================================================================
Mantiene MEMORIA.md (y memoria.json) para que el agente recuerde
enfoque, decisiones, cambios y puntos críticos entre conversaciones.

Uso:
    python memoria_proyecto.py --init [ruta]
    python memoria_proyecto.py --cambio "descripción" [--ruta DIR]
    python memoria_proyecto.py --decision "texto" [--ruta DIR]
    python memoria_proyecto.py --enfoque "qué busca el usuario" [--ruta DIR]
    python memoria_proyecto.py --mostrar
    python memoria_proyecto.py --json
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from qa_safe_io import confine, write_under
from typing import List, Optional

# ERR-003: reconfigure + hasattr — nunca TextIOWrapper sobre stdout
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ─────────────────────────────────────────────
# MÓDULO 1: CONSTANTES Y ESTRUCTURA
# ─────────────────────────────────────────────

MEMORIA_MD = "MEMORIA.md"
MEMORIA_JSON = "memoria.json"
MAX_DECISIONES = 30
MAX_CAMBIOS = 50

TITULO_ENFOQUE = "## Enfoque del usuario"
TITULO_DECISIONES = "## Decisiones"
TITULO_CAMBIOS = "## Cambios realizados"
TITULO_NO_OLVIDAR = "## No olvidar / no romper"
TITULO_ULTIMA = "## Última sesión"

PLACEHOLDER_ENFOQUE = "(qué busca — se actualiza, no se acumula infinito)"
PLACEHOLDER_NO_OLVIDAR = "(puntos críticos)"
PLACEHOLDER_SESION = "(sin sesiones registradas)"

_Pistas_secreto = (
    "api_key", "apikey", "password", "passwd", "secret",
    "private_key", "token=", "authorization:", "bearer ",
)


@dataclass
class MemoriaProyecto:
    """Estado persistente de la memoria de sesión."""

    enfoque: str = PLACEHOLDER_ENFOQUE
    decisiones: List[str] = field(default_factory=list)
    cambios: List[str] = field(default_factory=list)
    no_olvidar: str = PLACEHOLDER_NO_OLVIDAR
    ultima_sesion: str = PLACEHOLDER_SESION

    def to_dict(self) -> dict:
        return {
            "enfoque": self.enfoque,
            "decisiones": list(self.decisiones),
            "cambios": list(self.cambios),
            "no_olvidar": self.no_olvidar,
            "ultima_sesion": self.ultima_sesion,
        }


# ─────────────────────────────────────────────
# MÓDULO 2: RUTAS Y SEGURIDAD
# ─────────────────────────────────────────────

def resolver_directorio(ruta: Optional[str]) -> Path:
    """Resuelve el directorio del proyecto (ruta dada o cwd) dentro de Magno."""
    raw = Path(ruta).expanduser() if ruta else Path.cwd()
    return confine(raw)


def ruta_memoria_md(directorio: Path) -> Path:
    return directorio / MEMORIA_MD


def ruta_memoria_json(directorio: Path) -> Path:
    return directorio / MEMORIA_JSON


def _parece_secreto(texto: str) -> bool:
    t = texto.lower()
    return any(pista in t for pista in _Pistas_secreto)


def _rechazar_si_secreto(texto: str) -> bool:
    """True si el texto no debe persistirse (parece credencial)."""
    if _parece_secreto(texto):
        print("⚠️  El texto parece contener credenciales — no se guardará.")
        return True
    return False


# ─────────────────────────────────────────────
# MÓDULO 3: LECTURA / ESCRITURA UTF-8
# ─────────────────────────────────────────────

def _extraer_seccion(contenido: str, titulo: str, siguientes: List[str]) -> str:
    start = contenido.find(titulo)
    if start < 0:
        return ""
    start += len(titulo)
    end = len(contenido)
    for sig in siguientes:
        pos = contenido.find(sig, start)
        if 0 <= pos < end:
            end = pos
    return contenido[start:end].strip()


def _parsear_lista(bloque: str) -> List[str]:
    items: List[str] = []
    for linea in bloque.splitlines():
        s = linea.strip()
        if not s.startswith("- "):
            continue
        bajo = s.lower()
        if "(ningun" in bajo:
            continue
        items.append(s)
    return items


def leer_memoria(directorio: Path) -> Optional[MemoriaProyecto]:
    """Lee MEMORIA.md. Devuelve None si no existe o falla la lectura."""
    ruta = ruta_memoria_md(directorio)
    if not ruta.exists():
        return None
    try:
        contenido = ruta.read_text(encoding="utf-8")
    except OSError as e:
        print(f"❌ No se pudo leer MEMORIA.md: {e}", file=sys.stderr)
        return None

    enfoque = _extraer_seccion(
        contenido, TITULO_ENFOQUE,
        [TITULO_DECISIONES, TITULO_CAMBIOS, TITULO_NO_OLVIDAR, TITULO_ULTIMA],
    )
    dec_blk = _extraer_seccion(
        contenido, TITULO_DECISIONES,
        [TITULO_CAMBIOS, TITULO_NO_OLVIDAR, TITULO_ULTIMA],
    )
    cam_blk = _extraer_seccion(
        contenido, TITULO_CAMBIOS,
        [TITULO_NO_OLVIDAR, TITULO_ULTIMA],
    )
    no_olv = _extraer_seccion(contenido, TITULO_NO_OLVIDAR, [TITULO_ULTIMA])
    sesion = _extraer_seccion(contenido, TITULO_ULTIMA, [])

    return MemoriaProyecto(
        enfoque=enfoque or PLACEHOLDER_ENFOQUE,
        decisiones=_parsear_lista(dec_blk),
        cambios=_parsear_lista(cam_blk),
        no_olvidar=no_olv or PLACEHOLDER_NO_OLVIDAR,
        ultima_sesion=sesion or PLACEHOLDER_SESION,
    )


def renderizar_memoria(mem: MemoriaProyecto) -> str:
    """Serializa la memoria al formato Markdown canónico."""
    dec = "\n".join(mem.decisiones) if mem.decisiones else "- (ninguna aún)"
    cam = "\n".join(mem.cambios) if mem.cambios else "- (ninguno aún)"
    return (
        "# Memoria del proyecto\n\n"
        f"{TITULO_ENFOQUE}\n"
        f"{mem.enfoque.strip()}\n\n"
        f"{TITULO_DECISIONES}\n"
        f"{dec}\n\n"
        f"{TITULO_CAMBIOS}\n"
        f"{cam}\n\n"
        f"{TITULO_NO_OLVIDAR}\n"
        f"{mem.no_olvidar.strip()}\n\n"
        f"{TITULO_ULTIMA}\n"
        f"{mem.ultima_sesion.strip()}\n"
    )


def escribir_memoria(mem: MemoriaProyecto, directorio: Path) -> bool:
    """Escribe MEMORIA.md y memoria.json. False si falla el I/O."""
    try:
        base = confine(directorio)
        base.mkdir(parents=True, exist_ok=True)
        write_under(base, MEMORIA_MD, renderizar_memoria(mem))
        write_under(
            base,
            MEMORIA_JSON,
            json.dumps(mem.to_dict(), ensure_ascii=False, indent=2) + "\n",
        )
        return True
    except (OSError, ValueError) as e:
        print(f"❌ No se pudo escribir MEMORIA.md: {e}", file=sys.stderr)
        return False


def _cargar_o_crear(directorio: Path) -> MemoriaProyecto:
    mem = leer_memoria(directorio)
    if mem is not None:
        return mem
    mem = MemoriaProyecto()
    escribir_memoria(mem, directorio)
    return mem


def _marcar_sesion(mem: MemoriaProyecto, resumen: str) -> None:
    fecha = date.today().strftime("%Y-%m-%d")
    mem.ultima_sesion = f"[{fecha}] {resumen.strip()}"


def _entrada(texto: str) -> str:
    fecha = date.today().strftime("%Y-%m-%d")
    return f"- [{fecha}] {texto.strip()}"


def _prepend_unico(lista: List[str], entrada: str, tope: int) -> List[str]:
    """Añade al frente, evita duplicado exacto y recorta al tope."""
    resto = [x for x in lista if x != entrada]
    return [entrada] + resto[: tope - 1]


# ─────────────────────────────────────────────
# MÓDULO 4: COMANDOS
# ─────────────────────────────────────────────

def cmd_init(directorio: str) -> int:
    """Crea MEMORIA.md si no existe. Nunca sobrescribe."""
    d = resolver_directorio(directorio)
    ruta = ruta_memoria_md(d)
    if ruta.exists():
        print(f"ℹ️  MEMORIA.md ya existe — no se sobrescribe: {ruta}")
        return 0
    mem = MemoriaProyecto()
    _marcar_sesion(mem, "MEMORIA.md inicializado")
    if not escribir_memoria(mem, d):
        return 1
    print(f"✅ MEMORIA.md creado → {ruta}")
    return 0


def cmd_cambio(descripcion: str, directorio: str) -> int:
    """Registra un cambio (aditivo, últimas MAX_CAMBIOS)."""
    if not descripcion or not descripcion.strip():
        print("❌ Debes proporcionar la descripción del cambio.")
        return 1
    if _rechazar_si_secreto(descripcion):
        return 1
    d = resolver_directorio(directorio)
    mem = _cargar_o_crear(d)
    entrada = _entrada(descripcion)
    mem.cambios = _prepend_unico(mem.cambios, entrada, MAX_CAMBIOS)
    _marcar_sesion(mem, f"Cambio: {descripcion.strip()}")
    if not escribir_memoria(mem, d):
        return 1
    print(f"✅ Cambio registrado: {entrada}")
    return 0


def cmd_decision(texto: str, directorio: str) -> int:
    """Registra una decisión (aditivo, últimas MAX_DECISIONES)."""
    if not texto or not texto.strip():
        print("❌ Debes proporcionar el texto de la decisión.")
        return 1
    if _rechazar_si_secreto(texto):
        return 1
    d = resolver_directorio(directorio)
    mem = _cargar_o_crear(d)
    entrada = _entrada(texto)
    mem.decisiones = _prepend_unico(mem.decisiones, entrada, MAX_DECISIONES)
    _marcar_sesion(mem, f"Decisión: {texto.strip()}")
    if not escribir_memoria(mem, d):
        return 1
    print(f"✅ Decisión registrada: {entrada}")
    return 0


def cmd_enfoque(texto: str, directorio: str) -> int:
    """Actualiza el enfoque (reemplaza; no acumula)."""
    if not texto or not texto.strip():
        print("❌ Debes proporcionar el enfoque del usuario.")
        return 1
    if _rechazar_si_secreto(texto):
        return 1
    d = resolver_directorio(directorio)
    mem = _cargar_o_crear(d)
    mem.enfoque = texto.strip()
    _marcar_sesion(mem, "Enfoque del usuario actualizado")
    if not escribir_memoria(mem, d):
        return 1
    print(f"✅ Enfoque actualizado → {mem.enfoque}")
    return 0


def cmd_mostrar(directorio: str) -> int:
    """Imprime MEMORIA.md en consola."""
    d = resolver_directorio(directorio)
    mem = leer_memoria(d)
    if mem is None:
        print("⚠️  No se encontró MEMORIA.md.")
        print("   Crea uno con: python memoria_proyecto.py --init")
        return 1
    print(renderizar_memoria(mem))
    return 0


def cmd_json(directorio: str) -> int:
    """Imprime la memoria como JSON."""
    d = resolver_directorio(directorio)
    mem = leer_memoria(d)
    if mem is None:
        print("{}")
        return 1
    print(json.dumps(mem.to_dict(), ensure_ascii=False, indent=2))
    return 0


# ─────────────────────────────────────────────
# MÓDULO 5: CLI
# ─────────────────────────────────────────────

def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Memoria de sesión persistente del proyecto (MEMORIA.md)",
    )
    parser.add_argument(
        "--init", nargs="?", const="__CWD__", metavar="RUTA",
        help="Crea MEMORIA.md si no existe",
    )
    parser.add_argument("--cambio", metavar="TEXTO", help="Registra un cambio")
    parser.add_argument("--decision", metavar="TEXTO", help="Registra una decisión")
    parser.add_argument("--enfoque", metavar="TEXTO", help="Actualiza el enfoque")
    parser.add_argument("--mostrar", action="store_true", help="Muestra MEMORIA.md")
    parser.add_argument("--json", action="store_true", dest="como_json",
                        help="Muestra la memoria en JSON")
    parser.add_argument("--ruta", default=None, help="Directorio del proyecto")
    return parser.parse_args(argv)


def _resolver_cli(args: argparse.Namespace) -> str:
    if args.ruta:
        return args.ruta
    if args.init and args.init != "__CWD__":
        return args.init
    return os.getcwd()


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv)
    directorio = _resolver_cli(args)
    codigo = 0
    hubo = False

    if args.init is not None:
        init_dir = args.init if args.init != "__CWD__" else directorio
        r = cmd_init(init_dir)
        if r != 0:
            codigo = r
        hubo = True
    if args.enfoque:
        r = cmd_enfoque(args.enfoque, directorio)
        if r != 0:
            codigo = r
        hubo = True
    if args.decision:
        r = cmd_decision(args.decision, directorio)
        if r != 0:
            codigo = r
        hubo = True
    if args.cambio:
        r = cmd_cambio(args.cambio, directorio)
        if r != 0:
            codigo = r
        hubo = True
    if args.como_json:
        r = cmd_json(directorio)
        if r != 0:
            codigo = r
        hubo = True
    elif args.mostrar:
        r = cmd_mostrar(directorio)
        if r != 0:
            codigo = r
        hubo = True

    if not hubo:
        _parse_args(["--help"])
        return 1
    return codigo


if __name__ == "__main__":
    sys.exit(main())
