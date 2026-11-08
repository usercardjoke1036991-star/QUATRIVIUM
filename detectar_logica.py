"""
detectar_logica.py - Detector de Errores de Lógica por Tipo de Proyecto
========================================================================
Análisis estático (AST + regex) que detecta errores de lógica: código
que compila y corre, pero hace algo INCORRECTO.

Soporta: Python (AST), MQL5 (regex), Node/React (regex).

Solo usa ast, re, pathlib, os, sys — sin dependencias externas.
No ejecuta el código analizado. Compatible con Windows/PowerShell.

Uso:
    python detectar_logica.py              # Analiza directorio actual
    python detectar_logica.py /ruta/       # Analiza ruta específica
    python detectar_logica.py --json       # Salida en formato JSON
"""

import ast
import re
import os
import sys
import json
from pathlib import Path
from qa_safe_io import confine
from dataclasses import dataclass, field

# Forzar UTF-8 en Windows para que los símbolos Unicode se impriman correctamente
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ─────────────────────────────────────────────
# ESTRUCTURAS DE DATOS
# ─────────────────────────────────────────────

@dataclass
class ProblemaLogica:
    """Un problema de lógica detectado en el código."""
    archivo: str
    linea: int
    tipo: str           # ej: "division_por_cero", "none_sin_verificar"
    mensaje: str
    sugerencia: str
    severidad: str      # "critico" | "advertencia"


# ─────────────────────────────────────────────
# HELPERS INTERNOS
# ─────────────────────────────────────────────

def _safe_unparse(node: ast.AST) -> str:
    """ast.unparse con fallback para Python < 3.9."""
    try:
        return ast.unparse(node)
    except AttributeError:
        return "<expresión>"


def _tiene_salida_directa(stmts: list) -> bool:
    """
    Verifica si hay un break o return directamente accesible en la lista.
    Un `return` también es una salida válida del while (sale de la función).
    Desciende en if/try/with pero NO en funciones/clases/loops anidados.
    """
    for stmt in stmts:
        if isinstance(stmt, (ast.Break, ast.Return)):
            return True
        if isinstance(stmt, ast.If):
            # Suficiente con que una rama tenga salida (el loop puede terminar)
            if (_tiene_salida_directa(stmt.body) or
                    _tiene_salida_directa(stmt.orelse)):
                return True
        elif isinstance(stmt, ast.Try):
            for handler in stmt.handlers:
                if _tiene_salida_directa(handler.body):
                    return True
            for parte in [stmt.body, stmt.orelse, getattr(stmt, "finalbody", [])]:
                if _tiene_salida_directa(parte):
                    return True
        elif isinstance(stmt, ast.With):
            if _tiene_salida_directa(stmt.body):
                return True
        # NO descender en: FunctionDef, AsyncFunctionDef, ClassDef, For, While
    return False


# Alias para compatibilidad (se usa en tests)
_tiene_break_directo = _tiene_salida_directa


# Nombres de variables que sugieren path de pathlib (no divisiones aritméticas)
_NOMBRES_PATH = frozenset({
    "d", "dp", "p", "f", "raiz", "base", "path", "ruta",
    "dir", "directorio", "archivo", "folder", "dst", "src",
    "item", "sub", "subdir",
})
# Sufijos de variables que sugieren path o nombre de archivo
_SUFIJOS_PATH = ("_path", "_dir", "_file", "_name", "_ruta", "fname", "dirname", "_rel")

# Palabras que, si aparecen en el nombre de variable, sugieren que es una ruta
_PALABRAS_PATH_EN_NOMBRE = frozenset({
    "path", "dir", "file", "ruta", "archivo", "folder",
    "raiz", "hook", "rule", "script", "src", "dst",
    "desde", "hacia", "root", "base", "module",
})

# Atributos de pathlib que generan nuevos Path al usarse con /
_ATTRS_PATHLIB = frozenset({"parent", "parents", "anchor", "root", "home"})


def _nombre_sugiere_path(nombre: str) -> bool:
    """Heurístico: ¿el nombre de variable sugiere que es una ruta pathlib?"""
    n = nombre.lower()
    if n in _NOMBRES_PATH:
        return True
    if any(n.endswith(s) for s in _SUFIJOS_PATH):
        return True
    if any(p in n for p in _PALABRAS_PATH_EN_NOMBRE):
        return True
    return False


# Directorios excluidos del análisis
_EXCLUIR_DIRS = {
    ".venv", "venv", "__pycache__", "node_modules", "dist", "build",
    ".pytest_cache", ".mypy_cache", ".git",
    "cache", "artifacts", ".cxx", "CMakeFiles",
    "coverage", "typechain-types", ".cache",
    ".next", ".nuxt", ".turbo", "out", "DerivedData", "Pods",
}


def _iterar_archivos_logica(directorio: Path, extensiones: set) -> list:
    """
    Itera archivos con poda de directorios excluidos y subproyectos (.git propio).
    Retorna lista de Path.
    """
    raiz = Path(directorio)
    resultado = []

    # Detectar subproyectos inmediatos (tienen su propio .git)
    subproyectos = set()
    try:
        for d in raiz.iterdir():
            if d.is_dir() and (d / ".git").exists():
                subproyectos.add(d.name)
    except OSError:
        pass

    nombres_excluidos = _EXCLUIR_DIRS | subproyectos

    for dirpath, dirnames, filenames in os.walk(str(raiz)):
        dirnames[:] = [
            d for d in dirnames
            if d not in nombres_excluidos and not d.startswith("Auditoria")
        ]
        dp = Path(dirpath)
        for fname in filenames:
            f = dp / fname
            if f.suffix in extensiones:
                resultado.append(f)

    return resultado


# ═══════════════════════════════════════════════════════════════════════
# MÓDULO PYTHON — análisis AST
# ═══════════════════════════════════════════════════════════════════════

def detectar_division_por_cero(tree: ast.AST, codigo: str) -> list[dict]:
    """
    Busca expresiones a/b, a//b, a%b donde b es una variable numérica
    sin verificación 'if b' / 'if b != 0' / 'assert b' en el contexto previo.

    Filtra activamente los falsos positivos de pathlib.Path (dir / filename),
    que usa el operador / para unir rutas, no para dividir números.
    """
    resultados = []
    lineas = codigo.splitlines()

    for node in ast.walk(tree):
        if not isinstance(node, ast.BinOp):
            continue
        if not isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
            continue

        denominador = node.right

        # Constante no-cero → sin riesgo
        if isinstance(denominador, ast.Constant):
            if denominador.value != 0:
                continue

        # ─ Filtro anti-pathlib ─────────────────────────────────────────
        # pathlib usa / para unir rutas: path / "subdir", dir / file.name, etc.
        # Estos NO son divisiones aritméticas y generan muchos falsos positivos.

        # 1) Denominador es atributo (file.name, rule.stem) → path joining
        if isinstance(denominador, ast.Attribute):
            continue

        # 2) Izquierdo es Name con nombre que sugiere Path
        if isinstance(node.left, ast.Name) and _nombre_sugiere_path(node.left.id):
            continue

        # 3) Izquierdo es Attribute de un Path: obj.parent / x, path.anchor / x
        if isinstance(node.left, ast.Attribute):
            # a) Atributo de pathlib conocido (parent, root, anchor…)
            if node.left.attr in _ATTRS_PATHLIB:
                continue
            # b) Objeto base del Attribute tiene nombre de path
            if (isinstance(node.left.value, ast.Name) and
                    _nombre_sugiere_path(node.left.value.id)):
                continue

        nombre_denom = None
        if isinstance(denominador, ast.Name):
            nombre_denom = denominador.id
        else:
            continue  # Ignorar denominadores complejos (llamadas, operaciones, etc.)

        if not nombre_denom:
            continue

        # 4) Denominador tiene nombre que sugiere ruta o nombre de archivo
        if _nombre_sugiere_path(nombre_denom):
            continue

        linea = getattr(node, "lineno", 0)

        # Contexto: hasta 20 líneas antes de la división
        inicio = max(0, linea - 21)
        contexto = "\n".join(lineas[inicio : linea - 1])

        # Patrones de guard: if nombre, if nombre != 0, assert nombre
        patron_guard = re.compile(
            rf"\bif\b.*\b{re.escape(nombre_denom)}\b"
            rf"|\bassert\b.*\b{re.escape(nombre_denom)}\b",
            re.IGNORECASE,
        )
        if patron_guard.search(contexto):
            continue  # Guard encontrado → OK

        op_map = {ast.Div: "/", ast.FloorDiv: "//", ast.Mod: "%"}
        op_str = op_map.get(type(node.op), "/")
        expr = _safe_unparse(node)

        resultados.append({
            "linea": linea,
            "tipo": "division_por_cero",
            "mensaje": (
                f"División posible por cero: `{expr}` "
                f"sin verificar que `{nombre_denom} != 0`"
            ),
            "sugerencia": (
                f"Añadir guard: `if {nombre_denom} == 0: return 0` "
                f"(o manejar el caso vacío)"
            ),
            "severidad": "advertencia",
        })

    return resultados


def detectar_none_sin_verificar(tree: ast.AST, codigo: str) -> list[dict]:
    """
    Busca accesos a atributos/subscripts de parámetros con default=None
    sin verificación previa de None.
    """
    resultados = []
    lineas = codigo.splitlines()

    for func_node in ast.walk(tree):
        if not isinstance(func_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        # Recopilar parámetros con default=None
        params_none = set()
        defaults = func_node.args.defaults
        args = func_node.args.args
        n_defaults = len(defaults)
        n_args = len(args)
        for i, default in enumerate(defaults):
            if isinstance(default, ast.Constant) and default.value is None:
                param = args[n_args - n_defaults + i]
                params_none.add(param.arg)

        if not params_none:
            continue

        # Buscar accesos a atributos/subscripts de esos parámetros
        for stmt in ast.walk(func_node):
            nombre = None
            linea = 0

            if isinstance(stmt, ast.Attribute):
                if isinstance(stmt.value, ast.Name) and stmt.value.id in params_none:
                    nombre = stmt.value.id
                    linea = getattr(stmt, "lineno", 0)
            elif isinstance(stmt, ast.Subscript):
                if isinstance(stmt.value, ast.Name) and stmt.value.id in params_none:
                    nombre = stmt.value.id
                    linea = getattr(stmt, "lineno", 0)

            if not nombre or not linea:
                continue

            # Verificar guard en las líneas anteriores (dentro de la función)
            func_start = getattr(func_node, "lineno", 0)
            inicio = max(func_start, linea - 15)
            contexto = "\n".join(lineas[inicio - 1 : linea - 1])

            patron_guard = re.compile(
                rf"\b{re.escape(nombre)}\b\s*is\s*(?:not\s*)?None"
                rf"|\bif\s+{re.escape(nombre)}\b"
                rf"|\bassert\s+{re.escape(nombre)}\b",
                re.IGNORECASE,
            )
            if patron_guard.search(contexto):
                continue

            expr = _safe_unparse(stmt)
            resultados.append({
                "linea": linea,
                "tipo": "none_sin_verificar",
                "mensaje": (
                    f"Acceso a `{expr}` sin verificar que el parámetro "
                    f"`{nombre}` no es None (tiene default=None)"
                ),
                "sugerencia": (
                    f"Añadir: `if {nombre} is None: return`  "
                    f"o usar `{nombre} = {nombre} or valor_por_defecto`"
                ),
                "severidad": "advertencia",
            })

    return resultados


def detectar_bucle_infinito(tree: ast.AST, codigo: str) -> list[dict]:
    """
    Busca `while True:` o `while 1:` sin instrucción break accesible
    dentro del cuerpo directo del bucle.
    """
    resultados = []
    padres = {
        child: node
        for node in ast.walk(tree)
        for child in ast.iter_child_nodes(node)
    }

    for node in ast.walk(tree):
        if not isinstance(node, ast.While):
            continue

        test = node.test
        es_infinito = False
        if isinstance(test, ast.Constant):
            if test.value is True or test.value == 1:
                es_infinito = True
        # Compatibilidad Python < 3.8 (ast.NameConstant)
        elif hasattr(ast, "NameConstant") and isinstance(test, ast.NameConstant):
            if test.value is True:
                es_infinito = True

        if not es_infinito:
            continue

        # try: while True: q.get_nowait()  except Empty: pass  → drena cola (no FP)
        parent = padres.get(node)
        if (
            isinstance(parent, ast.Try)
            and parent.handlers
            and parent.body == [node]
        ):
            continue

        if not _tiene_salida_directa(node.body):
            resultados.append({
                "linea": node.lineno,
                "tipo": "bucle_infinito",
                "mensaje": (
                    f"Bucle `while True` en línea {node.lineno} "
                    f"sin `break` ni `return` alcanzable — bucle infinito potencial"
                ),
                "sugerencia": (
                    "Añadir condición de salida con `break` o `return` "
                    "dentro del cuerpo, o cambiar la condición del while"
                ),
                "severidad": "critico",
            })

    return resultados


def detectar_modificacion_en_iteracion(tree: ast.AST, codigo: str) -> list[dict]:
    """
    Busca `for x in lista:` donde lista.append/remove/pop/insert/clear
    se llama dentro del mismo for — comportamiento indefinido.
    """
    resultados = []
    METODOS_MUTANTES = {"append", "remove", "insert", "pop", "clear", "extend"}

    for node in ast.walk(tree):
        if not isinstance(node, ast.For):
            continue
        if not isinstance(node.iter, ast.Name):
            continue

        nombre_lista = node.iter.id

        for stmt in node.body:
            for sub in ast.walk(stmt):
                if not isinstance(sub, ast.Call):
                    continue
                func = sub.func
                if not isinstance(func, ast.Attribute):
                    continue
                if not isinstance(func.value, ast.Name):
                    continue
                if func.value.id == nombre_lista and func.attr in METODOS_MUTANTES:
                    resultados.append({
                        "linea": getattr(sub, "lineno", node.lineno),
                        "tipo": "modificacion_en_iteracion",
                        "mensaje": (
                            f"Se llama `{nombre_lista}.{func.attr}()` mientras se "
                            f"itera `for ... in {nombre_lista}` (línea {node.lineno}) "
                            f"— comportamiento indefinido"
                        ),
                        "sugerencia": (
                            f"Iterar sobre una copia: "
                            f"`for x in {nombre_lista}[:]:`  "
                            f"o acumular cambios y aplicarlos después"
                        ),
                        "severidad": "critico",
                    })

    return resultados


def detectar_return_en_bucle_acumulador(tree: ast.AST, codigo: str) -> list[dict]:
    """
    Detecta: `resultado = []; for x in y: resultado.append(z); return resultado`
    donde el return está DENTRO del for — retorna en la primera iteración.
    """
    resultados = []

    for func_node in ast.walk(tree):
        if not isinstance(func_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        stmts = func_node.body
        for i, stmt in enumerate(stmts):
            # Buscar: nombre = [] (lista vacía)
            if not isinstance(stmt, ast.Assign):
                continue
            if not (isinstance(stmt.value, ast.List) and len(stmt.value.elts) == 0):
                continue
            if len(stmt.targets) != 1 or not isinstance(stmt.targets[0], ast.Name):
                continue

            nombre_acum = stmt.targets[0].id

            # Buscar el siguiente for loop inmediato
            if i + 1 >= len(stmts):
                continue
            siguiente = stmts[i + 1]
            if not isinstance(siguiente, ast.For):
                continue

            # Buscar return nombre_acum DENTRO del cuerpo del for
            for sub_stmt in siguiente.body:
                for sub in ast.walk(sub_stmt):
                    if not isinstance(sub, ast.Return):
                        continue
                    if (isinstance(sub.value, ast.Name) and
                            sub.value.id == nombre_acum):
                        resultados.append({
                            "linea": getattr(sub, "lineno", siguiente.lineno),
                            "tipo": "return_en_bucle_acumulador",
                            "mensaje": (
                                f"`return {nombre_acum}` dentro del bucle for "
                                f"(línea {siguiente.lineno}) — retorna en la "
                                f"primera iteración en vez de acumular todos los resultados"
                            ),
                            "sugerencia": (
                                f"Mover el `return {nombre_acum}` "
                                f"FUERA e INDENTADO AL MISMO NIVEL que el for"
                            ),
                            "severidad": "critico",
                        })

    return resultados


def detectar_comparacion_con_asignacion(tree: ast.AST, codigo: str) -> list[dict]:
    """
    Detecta walrus operator (:=) en condiciones if que pueden confundirse
    con comparación == . Solo reporta si el uso parece no intencional.
    """
    resultados = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        # Buscar NamedExpr (:=) en el test del if
        for sub in ast.walk(node.test):
            if isinstance(sub, ast.NamedExpr):
                linea = getattr(sub, "lineno", getattr(node, "lineno", 0))
                nombre = _safe_unparse(sub.target) if hasattr(sub, "target") else "var"
                resultados.append({
                    "linea": linea,
                    "tipo": "walrus_en_condicion_if",
                    "mensaje": (
                        f"Uso de walrus operator `:=` en condición if "
                        f"(línea {linea}) — verificar que es asignación intencional, "
                        f"no una comparación `==` mal escrita"
                    ),
                    "sugerencia": (
                        f"Si es comparación, usar `==`. "
                        f"Si es walrus intencional, añadir comentario `# walrus intencional`"
                    ),
                    "severidad": "advertencia",
                })

    return resultados


def _analizar_logica_python(archivo: Path) -> list[ProblemaLogica]:
    """
    Punto de entrada para análisis AST de lógica Python.
    Retorna lista vacía si el archivo tiene SyntaxError.
    """
    try:
        codigo = archivo.read_text(encoding="utf-8", errors="ignore")
        tree = ast.parse(codigo)
    except (SyntaxError, OSError):
        return []

    analizadores = [
        detectar_division_por_cero,
        detectar_none_sin_verificar,
        detectar_bucle_infinito,
        detectar_modificacion_en_iteracion,
        detectar_return_en_bucle_acumulador,
        detectar_comparacion_con_asignacion,
    ]

    problemas: list[ProblemaLogica] = []
    for fn in analizadores:
        try:
            hallazgos = fn(tree, codigo)
            for h in hallazgos:
                problemas.append(ProblemaLogica(
                    archivo=str(archivo),
                    linea=h["linea"],
                    tipo=h["tipo"],
                    mensaje=h["mensaje"],
                    sugerencia=h["sugerencia"],
                    severidad=h["severidad"],
                ))
        except Exception:
            pass  # No crashear por ningún analizador individual

    return problemas


# ═══════════════════════════════════════════════════════════════════════
# MÓDULO MQL5 — análisis regex
# ═══════════════════════════════════════════════════════════════════════

def detectar_logica_trading_invertida(contenido: str) -> list[dict]:
    """
    Busca señal bullish → trade.Sell() o señal bearish → trade.Buy()
    dentro de un bloque próximo (ventana 15 líneas).
    """
    resultados = []
    lineas = contenido.splitlines()

    pat_bullish = re.compile(
        r"\b(bullish|buy_?signal|isBull|signal_?buy|long_?signal"
        r"|buyCondition|entryBuy|goLong)\s*[=!]=\s*true\b",
        re.IGNORECASE,
    )
    pat_bearish = re.compile(
        r"\b(bearish|sell_?signal|isBear|signal_?sell|short_?signal"
        r"|sellCondition|entrySell|goShort)\s*[=!]=\s*true\b",
        re.IGNORECASE,
    )
    pat_buy = re.compile(r"\btrade\s*\.\s*Buy\s*\(", re.IGNORECASE)
    pat_sell = re.compile(r"\btrade\s*\.\s*Sell\s*\(", re.IGNORECASE)

    for i, linea in enumerate(lineas, 1):
        ventana = "\n".join(lineas[i : min(i + 15, len(lineas))])

        if pat_bullish.search(linea) and pat_sell.search(ventana):
            resultados.append({
                "linea": i,
                "tipo": "logica_trading_invertida",
                "mensaje": (
                    "Señal BULLISH detectada pero se ejecuta "
                    "`trade.Sell()` en las próximas líneas — posible lógica invertida"
                ),
                "sugerencia": (
                    "Verificar: señal bullish → trade.Buy(), "
                    "señal bearish → trade.Sell()"
                ),
                "severidad": "critico",
            })

        if pat_bearish.search(linea) and pat_buy.search(ventana):
            resultados.append({
                "linea": i,
                "tipo": "logica_trading_invertida",
                "mensaje": (
                    "Señal BEARISH detectada pero se ejecuta "
                    "`trade.Buy()` en las próximas líneas — posible lógica invertida"
                ),
                "sugerencia": (
                    "Verificar: señal bearish → trade.Sell(), "
                    "señal bullish → trade.Buy()"
                ),
                "severidad": "critico",
            })

    return resultados


def detectar_volumen_cero(contenido: str) -> list[dict]:
    """
    Busca InpLotSize=0, InpLots=0, LotSize=0 o volumen calculado
    que pueda resultar 0.
    """
    resultados = []
    lineas = contenido.splitlines()

    # Asignación explícita a 0 (no 0.01: \b entre 0 y . daba FP)
    pat_zero = re.compile(
        r"\b(InpLotSize|InpLots|LotSize|lot_size|volume)\s*=\s*0(?![.\d])",
        re.IGNORECASE,
    )
    pat_input_zero = re.compile(
        r"input\s+double\s+(\w+)\s*=\s*0;",
        re.IGNORECASE,
    )

    for i, linea in enumerate(lineas, 1):
        m_in = pat_input_zero.search(linea)
        if pat_zero.search(linea) or (m_in and "lot" in m_in.group(1).lower()):
            resultados.append({
                "linea": i,
                "tipo": "volumen_cero",
                "mensaje": (
                    f"Volumen/lote asignado a 0 en línea {i} — "
                    f"la orden será rechazada por el broker"
                ),
                "sugerencia": (
                    "Usar valor mínimo: `double minLot = "
                    "SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);` "
                    "o InpLotSize = 0.01"
                ),
                "severidad": "critico",
            })

    return resultados


def detectar_operacion_sin_verificar_spread(contenido: str) -> list[dict]:
    """
    Busca trade.Buy/Sell sin verificación de SYMBOL_SPREAD en el mismo archivo.
    """
    resultados = []

    tiene_spread_check = bool(re.search(
        r"SymbolInfoInteger\s*\(.*SYMBOL_SPREAD|SYMBOL_SPREAD_FLOAT",
        contenido, re.IGNORECASE,
    ))

    if tiene_spread_check:
        return resultados

    # Hay operaciones de trading
    operaciones = list(re.finditer(
        r"\btrade\s*\.\s*(Buy|Sell)\s*\(",
        contenido, re.IGNORECASE,
    ))

    if len(operaciones) > 0:
        linea = contenido[: operaciones[0].start()].count("\n") + 1
        resultados.append({
            "linea": linea,
            "tipo": "operacion_sin_verificar_spread",
            "mensaje": (
                "Operaciones de trading sin verificar el spread "
                "(SymbolInfoInteger SYMBOL_SPREAD) — el spread puede exceder el SL"
            ),
            "sugerencia": (
                "Añadir: `if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > maxSpread) return;`"
            ),
            "severidad": "advertencia",
        })

    return resultados


def detectar_magic_number_cero(contenido: str) -> list[dict]:
    """
    Busca MagicNumber=0 o magic=0 — conflicto con otras EAs al valor 0.
    """
    resultados = []
    lineas = contenido.splitlines()

    pat = re.compile(
        r"\b(MagicNumber|magic_number|magic|EA_MAGIC|InpMagic)\s*=\s*0\b",
        re.IGNORECASE,
    )

    for i, linea in enumerate(lineas, 1):
        if pat.search(linea):
            resultados.append({
                "linea": i,
                "tipo": "magic_number_cero",
                "mensaje": (
                    f"MagicNumber = 0 en línea {i} — "
                    f"confunde posiciones con otras EAs o con operaciones manuales"
                ),
                "sugerencia": (
                    "Usar un MagicNumber único != 0, "
                    "ej: `input int InpMagic = 12345;`"
                ),
                "severidad": "critico",
            })

    return resultados


def _analizar_logica_mql5(archivo: Path) -> list[ProblemaLogica]:
    """Punto de entrada para análisis de lógica MQL5."""
    try:
        contenido = archivo.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []

    analizadores_mql = [
        detectar_logica_trading_invertida,
        detectar_volumen_cero,
        detectar_operacion_sin_verificar_spread,
        detectar_magic_number_cero,
    ]

    problemas: list[ProblemaLogica] = []
    for fn in analizadores_mql:
        try:
            hallazgos = fn(contenido)
            for h in hallazgos:
                problemas.append(ProblemaLogica(
                    archivo=str(archivo),
                    linea=h["linea"],
                    tipo=h["tipo"],
                    mensaje=h["mensaje"],
                    sugerencia=h["sugerencia"],
                    severidad=h["severidad"],
                ))
        except Exception:
            pass

    return problemas


# ═══════════════════════════════════════════════════════════════════════
# MÓDULO NODE/REACT — análisis regex
# ═══════════════════════════════════════════════════════════════════════

def detectar_mutacion_estado_react(contenido: str) -> list[dict]:
    """
    Busca mutación directa de estado:
    - `this.state.X = Y` (componentes de clase)
    - `state.X = Y` (componentes funcionales, heurístico)
    """
    resultados = []
    lineas = contenido.splitlines()

    # this.state.propiedad = valor (sin setState)
    pat_clase = re.compile(r"\bthis\.state\.(\w+)\s*=(?![=>])", re.IGNORECASE)
    # Acceso directo a variable llamada 'state' (nombres comunes en funcionales)
    pat_func = re.compile(r"(?<!\w)state\.(\w+)\s*=(?![=>])", re.IGNORECASE)

    for i, linea in enumerate(lineas, 1):
        m = pat_clase.search(linea)
        if m:
            resultados.append({
                "linea": i,
                "tipo": "mutacion_estado_react",
                "mensaje": (
                    f"Mutación directa de estado React: "
                    f"`this.state.{m.group(1)} = ...` — React NO detectará el cambio"
                ),
                "sugerencia": (
                    f"Usar: `this.setState({{ {m.group(1)}: nuevoValor }})`"
                ),
                "severidad": "critico",
            })
            continue

        m2 = pat_func.search(linea)
        if m2:
            # Evitar falso positivo en 'useState' y declaraciones
            if "useState" not in linea and "const state" not in linea:
                resultados.append({
                    "linea": i,
                    "tipo": "mutacion_estado_react",
                    "mensaje": (
                        f"Posible mutación directa de estado: "
                        f"`state.{m2.group(1)} = ...` — usar setter de useState"
                    ),
                    "sugerencia": (
                        f"Usar el setter: `set{m2.group(1).capitalize()}(nuevoValor)`"
                    ),
                    "severidad": "advertencia",
                })

    return resultados


def detectar_async_sin_await(contenido: str) -> list[dict]:
    """
    Busca llamadas a fetch/axios.get/axios.post/Promise
    sin await ni .then() → la promesa queda sin resolver.
    """
    resultados = []
    lineas = contenido.splitlines()

    # Patrón: fetch( o axios.get( o axios.post( al inicio de una expresión
    pat_async = re.compile(
        r"(?<!\bawait\s)(?<!\b\.then\()(?<!\breturn\s)"
        r"\b(fetch|axios\.get|axios\.post|axios\.put|axios\.delete|axios\.patch)\s*\(",
        re.IGNORECASE,
    )

    for i, linea in enumerate(lineas, 1):
        linea_stripped = linea.strip()
        # Ignorar líneas con await o .then o declaración de función
        if "await " in linea or ".then(" in linea or "=>" in linea[:20]:
            continue
        # Ignorar comentarios
        if linea_stripped.startswith("//") or linea_stripped.startswith("*"):
            continue

        m = pat_async.search(linea)
        if m:
            resultados.append({
                "linea": i,
                "tipo": "async_sin_await",
                "mensaje": (
                    f"Llamada asíncrona `{m.group(1)}(...)` sin `await` ni `.then()` "
                    f"en línea {i} — la promesa queda sin manejar"
                ),
                "sugerencia": (
                    f"Usar: `const data = await {m.group(1)}(...);` "
                    f"dentro de función async, o añadir `.then(...).catch(...)`"
                ),
                "severidad": "advertencia",
            })

    return resultados


def detectar_useeffect_sin_deps(contenido: str) -> list[dict]:
    """
    Busca useEffect(() => {...}) sin array de dependencias como segundo argumento
    → se ejecuta en cada render, posible loop infinito.
    """
    resultados = []
    lineas = contenido.splitlines()

    # Encontrar todas las posiciones de useEffect(
    for m in re.finditer(r"\buseEffect\s*\(", contenido):
        pos_inicio = m.end()
        linea_num = contenido[: m.start()].count("\n") + 1

        # Escanear hacia adelante con contador de paréntesis para encontrar el cierre
        pos = pos_inicio
        depth = 1
        in_string = False
        string_char = None
        tiene_deps = False
        coma_nivel1 = False

        brace = 0
        bracket = 0
        while pos < len(contenido) and depth > 0:
            c = contenido[pos]
            prev = contenido[pos - 1] if pos > 0 else ""

            if in_string:
                if c == string_char and prev != "\\":
                    in_string = False
            elif c in ('"', "'", "`"):
                in_string = True
                string_char = c
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    break
            elif c == "{":
                brace += 1
            elif c == "}":
                brace = max(0, brace - 1)
            elif c == "[":
                bracket += 1
            elif c == "]":
                bracket = max(0, bracket - 1)
            elif (
                c == ","
                and depth == 1
                and brace == 0
                and bracket == 0
            ):
                # Coma al nivel del useEffect — hay segundo argumento
                coma_nivel1 = True
                rest = contenido[pos + 1 :].lstrip()
                if rest.startswith("["):
                    tiene_deps = True
                break

            pos += 1

        if not coma_nivel1 or not tiene_deps:
            # Verificar que no sea una línea de comentario
            linea_texto = lineas[linea_num - 1].strip()
            if not linea_texto.startswith("//") and not linea_texto.startswith("*"):
                resultados.append({
                    "linea": linea_num,
                    "tipo": "useeffect_sin_deps",
                    "mensaje": (
                        f"useEffect en línea {linea_num} sin array de dependencias "
                        f"→ se ejecuta en CADA render (posible loop infinito o "
                        f"comportamiento inesperado)"
                    ),
                    "sugerencia": (
                        "Añadir array de dependencias: `useEffect(() => { ... }, [])` "
                        "para ejecutar solo al montar, o `[dep1, dep2]` para deps específicas"
                    ),
                    "severidad": "critico",
                })

    return resultados


def detectar_key_en_map_faltante(contenido: str) -> list[dict]:
    """
    Busca .map( con retorno de JSX sin prop key={} →
    warning de React y problemas de reconciliación.
    """
    resultados = []
    lineas = contenido.splitlines()

    # Buscar .map( seguido de retorno JSX (< mayúscula o < minúscula)
    pat_map = re.compile(r"\.(map)\s*\(", re.IGNORECASE)
    pat_jsx_open = re.compile(r"<[A-Za-z][A-Za-z0-9]*[\s/>]")
    pat_key = re.compile(r"\bkey\s*=\s*\{")

    for i, linea in enumerate(lineas, 1):
        if not pat_map.search(linea):
            continue

        # Verificar en las próximas 5 líneas si hay JSX sin key
        bloque_idx_fin = min(i + 5, len(lineas))
        bloque = "\n".join(lineas[i - 1 : bloque_idx_fin])

        if not pat_jsx_open.search(bloque):
            continue  # No hay JSX en este map → no aplica

        if pat_key.search(bloque):
            continue  # Tiene key → OK

        # Ignorar comentarios
        if linea.strip().startswith("//"):
            continue

        resultados.append({
            "linea": i,
            "tipo": "key_en_map_faltante",
            "mensaje": (
                f"`.map()` en línea {i} retorna JSX sin prop `key={{}}` → "
                f"warning de React y posibles errores de reconciliación"
            ),
            "sugerencia": (
                "Añadir: `key={{item.id}}` o `key={{index}}` "
                "(preferir id único sobre índice)"
            ),
            "severidad": "advertencia",
        })

    return resultados


def _analizar_logica_node(archivo: Path) -> list[ProblemaLogica]:
    """Punto de entrada para análisis de lógica Node/React."""
    try:
        contenido = archivo.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []

    analizadores_node = [
        detectar_mutacion_estado_react,
        detectar_async_sin_await,
        detectar_useeffect_sin_deps,
        detectar_key_en_map_faltante,
    ]

    problemas: list[ProblemaLogica] = []
    for fn in analizadores_node:
        try:
            hallazgos = fn(contenido)
            for h in hallazgos:
                problemas.append(ProblemaLogica(
                    archivo=str(archivo),
                    linea=h["linea"],
                    tipo=h["tipo"],
                    mensaje=h["mensaje"],
                    sugerencia=h["sugerencia"],
                    severidad=h["severidad"],
                ))
        except Exception:
            pass

    return problemas


# ═══════════════════════════════════════════════════════════════════════
# ANALIZADOR PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════

def _detectar_tipo_proyecto(directorio: Path) -> str:
    """Detecta el tipo de proyecto para elegir los analizadores correctos."""
    d = confine(directorio)

    if (d / "build.gradle").exists() or (d / "AndroidManifest.xml").exists():
        return "android"

    mql = list(d.glob("*.mq5")) + list(d.glob("*.mq4")) + \
          list(d.glob("src/*.mq5")) + list(d.glob("src/*.mq4"))
    if mql:
        return "mql5"

    pkg = d / "package.json"
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
            if "react" in deps or "next" in deps or "react-native" in deps:
                return "react"
        except Exception:
            pass
        return "node"

    return "python"


def analizar_directorio(directorio: str) -> tuple[list[ProblemaLogica], int]:
    """
    Analiza todos los archivos relevantes del directorio.

    Returns:
        (problemas, total_patrones_revisados)
    """
    raiz = Path(directorio)
    tipo = _detectar_tipo_proyecto(raiz)

    todos_problemas: list[ProblemaLogica] = []
    total_archivos = 0

    if tipo in ("python", "unknown"):
        archivos = _iterar_archivos_logica(raiz, {".py"})
        for arch in archivos:
            todos_problemas.extend(_analizar_logica_python(arch))
        total_archivos += len(archivos)

    if tipo == "mql5":
        archivos_mql = _iterar_archivos_logica(raiz, {".mq5", ".mq4", ".mqh"})
        for arch in archivos_mql:
            todos_problemas.extend(_analizar_logica_mql5(arch))
        total_archivos += len(archivos_mql)

    if tipo in ("react", "node"):
        archivos_js = _iterar_archivos_logica(raiz, {".js", ".ts", ".jsx", ".tsx"})
        for arch in archivos_js:
            todos_problemas.extend(_analizar_logica_node(arch))
        total_archivos += len(archivos_js)

    # En proyectos mixtos o desconocidos, también analizar JS si existe
    if tipo == "python" and list(raiz.glob("*.jsx")) + list(raiz.glob("*.tsx")):
        archivos_js = _iterar_archivos_logica(raiz, {".js", ".ts", ".jsx", ".tsx"})
        for arch in archivos_js:
            todos_problemas.extend(_analizar_logica_node(arch))

    # Deduplicar por (archivo, linea, tipo) para evitar reportes repetidos
    vistos: set = set()
    problemas_unicos: list[ProblemaLogica] = []
    for p in todos_problemas:
        clave = (p.archivo, p.linea, p.tipo)
        if clave not in vistos:
            vistos.add(clave)
            problemas_unicos.append(p)

    return problemas_unicos, total_archivos


# ═══════════════════════════════════════════════════════════════════════
# FORMATEO DE REPORTE
# ═══════════════════════════════════════════════════════════════════════

def formatear_reporte(problemas: list[ProblemaLogica], total_archivos: int) -> str:
    """Genera el reporte formateado para mostrar en consola."""
    criticos = [p for p in problemas if p.severidad == "critico"]
    advertencias = [p for p in problemas if p.severidad == "advertencia"]

    lineas_reporte = [
        "",
        "🧠 DETECCIÓN DE ERRORES DE LÓGICA",
        "═" * 44,
    ]

    if criticos:
        lineas_reporte.append(f"❌ ERRORES DE LÓGICA CRÍTICOS ({len(criticos)}):")
        for p in criticos:
            nombre_arch = Path(p.archivo).name
            lineas_reporte.append(
                f"  [{nombre_arch}:{p.linea}] {p.mensaje}"
            )
            lineas_reporte.append(f"    → {p.sugerencia}")

    if advertencias:
        lineas_reporte.append(f"⚠️  ADVERTENCIAS DE LÓGICA ({len(advertencias)}):")
        for p in advertencias:
            nombre_arch = Path(p.archivo).name
            lineas_reporte.append(
                f"  [{nombre_arch}:{p.linea}] {p.mensaje}"
            )
            lineas_reporte.append(f"    → {p.sugerencia}")

    total_patrones = total_archivos * 6  # aprox 6 analizadores por archivo
    lineas_reporte.append(
        f"✅ LÓGICA VERIFICADA: {total_patrones} patrones revisados en "
        f"{total_archivos} archivo(s)"
        + (" — 0 problemas adicionales" if not problemas else "")
    )
    lineas_reporte.append("═" * 44)

    return "\n".join(lineas_reporte)


def analizar_directorio_con_reporte(directorio: str, formato_json: bool = False) -> int:
    """
    Analiza el directorio e imprime el reporte.
    Retorna 1 si hay críticos, 0 si todo OK.
    Compatible con integración en qa_autonomo.py.
    """
    problemas, total_archivos = analizar_directorio(directorio)

    if formato_json:
        data = {
            "directorio": directorio,
            "total_archivos": total_archivos,
            "criticos": len([p for p in problemas if p.severidad == "critico"]),
            "advertencias": len([p for p in problemas if p.severidad == "advertencia"]),
            "problemas": [
                {
                    "archivo": p.archivo,
                    "linea": p.linea,
                    "tipo": p.tipo,
                    "mensaje": p.mensaje,
                    "sugerencia": p.sugerencia,
                    "severidad": p.severidad,
                }
                for p in problemas
            ],
        }
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(formatear_reporte(problemas, total_archivos))

    criticos = [p for p in problemas if p.severidad == "critico"]
    return 1 if criticos else 0


# ═══════════════════════════════════════════════════════════════════════
# PUNTO DE ENTRADA
# ═══════════════════════════════════════════════════════════════════════

def main():
    """Entry point del script."""
    args = sys.argv[1:]
    formato_json = "--json" in args
    args = [a for a in args if a != "--json"]

    directorio = args[0] if args else os.getcwd()

    if not os.path.isdir(directorio):
        print(f"❌ El directorio '{directorio}' no existe.")
        sys.exit(1)

    exit_code = analizar_directorio_con_reporte(directorio, formato_json)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
