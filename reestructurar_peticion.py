"""
reestructurar_peticion.py - Convierte una petición informal en prompt profesional
================================================================================
Heurísticas + plantilla. No llama APIs externas.

Uso:
    python reestructurar_peticion.py "quiero añadir login"
    python reestructurar_peticion.py --texto "..." [--ruta DIR]
    python reestructurar_peticion.py --json "..."
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

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
# MÓDULO 1: CONSTANTES
# ─────────────────────────────────────────────

INTENCIONES = (
    "crear",
    "modificar",
    "corregir",
    "auditar",
    "preguntar",
    "idea",
    "otro",
)

TIPOS_PROYECTO = ("python", "node", "mql5", "android", "desconocido")

# Más específico primero: el primer match gana.
_PATRONES_INTENCION: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("auditar", (
        "audita", "auditar", "auditoria", "revisa", "revisar",
        "qa autonomo", "health check", "chequea", "chequear",
    )),
    ("corregir", (
        "arregla", "arreglar", "corrige", "corregir", "fix", "bug",
        "error", "rompe", "roto", "no funciona", "falla", "fallo",
        "no pierda", "no pierde", "pierda", "pierde",
    )),
    ("preguntar", (
        "como hago", "como funciona", "como se", "como puedo",
        "que es", "que hace", "por que", "explica", "explicame",
        "donde esta",
    )),
    ("idea", (
        "idea", "pense", "que tal si", "podriamos", "seria genial",
    )),
    ("modificar", (
        "cambia", "cambiar", "modifica", "modificar", "actualiza",
        "actualizar", "reemplaza", "reemplazar", "renombra", "renombrar",
        "ajusta", "ajustar",
    )),
    ("crear", (
        "anade", "anadir", "agrega", "agregar", "crea", "crear",
        "hazme", "nuevo", "implementa", "implementar", "quiero",
    )),
)

_ALCANCE_KEYWORDS: Tuple[Tuple[Tuple[str, ...], str], ...] = (
    (("login", "auth", "autenticacion", "signin", "signup", "sesion"),
     "autenticación / login"),
    (("stop loss", "stoploss", "take profit", "takeprofit"),
     "gestión de riesgo (SL/TP), OnTick / trade"),
    (("readme", "documentacion"),
     "README.md, actualizar_readme.py"),
    (("test", "pytest", "jest"),
     "tests/"),
    (("conector", "import", "handler"),
     "verificar_conectores.py y módulos llamados"),
    (("logica", "division", "useeffect"),
     "detectar_logica.py y el flujo afectado"),
    (("memoria", "recuerda", "sesion"),
     "MEMORIA.md, memoria_proyecto.py"),
    (("vision", "roadmap", "backlog"),
     "VISION.md, vision_proyecto.py"),
    (("contexto", "arquitectura"),
     "CONTEXTO.md, actualizar_contexto.py"),
    (("proyecto nuevo", "nuevo proyecto", "crear proyecto"),
     "crear_proyecto.py y estructura del tipo detectado"),
)

_HERRAMIENTAS_KIT = (
    "qa_autonomo",
    "vision_proyecto",
    "memoria",
    "actualizar_readme",
    "verificar_conectores",
    "detectar_logica",
    "crear_proyecto",
)

_MAPA_ACENTOS = str.maketrans(
    "áéíóúüñÁÉÍÓÚÜÑ",
    "aeiouunAEIOUUN",
)

_PISTAS_ES = (
    "quiero", "anade", "anadir", "crea", "crear", "arregla",
    "como", "que ", "por que", "el ", "la ", "para", "con ",
    "una ", "un ", "no ", "hazme", "necesito", "proyecto",
)


# ─────────────────────────────────────────────
# MÓDULO 2: NORMALIZACIÓN Y DETECCIÓN
# ─────────────────────────────────────────────

def resolver_directorio(ruta: Optional[str]) -> Path:
    """Resuelve el directorio del proyecto (--ruta o cwd)."""
    if ruta:
        return Path(ruta).expanduser().resolve()
    return Path.cwd().resolve()


def normalizar(texto: str) -> str:
    """Minúsculas, sin acentos, espacios colapsados."""
    plano = (texto or "").translate(_MAPA_ACENTOS).lower()
    return " ".join(plano.split())


def _contiene_patron(texto_norm: str, patron: str) -> bool:
    """True si el patrón aparece como frase/palabra (no subcadena ciega)."""
    if " " in patron:
        return patron in texto_norm
    return re.search(rf"(?<![a-z0-9_]){re.escape(patron)}(?![a-z0-9_])", texto_norm) is not None


def detectar_intencion(texto: str) -> str:
    """Clasifica la petición: crear|modificar|corregir|auditar|preguntar|idea|otro."""
    t = normalizar(texto)
    if not t:
        return "otro"
    primera = t.split()[0] if t.split() else ""
    if primera in ("como", "que", "porque") or t.startswith(("por que", "explica")):
        return "preguntar"
    for intencion, patrones in _PATRONES_INTENCION:
        for patron in patrones:
            if _contiene_patron(t, patron):
                return intencion
    return "otro"


def detectar_tipo_proyecto(directorio: Path) -> str:
    """
    Autodetecta python|node|mql5|android|desconocido.
    Solo mira raíz y src/ (ERR-004: no glob recursivo a subproyectos).
    """
    d = Path(directorio)
    try:
        if (
            (d / "build.gradle").exists()
            or (d / "build.gradle.kts").exists()
            or (d / "AndroidManifest.xml").exists()
        ):
            return "android"

        mql: List[Path] = []
        mql.extend(d.glob("*.mq5"))
        mql.extend(d.glob("*.mq4"))
        mql.extend(d.glob("*.mqh"))
        mql.extend(d.glob("src/*.mq5"))
        mql.extend(d.glob("src/*.mq4"))
        mql.extend(d.glob("src/*.mqh"))
        if mql:
            return "mql5"

        if (d / "package.json").exists():
            return "node"

        indicadores_py = ("requirements.txt", "pyproject.toml", "setup.py", "setup.cfg")
        if any((d / nombre).exists() for nombre in indicadores_py):
            return "python"
        if list(d.glob("*.py")):
            return "python"
    except OSError:
        return "desconocido"
    return "desconocido"


def habla_espanol(texto: str) -> bool:
    """Heurística: pistas léxicas o caracteres típicos del español."""
    if re.search(r"[áéíóúñ¿¡]", texto or "", flags=re.IGNORECASE):
        return True
    t = normalizar(texto)
    return any(pista in t for pista in _PISTAS_ES)


# ─────────────────────────────────────────────
# MÓDULO 3: CONTEXTO DEL REPO (1 LÍNEA)
# ─────────────────────────────────────────────

def _primera_linea_util(contenido: str, max_len: int = 72) -> str:
    """Primera línea con contenido real (sin títulos ni tablas)."""
    for linea in (contenido or "").splitlines():
        s = linea.strip()
        if not s or s.startswith("#") or s.startswith("```") or s.startswith("|"):
            continue
        if s.startswith("- "):
            s = s[2:].strip()
        s = " ".join(s.split())
        if s:
            return s[:max_len]
    return ""


def leer_contexto_una_linea(directorio: Path) -> str:
    """Resume CONTEXTO.md / VISION.md / MEMORIA.md en una sola línea."""
    partes: List[str] = []
    for nombre in ("CONTEXTO.md", "VISION.md", "MEMORIA.md"):
        ruta = directorio / nombre
        if not ruta.exists():
            continue
        try:
            texto = ruta.read_text(encoding="utf-8")
        except OSError:
            continue
        snippet = _primera_linea_util(texto)
        etiqueta = nombre.replace(".md", "")
        if snippet:
            partes.append(f"{etiqueta}: {snippet}")
        else:
            partes.append(f"{etiqueta}: presente")
    if not partes:
        return "Sin CONTEXTO/VISION/MEMORIA en el directorio."
    return " | ".join(partes)


# ─────────────────────────────────────────────
# MÓDULO 4: ALCANCE, HERRAMIENTAS, ENTREGABLE
# ─────────────────────────────────────────────

def inferir_alcance(texto: str, tipo_proyecto: str) -> str:
    """Archivos o módulos probables según keywords y tipo."""
    t = normalizar(texto)
    hallados: List[str] = []
    for claves, etiqueta in _ALCANCE_KEYWORDS:
        if any(_contiene_patron(t, clave) or clave in t for clave in claves):
            hallados.append(etiqueta)

    if not hallados:
        por_tipo = {
            "python": "módulos Python del cwd (revisar CONTEXTO.md)",
            "node": "archivos JS/TS y package.json",
            "mql5": "EA / OnTick y gestión de riesgo",
            "android": "Activities, Gradle y AndroidManifest",
            "desconocido": "módulos relacionados con el objetivo (revisar CONTEXTO.md)",
        }
        hallados.append(por_tipo.get(tipo_proyecto, por_tipo["desconocido"]))
    return "; ".join(hallados)


def sugerir_herramientas(texto: str, intencion: str) -> List[str]:
    """Scripts del kit QA relevantes para esta petición."""
    t = normalizar(texto)
    tools: List[str] = []

    def _add(nombre: str) -> None:
        if nombre in _HERRAMIENTAS_KIT and nombre not in tools:
            tools.append(nombre)

    if intencion == "auditar":
        _add("qa_autonomo")
        _add("verificar_conectores")
        _add("detectar_logica")
    elif intencion == "corregir":
        _add("detectar_logica")
        _add("verificar_conectores")
        _add("qa_autonomo")
    elif intencion == "crear":
        if any(_contiene_patron(t, p) for p in (
            "proyecto", "repo", "plantilla", "carpeta",
        )):
            _add("crear_proyecto")
        _add("verificar_conectores")
        _add("detectar_logica")
    elif intencion == "modificar":
        _add("verificar_conectores")
        _add("detectar_logica")
    elif intencion == "idea":
        _add("vision_proyecto")
    elif intencion == "preguntar":
        pass

    if any(p in t for p in ("readme", "documentacion")):
        _add("actualizar_readme")
    if any(_contiene_patron(t, p) for p in ("memoria", "recuerda", "sesion")):
        _add("memoria")
    if any(_contiene_patron(t, p) for p in ("vision", "roadmap", "backlog", "idea")):
        _add("vision_proyecto")
    if any(p in t for p in ("nuevo proyecto", "crear proyecto", "crea un proyecto")):
        _add("crear_proyecto")

    if intencion in ("crear", "modificar", "corregir") and "qa_autonomo" not in tools:
        _add("qa_autonomo")

    return tools


def inferir_entregable(intencion: str) -> str:
    """Qué debe devolver el agente al terminar."""
    return {
        "crear": "Código e integración del módulo/función nuevo, con tests si aplica.",
        "modificar": "Cambio acotado en el alcance, sin regresiones.",
        "corregir": "Fix verificado (sintaxis/tests) y causa breve.",
        "auditar": "Informe de hallazgos con criticidad y acciones concretas.",
        "preguntar": "Respuesta clara con evidencia del código o docs del repo.",
        "idea": "Encaje en la arquitectura y un próximo paso concreto.",
        "otro": "Resultado accionable alineado al objetivo reformulado.",
    }.get(intencion, "Resultado accionable alineado al objetivo reformulado.")


def reformular_objetivo(texto: str, intencion: str) -> str:
    """1-2 frases claras a partir del texto informal."""
    limpio = " ".join((texto or "").strip().split())
    if not limpio:
        return "La petición está vacía; pedir al usuario el objetivo concreto."
    if not limpio.endswith((".", "?", "!")):
        limpio = f"{limpio}."
    prefijos = {
        "crear": "Implementar lo pedido",
        "modificar": "Modificar el comportamiento existente",
        "corregir": "Corregir el defecto descrito",
        "auditar": "Auditar y verificar el estado",
        "preguntar": "Responder con precisión técnica",
        "idea": "Evaluar la idea y proponer encaje",
        "otro": "Resolver la petición",
    }
    prefijo = prefijos.get(intencion, "Resolver la petición")
    return f"{prefijo}: {limpio}"


def construir_restricciones(texto: str) -> str:
    """Restricciones fijas + idioma si el usuario habla español."""
    partes = [
        "no romper lo que funciona",
        "respetar CONTEXTO/VISION/MEMORIA",
    ]
    if habla_espanol(texto):
        partes.append("idioma español si el user habla español")
    return "; ".join(partes)


def construir_prompt_agente(p: "PromptProfesional") -> str:
    """Párrafo técnico preciso para ejecutar, no la frase vaga original."""
    tools = ", ".join(p.herramientas) if p.herramientas else "ninguna específica del kit"
    return (
        f"Ejecuta una tarea de tipo «{p.intencion}» en un proyecto {p.tipo_proyecto}. "
        f"Objetivo: {p.objetivo} "
        f"Alcance probable: {p.alcance}. "
        f"Herramientas del kit a usar si aplican: {tools}. "
        f"Entregable: {p.entregable} "
        f"Restricciones: {p.restricciones}. "
        f"Contexto del repo: {p.contexto}"
    )


# ─────────────────────────────────────────────
# MÓDULO 5: MODELO Y FORMATO
# ─────────────────────────────────────────────

@dataclass
class PromptProfesional:
    """Resultado estructurado de la reestructuración."""

    intencion: str
    tipo_proyecto: str
    objetivo: str
    alcance: str
    herramientas: List[str] = field(default_factory=list)
    entregable: str = ""
    restricciones: str = ""
    contexto: str = ""
    prompt_agente: str = ""

    def to_dict(self) -> dict:
        return {
            "intencion": self.intencion,
            "tipo_proyecto": self.tipo_proyecto,
            "objetivo": self.objetivo,
            "alcance": self.alcance,
            "herramientas": list(self.herramientas),
            "entregable": self.entregable,
            "restricciones": self.restricciones,
            "contexto": self.contexto,
            "prompt_agente": self.prompt_agente,
        }


def reestructurar(texto: str, directorio: Optional[str] = None) -> PromptProfesional:
    """Convierte texto informal en un PromptProfesional (sin I/O de red)."""
    d = resolver_directorio(directorio)
    intencion = detectar_intencion(texto)
    tipo = detectar_tipo_proyecto(d)
    prompt = PromptProfesional(
        intencion=intencion,
        tipo_proyecto=tipo,
        objetivo=reformular_objetivo(texto, intencion),
        alcance=inferir_alcance(texto, tipo),
        herramientas=sugerir_herramientas(texto, intencion),
        entregable=inferir_entregable(intencion),
        restricciones=construir_restricciones(texto),
        contexto=leer_contexto_una_linea(d),
    )
    prompt.prompt_agente = construir_prompt_agente(prompt)
    return prompt


def formatear_texto(p: PromptProfesional) -> str:
    """Salida humana con las secciones canónicas."""
    tools = ", ".join(p.herramientas) if p.herramientas else "(ninguna específica del kit)"
    return (
        "# Prompt profesional\n"
        f"## Intención: {p.intencion}\n"
        f"## Tipo de proyecto: {p.tipo_proyecto}\n"
        f"## Objetivo: {p.objetivo}\n"
        f"## Alcance: {p.alcance}\n"
        f"## Herramientas sugeridas: {tools}\n"
        f"## Entregable esperado: {p.entregable}\n"
        f"## Restricciones: {p.restricciones}\n"
        f"## Contexto: {p.contexto}\n"
        f"## Prompt listo para el agente: {p.prompt_agente}\n"
    )


def formatear_json(p: PromptProfesional) -> str:
    """JSON UTF-8 (ensure_ascii=False) para integración."""
    return json.dumps(p.to_dict(), ensure_ascii=False, indent=2)


# ─────────────────────────────────────────────
# MÓDULO 6: CLI
# ─────────────────────────────────────────────

def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reestructura una petición informal en un prompt profesional.",
    )
    parser.add_argument(
        "texto_posicional",
        nargs="?",
        default=None,
        help="Texto informal de la petición",
    )
    parser.add_argument(
        "--texto",
        default=None,
        help="Texto informal (alternativa al posicional)",
    )
    parser.add_argument(
        "--json",
        nargs="?",
        const="",
        default=None,
        metavar="TEXTO",
        help="Salida JSON. Opcionalmente el texto a reestructurar.",
    )
    parser.add_argument(
        "--ruta",
        default=None,
        help="Directorio del proyecto (default: cwd)",
    )
    return parser.parse_args(argv)


def _resolver_texto(args: argparse.Namespace) -> str:
    """Prioridad: --json TEXTO > --texto > posicional."""
    if args.json:
        return str(args.json)
    if args.texto:
        return str(args.texto)
    if args.texto_posicional:
        return str(args.texto_posicional)
    return ""


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)
    texto = _resolver_texto(args).strip()
    if not texto:
        print("❌ Debes proporcionar el texto de la petición.", file=sys.stderr)
        print('   Ejemplo: python reestructurar_peticion.py "quiero añadir login"')
        return 1

    directorio = args.ruta if args.ruta else os.getcwd()
    try:
        prompt = reestructurar(texto, directorio)
    except OSError as e:
        print(f"❌ Error de I/O al reestructurar: {e}", file=sys.stderr)
        return 1

    como_json = args.json is not None
    try:
        if como_json:
            print(formatear_json(prompt))
        else:
            print(formatear_texto(prompt), end="")
    except OSError as e:
        print(f"❌ No se pudo escribir la salida: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
