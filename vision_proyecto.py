"""
vision_proyecto.py - Sistema de Visión Incremental de Proyecto
==============================================================
Mantiene un archivo VISION.md que crece con cada petición del usuario,
capturando intenciones, módulos y el roadmap de forma incremental y aditiva.

Uso:
    python vision_proyecto.py --init [ruta]         # Crea VISION.md vacío
    python vision_proyecto.py --idea "texto"        # Añade idea al backlog
    python vision_proyecto.py --actualizar [ruta]   # Re-analiza el proyecto
    python vision_proyecto.py --mostrar             # Muestra la visión actual
    python vision_proyecto.py --completar "módulo"  # Marca módulo como completado
    python vision_proyecto.py --json                # Salida JSON
"""

import os
import sys
import json
import ast
import re
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional

from qa_safe_io import under_root

# Forzar UTF-8 en Windows para evitar UnicodeEncodeError en terminales cp1252
# Usa reconfigure() — no reemplaza sys.stdout (seguro bajo pytest/CI)
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

VISION_FILENAME = "VISION.md"

# Emojis de estado para módulos
ESTADO_COMPLETADO = "✅"
ESTADO_EN_PROGRESO = "🔄"
ESTADO_PLANIFICADO = "📋"
ESTADO_SUGERIDO = "💡"

# Módulos sugeridos por tipo de proyecto
_MODULOS_SUGERIDOS = {
    "python": [
        "main.py — Punto de entrada principal",
        "tests/ — Suite de tests con pytest",
        "requirements.txt — Gestión de dependencias",
        ".env / configuración — Variables de entorno",
        "CI/CD — GitHub Actions (comprobacion.yml)",
    ],
    "python-web": [
        "API REST — Endpoints principales",
        "Modelos de datos — Esquemas y validación",
        "Autenticación — JWT / OAuth",
        "Tests de integración — pytest + httpx",
        "Docker — Containerización",
    ],
    "python-ml": [
        "Preprocesamiento de datos — Pipeline de transformación",
        "Modelo — Entrenamiento y evaluación",
        "Inferencia — Endpoint de predicción",
        "Métricas — Accuracy, loss, curvas",
        "Exportación — Guardado/carga del modelo",
    ],
    "mql5": [
        "Expert Advisor (.mq5) — Lógica principal de trading",
        "Gestión de riesgo — StopLoss, TakeProfit, lotaje",
        "Indicadores — Señales de entrada/salida",
        "Backtesting — Validación histórica",
        "Logging — Registro de operaciones",
    ],
    "nodejs": [
        "index.js / app.js — Punto de entrada",
        "package.json — Dependencias y scripts",
        "Rutas — Endpoints de la API",
        "Middleware — Autenticación, CORS, logging",
        "Tests — Jest / Mocha",
    ],
    "react": [
        "Componentes — UI reutilizable",
        "Estado global — Context / Redux / Zustand",
        "Rutas — React Router",
        "API calls — Fetch / Axios con manejo de errores",
        "Tests — React Testing Library",
    ],
    "android": [
        "Activities/Fragments — Pantallas principales",
        "ViewModel — Lógica de presentación",
        "Repository — Capa de datos",
        "API / Room — Red y persistencia local",
        "Tests instrumentados — Espresso",
    ],
}


@dataclass
class VisionProyecto:
    """Modelo de datos de la visión del proyecto."""
    nombre: str
    idea_central: str = "[Describe qué es este proyecto en 2-3 líneas]"
    tipo: str = "python"
    arquitectura: str = "[Estructura técnica sugerida]"
    modulos: list[dict] = field(default_factory=list)
    roadmap: dict = field(default_factory=lambda: {
        "fase1": [],
        "fase2": [],
        "fase3": [],
    })
    backlog_ideas: list[str] = field(default_factory=list)
    historial: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "nombre": self.nombre,
            "idea_central": self.idea_central,
            "tipo": self.tipo,
            "arquitectura": self.arquitectura,
            "modulos": self.modulos,
            "roadmap": self.roadmap,
            "backlog_ideas": self.backlog_ideas,
            "historial": self.historial,
        }


# ─────────────────────────────────────────────
# MÓDULO 2: DETECTOR DE TIPO DE PROYECTO
# ─────────────────────────────────────────────

def detectar_tipo_proyecto(directorio: str) -> str:
    """
    Detecta el tipo de proyecto analizando archivos indicadores.
    Retorna una cadena que identifica el tipo.
    """
    d = Path(directorio)

    # Android
    if (d / "build.gradle").exists() or (d / "AndroidManifest.xml").exists():
        return "android"

    # MQL5/MQL4 — solo en raíz y src/ para evitar falsos positivos
    mql_files = (
        list(d.glob("*.mq5")) + list(d.glob("*.mq4"))
        + list(d.glob("src/*.mq5")) + list(d.glob("src/*.mq4"))
    )
    if mql_files:
        return "mql5"

    # Node / React / Next
    pkg = under_root(d, "package.json")
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
            if "express" in deps or "fastify" in deps:
                return "nodejs"
        except Exception:
            pass
        return "nodejs"

    # Python — detectar sub-tipo
    py_indicators = ["requirements.txt", "pyproject.toml", "setup.py"]
    if any((d / f).exists() for f in py_indicators) or list(d.glob("*.py")):
        req_file = under_root(d, "requirements.txt")
        if req_file.exists():
            try:
                req = req_file.read_text(encoding="utf-8", errors="ignore").lower()
                if any(x in req for x in ["django", "flask", "fastapi", "starlette"]):
                    return "python-web"
                if any(x in req for x in ["tensorflow", "torch", "sklearn", "keras"]):
                    return "python-ml"
                if any(x in req for x in ["ccxt", "binance", "alpaca"]):
                    return "python-trading"
            except Exception:
                pass
        return "python"

    # Rust / Go / .NET
    if (d / "Cargo.toml").exists():
        return "rust"
    if (d / "go.mod").exists():
        return "go"
    if list(d.glob("*.sln")) or list(d.glob("*.csproj")):
        return "dotnet"

    return "python"


# ─────────────────────────────────────────────
# MÓDULO 3: ANÁLISIS DEL CÓDIGO EXISTENTE
# ─────────────────────────────────────────────

_EXCLUIR_DIRS = {
    ".venv", "venv", "__pycache__", "node_modules", "dist",
    "build", ".pytest_cache", ".mypy_cache", ".git",
}


def analizar_modulos_existentes(directorio: str, tipo: str) -> list[dict]:
    """
    Analiza el código existente para inferir qué módulos ya están construidos.
    Retorna lista de dicts con {nombre, estado, descripcion}.
    """
    d = Path(directorio)
    modulos = []

    try:
        # Python: detectar archivos .py relevantes
        if tipo.startswith("python"):
            for py_file in d.iterdir():
                if py_file.suffix != ".py":
                    continue
                if py_file.name.startswith("_") or py_file.name.startswith("."):
                    continue
                funciones = _contar_funciones_py(py_file)
                desc = f"{funciones} función(es)" if funciones else "módulo Python"
                modulos.append({
                    "nombre": py_file.name,
                    "estado": ESTADO_COMPLETADO,
                    "descripcion": desc,
                })

            # Detectar tests
            tests_dir = d / "tests"
            if tests_dir.exists():
                test_files = list(tests_dir.glob("test_*.py"))
                modulos.append({
                    "nombre": "tests/",
                    "estado": ESTADO_COMPLETADO,
                    "descripcion": f"{len(test_files)} archivo(s) de test",
                })

        # MQL5: detectar archivos .mq5
        elif tipo == "mql5":
            for mq_file in list(d.glob("**/*.mq5")) + list(d.glob("**/*.mq4")):
                if any(p in _EXCLUIR_DIRS for p in mq_file.parts):
                    continue
                modulos.append({
                    "nombre": mq_file.name,
                    "estado": ESTADO_COMPLETADO,
                    "descripcion": "Expert Advisor / Script MQL",
                })

        # Node: detectar archivos js/ts clave
        elif tipo in ("nodejs", "react", "nextjs", "react-native"):
            for fname in ["index.js", "app.js", "server.js", "index.ts", "app.ts"]:
                if (d / fname).exists():
                    modulos.append({
                        "nombre": fname,
                        "estado": ESTADO_COMPLETADO,
                        "descripcion": "Punto de entrada principal",
                    })
            if (d / "package.json").exists():
                modulos.append({
                    "nombre": "package.json",
                    "estado": ESTADO_COMPLETADO,
                    "descripcion": "Configuración de dependencias y scripts",
                })

    except Exception:
        pass  # Nunca fallar en el análisis

    return modulos


def _contar_funciones_py(ruta: Path) -> int:
    """Cuenta funciones y clases definidas en un archivo Python."""
    try:
        tree = ast.parse(ruta.read_text(encoding="utf-8", errors="ignore"))
        return sum(
            1 for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        )
    except Exception:
        return 0


# ─────────────────────────────────────────────
# MÓDULO 4: LECTURA Y ESCRITURA DE VISION.MD
# ─────────────────────────────────────────────

def _ruta_vision(directorio: str) -> Path:
    """Retorna la ruta completa a VISION.md en el directorio dado."""
    return Path(directorio) / VISION_FILENAME


def leer_vision(directorio: str) -> Optional[VisionProyecto]:
    """
    Lee VISION.md y extrae los datos estructurados.
    Retorna None si el archivo no existe o no se puede parsear.
    """
    ruta = _ruta_vision(directorio)
    if not ruta.exists():
        return None

    try:
        contenido = ruta.read_text(encoding="utf-8", errors="ignore")
        return _parsear_vision_md(contenido, Path(directorio).name)
    except Exception:
        return None


def _parsear_vision_md(contenido: str, nombre_fallback: str) -> VisionProyecto:
    """
    Parsea el contenido de VISION.md y extrae los campos clave.
    Parseo tolerante: si una sección falta, usa valores por defecto.
    """
    vision = VisionProyecto(nombre=nombre_fallback)

    # Extraer nombre del proyecto del título
    titulo_match = re.search(r"#\s*🎯\s*Visión del Proyecto:\s*(.+)", contenido)
    if titulo_match:
        vision.nombre = titulo_match.group(1).strip()

    # Extraer idea central
    idea_match = re.search(
        r"##\s*💡\s*Idea Central\s*\n(.*?)(?=\n##|\Z)", contenido, re.DOTALL
    )
    if idea_match:
        vision.idea_central = idea_match.group(1).strip()

    # Extraer módulos — líneas que empiecen con emoji de estado + guion
    modulos_section = re.search(
        r"##\s*📦\s*Módulos\s*\n(.*?)(?=\n##|\Z)", contenido, re.DOTALL
    )
    if modulos_section:
        for linea in modulos_section.group(1).splitlines():
            linea = linea.strip()
            for emoji in [ESTADO_COMPLETADO, ESTADO_EN_PROGRESO, ESTADO_PLANIFICADO, ESTADO_SUGERIDO]:
                if linea.startswith(f"- {emoji}"):
                    texto = linea[len(f"- {emoji}"):].strip()
                    vision.modulos.append({
                        "nombre": texto,
                        "estado": emoji,
                        "descripcion": "",
                    })
                    break

    # Extraer backlog de ideas
    backlog_section = re.search(
        r"##\s*💭\s*Ideas del Backlog\s*\n(.*?)(?=\n##|\Z)", contenido, re.DOTALL
    )
    if backlog_section:
        for linea in backlog_section.group(1).splitlines():
            linea = linea.strip()
            if linea.startswith("- ") and len(linea) > 2:
                idea = linea[2:].strip()
                if idea and idea != "[ideas sueltas que el usuario ha mencionado]":
                    vision.backlog_ideas.append(idea)

    # Extraer historial
    historial_section = re.search(
        r"##\s*📈\s*Historial de Evolución\s*\n(.*?)(?=\n##|\Z)", contenido, re.DOTALL
    )
    if historial_section:
        for linea in historial_section.group(1).splitlines():
            linea = linea.strip()
            ts_match = re.match(r"-\s*\[(\d{4}-\d{2}-\d{2}.*?)\]\s*(.*)", linea)
            if ts_match:
                vision.historial.append({
                    "timestamp": ts_match.group(1),
                    "evento": ts_match.group(2).strip(),
                })

    return vision


def escribir_vision(vision: VisionProyecto, directorio: str):
    """
    Escribe VISION.md completo a partir del objeto VisionProyecto.
    Siempre sobreescribe (pero los datos vienen del objeto que ya tiene
    el historial acumulado — nunca se pierde información).
    """
    ruta = _ruta_vision(directorio)
    contenido = _generar_vision_md(vision)
    try:
        ruta.write_text(contenido, encoding="utf-8")
    except OSError as e:
        print(f"❌ Error escribiendo VISION.md: {e}", file=sys.stderr)
        raise


def _generar_vision_md(vision: VisionProyecto) -> str:
    """Genera el contenido completo de VISION.md."""
    lineas = []

    # Encabezado
    lineas.append(f"# 🎯 Visión del Proyecto: {vision.nombre}")
    lineas.append("")

    # Idea Central
    lineas.append("## 💡 Idea Central")
    lineas.append(vision.idea_central)
    lineas.append("")

    # Arquitectura Propuesta
    lineas.append("## 🏗️ Arquitectura Propuesta")
    lineas.append(vision.arquitectura)
    lineas.append("")

    # Módulos
    lineas.append("## 📦 Módulos")
    if vision.modulos:
        for mod in vision.modulos:
            estado = mod.get("estado", ESTADO_PLANIFICADO)
            nombre = mod.get("nombre", "")
            desc = mod.get("descripcion", "")
            if desc:
                lineas.append(f"- {estado} {nombre} — {desc}")
            else:
                lineas.append(f"- {estado} {nombre}")
    else:
        lineas.append("- 📋 [Módulos pendientes de definir]")
    lineas.append("")

    # Roadmap
    lineas.append("## 🗺️ Roadmap")
    lineas.append("")
    lineas.append("### Fase 1 — MVP")
    fase1 = vision.roadmap.get("fase1", [])
    if fase1:
        for item in fase1:
            lineas.append(f"- {item}")
    else:
        lineas.append("- [ ] Definir funcionalidades mínimas del MVP")
    lineas.append("")

    lineas.append("### Fase 2 — Mejoras")
    fase2 = vision.roadmap.get("fase2", [])
    if fase2:
        for item in fase2:
            lineas.append(f"- {item}")
    else:
        lineas.append("- [ ] Mejorar UX y rendimiento")
    lineas.append("")

    lineas.append("### Fase 3 — Avanzado")
    fase3 = vision.roadmap.get("fase3", [])
    if fase3:
        for item in fase3:
            lineas.append(f"- {item}")
    else:
        lineas.append("- [ ] Funcionalidades avanzadas y optimizaciones")
    lineas.append("")

    # Backlog de ideas
    lineas.append("## 💭 Ideas del Backlog")
    if vision.backlog_ideas:
        for idea in vision.backlog_ideas:
            lineas.append(f"- {idea}")
    else:
        lineas.append("- [ideas sueltas que el usuario ha mencionado]")
    lineas.append("")

    # Historial de Evolución
    lineas.append("## 📈 Historial de Evolución")
    if vision.historial:
        for entrada in vision.historial:
            ts = entrada.get("timestamp", "")
            evento = entrada.get("evento", "")
            lineas.append(f"- [{ts}] {evento}")
    else:
        lineas.append("- [Sin entradas aún]")
    lineas.append("")

    return "\n".join(lineas)


# ─────────────────────────────────────────────
# MÓDULO 5: COMANDOS PRINCIPALES
# ─────────────────────────────────────────────

def cmd_init(directorio: str) -> int:
    """
    Inicializa VISION.md en el directorio del proyecto.
    Si ya existe, no lo sobreescribe — es aditivo.
    """
    directorio = os.path.abspath(directorio)
    ruta = _ruta_vision(directorio)

    if ruta.exists():
        print(f"ℹ️  VISION.md ya existe en {directorio} — no se sobreescribe.")
        return 0

    nombre = Path(directorio).name
    tipo = detectar_tipo_proyecto(directorio)

    # Crear visión inicial con análisis del proyecto
    vision = VisionProyecto(nombre=nombre, tipo=tipo)

    # Generar arquitectura sugerida según el tipo
    vision.arquitectura = _generar_arquitectura(tipo, directorio)

    # Detectar módulos existentes
    modulos_detectados = analizar_modulos_existentes(directorio, tipo)
    vision.modulos = modulos_detectados

    # Añadir módulos sugeridos que aún no existen
    sugeridos = _MODULOS_SUGERIDOS.get(tipo, _MODULOS_SUGERIDOS["python"])
    nombres_existentes = {m["nombre"] for m in modulos_detectados}
    for sug in sugeridos:
        nombre_sug = sug.split(" — ")[0].strip()
        if nombre_sug not in nombres_existentes:
            vision.modulos.append({
                "nombre": sug,
                "estado": ESTADO_SUGERIDO,
                "descripcion": "",
            })

    # Roadmap inicial
    vision.roadmap["fase1"] = [
        "Definir la idea central del proyecto",
        "Crear la estructura base de archivos",
        "Implementar funcionalidad mínima funcional",
    ]
    vision.roadmap["fase2"] = [
        "Añadir tests automatizados",
        "Mejorar manejo de errores",
        "Documentar API/interfaces públicas",
    ]
    vision.roadmap["fase3"] = [
        "Optimizar rendimiento",
        "Añadir CI/CD completo",
        "Preparar para producción/distribución",
    ]

    # Historial inicial
    vision.historial.append({
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "evento": f"VISION.md inicializado para proyecto '{nombre}' (tipo: {tipo})",
    })

    try:
        escribir_vision(vision, directorio)
        print(f"✅ VISION.md creado en {directorio}")
        print(f"   Tipo detectado: {tipo}")
        print(f"   Módulos detectados: {len(modulos_detectados)}")
        return 0
    except Exception as e:
        print(f"❌ Error al inicializar VISION.md: {e}", file=sys.stderr)
        return 1


def cmd_agregar_idea(idea: str, directorio: str) -> int:
    """
    Añade una idea al backlog de VISION.md.
    Si VISION.md no existe, lo crea primero (--init automático).
    NUNCA elimina ideas existentes — siempre aditivo.
    """
    directorio = os.path.abspath(directorio)
    ruta = _ruta_vision(directorio)

    # Auto-init si no existe
    if not ruta.exists():
        print("ℹ️  VISION.md no existe — creando automáticamente...")
        ret = cmd_init(directorio)
        if ret != 0:
            return ret

    try:
        vision = leer_vision(directorio)
        if vision is None:
            print("❌ No se pudo leer VISION.md", file=sys.stderr)
            return 1

        # Verificar duplicados (comparación insensible a mayúsculas)
        idea_lower = idea.strip().lower()
        for existente in vision.backlog_ideas:
            if existente.strip().lower() == idea_lower:
                print(f"ℹ️  La idea ya existe en el backlog: '{existente}'")
                return 0

        # Añadir la idea
        vision.backlog_ideas.append(idea.strip())

        # Registrar en historial
        vision.historial.append({
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "evento": f"Idea añadida al backlog: \"{idea.strip()[:80]}\"",
        })

        escribir_vision(vision, directorio)
        print(f"✅ Idea añadida al backlog: \"{idea.strip()[:80]}\"")
        print(f"   Total de ideas en backlog: {len(vision.backlog_ideas)}")
        return 0

    except Exception as e:
        print(f"❌ Error al añadir idea: {e}", file=sys.stderr)
        return 1


def cmd_actualizar(directorio: str) -> int:
    """
    Re-analiza el proyecto y actualiza los módulos detectados en VISION.md.
    Preserva el backlog y el historial existentes.
    """
    directorio = os.path.abspath(directorio)
    ruta = _ruta_vision(directorio)

    # Auto-init si no existe
    if not ruta.exists():
        return cmd_init(directorio)

    try:
        vision = leer_vision(directorio)
        if vision is None:
            return cmd_init(directorio)

        tipo = detectar_tipo_proyecto(directorio)
        vision.tipo = tipo

        # Re-detectar módulos y marcar como completados los que ya existen
        modulos_detectados = analizar_modulos_existentes(directorio, tipo)
        nombres_detectados = {m["nombre"] for m in modulos_detectados}

        # Preservar módulos planificados/sugeridos que no se han completado
        modulos_previos_no_completados = [
            m for m in vision.modulos
            if m.get("estado") not in (ESTADO_COMPLETADO,)
            and m.get("nombre") not in nombres_detectados
        ]

        # Combinar: detectados ✅ + previos no completados
        vision.modulos = modulos_detectados + modulos_previos_no_completados

        # Registrar en historial
        vision.historial.append({
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "evento": f"Proyecto re-analizado — {len(modulos_detectados)} módulo(s) detectado(s)",
        })

        # Actualizar arquitectura si había placeholder
        if "[Estructura técnica sugerida]" in vision.arquitectura:
            vision.arquitectura = _generar_arquitectura(tipo, directorio)

        escribir_vision(vision, directorio)
        print(f"✅ VISION.md actualizado")
        print(f"   Tipo: {tipo} | Módulos detectados: {len(modulos_detectados)}")
        return 0

    except Exception as e:
        print(f"❌ Error al actualizar VISION.md: {e}", file=sys.stderr)
        return 1


def cmd_mostrar(directorio: str, formato_json: bool = False) -> int:
    """Muestra la visión actual del proyecto."""
    directorio = os.path.abspath(directorio)
    ruta = _ruta_vision(directorio)

    if not ruta.exists():
        print(f"ℹ️  No existe VISION.md en {directorio}")
        print("   Ejecuta: python vision_proyecto.py --init")
        return 0

    try:
        vision = leer_vision(directorio)
        if vision is None:
            print("❌ No se pudo leer VISION.md", file=sys.stderr)
            return 1

        if formato_json:
            print(json.dumps(vision.to_dict(), ensure_ascii=False, indent=2))
            return 0

        # Mostrar visión formateada en consola
        print(f"\n{'═' * 60}")
        print(f"  🎯 VISIÓN: {vision.nombre}")
        print(f"  Tipo: {vision.tipo}")
        print(f"{'═' * 60}")
        print(f"\n💡 Idea Central:\n   {vision.idea_central}")
        print(f"\n📦 Módulos ({len(vision.modulos)}):")
        for m in vision.modulos:
            print(f"   {m.get('estado', '📋')} {m.get('nombre', '')}")
        print(f"\n💭 Backlog de ideas ({len(vision.backlog_ideas)}):")
        for idea in vision.backlog_ideas:
            print(f"   • {idea}")
        if vision.historial:
            ultima = vision.historial[-1]
            print(f"\n📈 Última entrada: [{ultima.get('timestamp', '')}] {ultima.get('evento', '')}")
        print(f"\n{'═' * 60}\n")
        return 0

    except Exception as e:
        print(f"❌ Error al mostrar VISION.md: {e}", file=sys.stderr)
        return 1


def cmd_completar_modulo(nombre_modulo: str, directorio: str) -> int:
    """Marca un módulo como completado (✅) en VISION.md."""
    directorio = os.path.abspath(directorio)
    ruta = _ruta_vision(directorio)

    if not ruta.exists():
        print(f"ℹ️  No existe VISION.md en {directorio}")
        return 1

    try:
        vision = leer_vision(directorio)
        if vision is None:
            print("❌ No se pudo leer VISION.md", file=sys.stderr)
            return 1

        nombre_lower = nombre_modulo.strip().lower()
        encontrado = False
        for mod in vision.modulos:
            nombre_mod = mod.get("nombre", "").lower()
            if nombre_lower in nombre_mod:
                mod["estado"] = ESTADO_COMPLETADO
                encontrado = True

        if not encontrado:
            # Si no existe, añadirlo como completado
            vision.modulos.append({
                "nombre": nombre_modulo.strip(),
                "estado": ESTADO_COMPLETADO,
                "descripcion": "Marcado como completado manualmente",
            })

        vision.historial.append({
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "evento": f"Módulo completado: '{nombre_modulo.strip()}'",
        })

        escribir_vision(vision, directorio)
        print(f"✅ Módulo '{nombre_modulo.strip()}' marcado como completado")
        return 0

    except Exception as e:
        print(f"❌ Error al completar módulo: {e}", file=sys.stderr)
        return 1


def cmd_json(directorio: str) -> int:
    """Alias de cmd_mostrar con formato JSON."""
    return cmd_mostrar(directorio, formato_json=True)


# ─────────────────────────────────────────────
# MÓDULO 6: HELPERS
# ─────────────────────────────────────────────

def _generar_arquitectura(tipo: str, directorio: str) -> str:
    """Genera una descripción de arquitectura sugerida según el tipo."""
    arq_map = {
        "python": (
            "Estructura modular Python:\n"
            "  main.py → punto de entrada\n"
            "  src/ → módulos de lógica\n"
            "  tests/ → suite pytest\n"
            "  .env → configuración sensible (excluido de git)"
        ),
        "python-web": (
            "API REST Python:\n"
            "  app.py → aplicación principal (FastAPI/Flask)\n"
            "  models/ → esquemas de datos\n"
            "  routes/ → endpoints de la API\n"
            "  tests/ → tests de integración con httpx"
        ),
        "python-ml": (
            "Pipeline ML:\n"
            "  data/ → datasets y preprocesamiento\n"
            "  models/ → definición y entrenamiento\n"
            "  inference.py → endpoint de predicción\n"
            "  notebooks/ → exploración"
        ),
        "mql5": (
            "Expert Advisor MQL5:\n"
            "  src/*.mq5 → lógica principal del EA\n"
            "  include/*.mqh → helpers compartidos\n"
            "  Parámetros de entrada → optimizables en Strategy Tester"
        ),
        "nodejs": (
            "Aplicación Node.js:\n"
            "  index.js → punto de entrada\n"
            "  src/routes/ → endpoints\n"
            "  src/middleware/ → autenticación, logging\n"
            "  tests/ → Jest / Mocha"
        ),
        "react": (
            "Aplicación React:\n"
            "  src/components/ → UI reutilizable\n"
            "  src/pages/ → vistas principales\n"
            "  src/hooks/ → lógica custom\n"
            "  src/api/ → llamadas al backend"
        ),
        "android": (
            "App Android:\n"
            "  app/src/main/java/ → código fuente\n"
            "  Arquitectura MVVM: Activity → ViewModel → Repository → DataSource"
        ),
    }
    return arq_map.get(tipo, "Estructura por definir según el tipo de proyecto")


def _proximos_pasos(vision: VisionProyecto) -> str:
    """Genera una sugerencia de próximo paso basada en el estado actual."""
    modulos_pendientes = [
        m for m in vision.modulos
        if m.get("estado") in (ESTADO_PLANIFICADO, ESTADO_SUGERIDO)
    ]
    if vision.backlog_ideas:
        return f"Implementar idea del backlog: \"{vision.backlog_ideas[0]}\""
    if modulos_pendientes:
        return f"Desarrollar módulo: {modulos_pendientes[0].get('nombre', '')}"
    return "Revisar el roadmap y definir la Fase 2"


# ─────────────────────────────────────────────
# PUNTO DE ENTRADA
# ─────────────────────────────────────────────

def main():
    """Entry point del script."""
    args = sys.argv[1:]

    # Extraer --json antes de procesar el resto
    formato_json = "--json" in args
    args = [a for a in args if a != "--json"]

    if not args:
        print("Uso: python vision_proyecto.py [--init|--idea|--actualizar|--mostrar|--completar|--json]")
        print("       python vision_proyecto.py --init [ruta]")
        print("       python vision_proyecto.py --idea \"texto de la idea\"")
        print("       python vision_proyecto.py --mostrar")
        print("       python vision_proyecto.py --json")
        return

    comando = args[0]

    # --init [ruta]
    if comando == "--init":
        directorio = args[1] if len(args) > 1 else os.getcwd()
        sys.exit(cmd_init(directorio))

    # --idea "texto"
    elif comando == "--idea":
        if len(args) < 2:
            print("❌ Debes proporcionar el texto de la idea.")
            print("   Uso: python vision_proyecto.py --idea \"mi idea\"")
            sys.exit(1)
        idea = args[1]
        directorio = args[2] if len(args) > 2 else os.getcwd()
        sys.exit(cmd_agregar_idea(idea, directorio))

    # --actualizar [ruta]
    elif comando == "--actualizar":
        directorio = args[1] if len(args) > 1 else os.getcwd()
        sys.exit(cmd_actualizar(directorio))

    # --mostrar / --json
    elif comando in ("--mostrar", "--json"):
        directorio = args[1] if len(args) > 1 else os.getcwd()
        sys.exit(cmd_mostrar(directorio, formato_json=(comando == "--json" or formato_json)))

    # --completar "módulo"
    elif comando == "--completar":
        if len(args) < 2:
            print("❌ Debes proporcionar el nombre del módulo.")
            sys.exit(1)
        modulo = args[1]
        directorio = args[2] if len(args) > 2 else os.getcwd()
        sys.exit(cmd_completar_modulo(modulo, directorio))

    else:
        print(f"❌ Comando desconocido: '{comando}'")
        print("   Comandos válidos: --init, --idea, --actualizar, --mostrar, --completar, --json")
        sys.exit(1)


if __name__ == "__main__":
    main()
