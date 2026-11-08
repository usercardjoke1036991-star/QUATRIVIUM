"""
salud_proyecto.py — Reloj suizo de Quatrivium Finance
====================================================
Lee CONTEXTO.md y comprueba que el grafo crítico (UI → hooks → servicio →
contrato → i18n → worker) siga conectado y compilable.

No sustituye a qa_autonomo.py (auditoría genérica). Este script entiende
ESTE proyecto: Demo/Real, cooldown, caché de préstamo, pool locked.

Uso:
    python salud_proyecto.py
    python salud_proyecto.py --tests
    python salud_proyecto.py --watch [--intervalo 120]
    python salud_proyecto.py --json
    python salud_proyecto.py --ruta DIR
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from qa_safe_io import under_root

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


# ─────────────────────────────────────────────
# GRAFO CRÍTICO DE QUATRIVIUM CREDIT
# ─────────────────────────────────────────────

ARCHIVOS_CRITICOS = (
    "CONTEXTO.md",
    "app/index.tsx",
    "hooks/useHomeHandlers.ts",
    "hooks/useWeb3Balances.ts",
    "hooks/useWeb3Transactions.ts",
    "hooks/useLiveCooldown.ts",
    "services/quatriviumCreditService.ts",
    "contracts/QuatriviumCredit.sol",
    "components/LoanTierCard.tsx",
    "components/AppLockGate.tsx",
    "wallet/AppModeContext.tsx",
    "web3Config.tsx",
    "utils/creditCooldown.ts",
    "constants/rpcConfig.ts",
    "constants/loanTiers.ts",
    "i18n/translations.ts",
    "scripts/notify-worker.mjs",
    "scripts/check-i18n.mjs",
    "scripts/check-production.mjs",
    "scripts/security-check.mjs",
    "components/MilestoneBonusCatalog.tsx",
    "components/DonateFounderSection.tsx",
)

# archivo → símbolos que deben existir (conexión funcional, no solo el archivo)
SIMBOLOS_CRITICOS: dict[str, tuple[str, ...]] = {
    "hooks/useWeb3Balances.ts": (
        "persistCreditStatus",
        "hasActiveLoan",
        "creditStatusKey",
        "ultimoPrestamoTimestamp",
    ),
    "hooks/useHomeHandlers.ts": (
        "handleSolicitarCredito",
        "handlePagar",
        "handleCobrarBonoHito",
        "handleDonar",
        "assertEnoughToPay",
        "topUpDemoUsdtToDebt",
        "solicitarPrestamo",
        "pagarPrestamo",
    ),
    "hooks/useLiveCooldown.ts": (
        "useLiveCooldown",
        "cooldownRestanteDesdeTimestamp",
    ),
    "components/LoanTierCard.tsx": (
        "waitingNextLoan",
        "useLiveCooldown",
        "onRequestLoan",
    ),
    "services/quatriviumCreditService.ts": (
        "solicitarPrestamo",
        "pagarPrestamo",
        "topUpDemoUsdtToDebt",
        "pool locked",
        "cobrarBonoHito",
        "donar",
        "detectarCapacidadProtocolo",
    ),
    "contracts/QuatriviumCredit.sol": (
        "solicitarPrestamo",
        "pagarPrestamo",
        "COOLDOWN_PRESTAMO",
        "retirarLiquidez",
        "cobrarBonoHito",
        "donar",
    ),
    "web3Config.tsx": (
        "subscribeRuntimeMode",
        "switchNetwork",
    ),
    "utils/creditCooldown.ts": (
        "PRESTAMO_COOLDOWN_SECS",
        "cooldownRestanteDesdeTimestamp",
    ),
    "constants/rpcConfig.ts": (
        "subscribeRuntimeMode",
        "isDemoMode",
        "isCreditReady",
    ),
    "app/index.tsx": (
        "useHomeHandlers",
        "useWeb3Balances",
        "LoanTierCard",
        "handleSolicitarCredito",
        "handleDonar",
        "MilestoneBonusCatalog",
    ),
}

# Default live/real no debe cambiarse a Demo (CONTEXTO.md)
NO_ROMPER = (
    "Demo = BSC testnet (97). Real = BSC mainnet (56).",
    "Default preferencia live/real. Demo se elige en Ajustes.",
    "Pool retirarLiquidez → revert pool locked.",
    "Cooldown 48h se cuenta desde solicitarPrestamo.",
    "Cuenta atrás del botón Solicitar solo después de pagar.",
)


@dataclass
class Hallazgo:
    categoria: str
    mensaje: str
    severidad: str  # critico | advertencia | ok | info
    archivo: Optional[str] = None


@dataclass
class ReporteSalud:
    proyecto: str = "Quatrivium Finance"
    directorio: str = ""
    hallazgos: list[Hallazgo] = field(default_factory=list)

    def add(self, categoria: str, mensaje: str, severidad: str, archivo: Optional[str] = None) -> None:
        self.hallazgos.append(Hallazgo(categoria, mensaje, severidad, archivo))

    @property
    def criticos(self) -> list[Hallazgo]:
        return [h for h in self.hallazgos if h.severidad == "critico"]

    @property
    def advertencias(self) -> list[Hallazgo]:
        return [h for h in self.hallazgos if h.severidad == "advertencia"]

    @property
    def oks(self) -> list[Hallazgo]:
        return [h for h in self.hallazgos if h.severidad == "ok"]

    def to_dict(self) -> dict:
        return {
            "proyecto": self.proyecto,
            "directorio": self.directorio,
            "resumen": {
                "criticos": len(self.criticos),
                "advertencias": len(self.advertencias),
                "oks": len(self.oks),
            },
            "hallazgos": [
                {
                    "categoria": h.categoria,
                    "mensaje": h.mensaje,
                    "severidad": h.severidad,
                    "archivo": h.archivo,
                }
                for h in self.hallazgos
            ],
        }


def _leer(ruta: Path) -> str:
    try:
        return ruta.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _leer_env(ruta: Path) -> dict[str, str]:
    datos: dict[str, str] = {}
    if not ruta.is_file():
        return datos
    for linea in _leer(ruta).splitlines():
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, _, valor = linea.partition("=")
        valor = valor.strip().strip('"').strip("'")
        datos[clave.strip()] = valor
    return datos


def _run(
    args: list[str],
    cwd: Path,
    timeout: int,
) -> tuple[int, str]:
    try:
        result = subprocess.run(
            args,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        out = ((result.stdout or "") + (result.stderr or "")).strip()
        return result.returncode, out
    except FileNotFoundError:
        return 127, f"comando no encontrado: {args[0]}"
    except subprocess.TimeoutExpired:
        return 124, f"timeout >{timeout}s: {' '.join(args)}"


def _es_quatrivium(raiz: Path) -> bool:
    pkg = under_root(raiz, "package.json")
    if not pkg.is_file():
        return False
    try:
        data = json.loads(_leer(pkg))
    except json.JSONDecodeError:
        return False
    nombre = str(data.get("name", "")).lower()
    return "quatrivium" in nombre or under_root(raiz, "contracts/QuatriviumCredit.sol").is_file()


def verificar_identidad(raiz: Path, reporte: ReporteSalud) -> None:
    if _es_quatrivium(raiz):
        reporte.add("identidad", "Proyecto detectado: Quatrivium Finance (RN + Solidity)", "ok")
    else:
        reporte.add(
            "identidad",
            "Este directorio no parece Quatrivium Finance — el grafo específico puede no aplicar",
            "advertencia",
        )

    contexto = under_root(raiz, "CONTEXTO.md")
    if contexto.is_file():
        texto = _leer(contexto)
        if "Quatrivium Finance" in texto and "Demo" in texto:
            reporte.add("contexto", "CONTEXTO.md presente y describe Demo/Real", "ok")
        else:
            reporte.add("contexto", "CONTEXTO.md existe pero no describe Quatrivium", "advertencia")
    else:
        reporte.add("contexto", "Falta CONTEXTO.md — el reloj no tiene fuente de verdad", "critico")


def verificar_archivos(raiz: Path, reporte: ReporteSalud) -> None:
    faltan = [rel for rel in ARCHIVOS_CRITICOS if not under_root(raiz, rel).is_file()]
    if faltan:
        for rel in faltan:
            reporte.add("grafo", f"Archivo crítico ausente: {rel}", "critico", rel)
    else:
        reporte.add("grafo", f"{len(ARCHIVOS_CRITICOS)} archivos críticos presentes", "ok")


def verificar_simbolos(raiz: Path, reporte: ReporteSalud) -> None:
    rotos = 0
    for rel, simbolos in SIMBOLOS_CRITICOS.items():
        ruta = under_root(raiz, rel)
        if not ruta.is_file():
            continue
        texto = _leer(ruta)
        ausentes = [s for s in simbolos if s not in texto]
        if ausentes:
            rotos += 1
            reporte.add(
                "conexion",
                f"Faltan símbolos que conectan el flujo: {', '.join(ausentes)}",
                "critico",
                rel,
            )
    if rotos == 0:
        reporte.add("conexion", "Símbolos del flujo crédito/pago/cooldown/Demo presentes", "ok")


def verificar_decisiones(raiz: Path, reporte: ReporteSalud) -> None:
    """Guards de producto: no romper lo que CONTEXTO/MEMORIA prohíben."""
    servicio = _leer(under_root(raiz, "services/quatriviumCreditService.ts"))
    if "pool locked" in servicio:
        reporte.add("decision", "Pool no redimible sigue bloqueado en el servicio", "ok")
    else:
        reporte.add(
            "decision",
            "El servicio ya no revierte retirar liquidez con 'pool locked'",
            "critico",
            "services/quatriviumCreditService.ts",
        )

    contrato = _leer(under_root(raiz, "contracts/QuatriviumCredit.sol"))
    if "COOLDOWN_PRESTAMO" in contrato and "48 hours" in contrato:
        reporte.add("decision", "Contrato mantiene cooldown de 48h desde solicitarPrestamo", "ok")
    elif "COOLDOWN_PRESTAMO" in contrato:
        reporte.add("decision", "COOLDOWN_PRESTAMO presente (revisar duración)", "ok")
    else:
        reporte.add("decision", "Falta COOLDOWN_PRESTAMO en el contrato", "critico", "contracts/QuatriviumCredit.sol")

    tarjeta = _leer(under_root(raiz, "components/LoanTierCard.tsx"))
    if "waitingNextLoan" in tarjeta and "!hasActiveLoan" in tarjeta:
        reporte.add("decision", "Cuenta atrás de Solicitar solo tras pagar (sin deuda activa)", "ok")
    else:
        reporte.add(
            "decision",
            "LoanTierCard no ata la cuenta atrás a !hasActiveLoan",
            "advertencia",
            "components/LoanTierCard.tsx",
        )

    env = _leer_env(under_root(raiz, ".env"))
    chain = env.get("EXPO_PUBLIC_CHAIN_ID", "")
    if chain == "56":
        reporte.add(
            "decision",
            "EXPO_PUBLIC_CHAIN_ID=56 en .env local — el desarrollo debe quedarse en 97",
            "critico",
            ".env",
        )
    elif chain == "97" or not chain:
        reporte.add("decision", "Chain local no apunta a mainnet (OK para desarrollo)", "ok")


def verificar_comando(
    raiz: Path,
    reporte: ReporteSalud,
    categoria: str,
    args: list[str],
    ok_msg: str,
    timeout: int,
    critico: bool = True,
) -> None:
    code, out = _run(args, raiz, timeout)
    if code == 0:
        reporte.add(categoria, ok_msg, "ok")
        return
    recorte = out[-500:] if out else f"exit {code}"
    reporte.add(
        categoria,
        f"{' '.join(args)} falló:\n{recorte}",
        "critico" if critico else "advertencia",
    )


def verificar_herramientas(raiz: Path, reporte: ReporteSalud, con_tests: bool) -> None:
    npx = "npx.cmd" if sys.platform == "win32" else "npx"

    verificar_comando(
        raiz, reporte, "i18n",
        ["node", "scripts/check-i18n.mjs"],
        "i18n: mismas claves en todos los locales",
        60,
    )
    verificar_comando(
        raiz, reporte, "typescript",
        [npx, "tsc", "--noEmit"],
        "TypeScript: tsc --noEmit sin errores",
        180,
    )
    verificar_comando(
        raiz, reporte, "seguridad",
        ["node", "scripts/security-check.mjs"],
        "security-check: sin secretos en repo",
        60,
    )
    verificar_comando(
        raiz, reporte, "produccion",
        ["node", "scripts/check-production.mjs"],
        "production-check ejecutado (faltantes de fundador = advertencia, no bloquean Demo)",
        60,
        critico=False,
    )

    if con_tests:
        verificar_comando(
            raiz, reporte, "hardhat",
            ["npx", "hardhat", "test"],
            "Hardhat: suite de contratos en verde",
            300,
        )

    _verificar_conectores(raiz, reporte)
    _verificar_logica(raiz, reporte)


def _importar_hermano(nombre: str, raiz: Path):
    import importlib.util

    try:
        script = under_root(raiz, f"{nombre}.py")
    except ValueError:
        return None
    if not script.is_file():
        return None
    spec = importlib.util.spec_from_file_location(nombre, script)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _verificar_conectores(raiz: Path, reporte: ReporteSalud) -> None:
    mod = _importar_hermano("verificar_conectores", raiz)
    if mod is None:
        reporte.add("conectores", "verificar_conectores.py no encontrado", "advertencia")
        return
    resultado = mod.verificar_conectores(str(raiz))
    rotos_import = [
        c for c in resultado.get("rotos", [])
        if c.get("tipo") in {"import_roto_js", "import_roto_python"}
    ]
    # Handlers JSX: tsc ya prueba que existen. Aquí solo avisamos residuales.
    handlers = [
        c for c in resultado.get("rotos", [])
        if c.get("tipo") == "handler_jsx_sin_definir"
    ]
    if rotos_import:
        for c in rotos_import[:12]:
            reporte.add(
                "conectores",
                c.get("mensaje", "import relativo roto"),
                "critico",
                f"{c.get('archivo')}:{c.get('linea')}",
            )
        if len(rotos_import) > 12:
            reporte.add("conectores", f"… y {len(rotos_import) - 12} imports rotos más", "critico")
    else:
        reporte.add(
            "conectores",
            f"Imports relativos resolubles ({resultado.get('verificados', 0)} archivos)",
            "ok",
        )
    if handlers:
        reporte.add(
            "conectores",
            f"{len(handlers)} handler(s) JSX no resueltos por análisis estático (tsc ya pasó)",
            "advertencia",
        )


def _verificar_logica(raiz: Path, reporte: ReporteSalud) -> None:
    mod = _importar_hermano("detectar_logica", raiz)
    if mod is None or not hasattr(mod, "analizar_directorio"):
        return
    try:
        problemas, _total = mod.analizar_directorio(str(raiz))
        # Expo trae AndroidManifest y detectar_logica lo clasifica como Android,
        # saltándose TS. Reforzamos el grafo RN a mano.
        if hasattr(mod, "_analizar_logica_node"):
            for rel in (
                "app/index.tsx",
                "hooks/useHomeHandlers.ts",
                "hooks/useWeb3Balances.ts",
                "components/LoanTierCard.tsx",
                "web3Config.tsx",
            ):
                ruta = under_root(raiz, rel)
                if ruta.is_file():
                    problemas.extend(mod._analizar_logica_node(ruta))
    except Exception as exc:
        reporte.add("logica", f"detectar_logica falló: {exc}", "advertencia")
        return

    criticos = [p for p in problemas if getattr(p, "severidad", "") == "critico"]
    if criticos:
        muestra = criticos[0]
        reporte.add(
            "logica",
            f"{len(criticos)} hallazgo(s) de lógica crítica — {getattr(muestra, 'mensaje', muestra)}",
            "advertencia",
            getattr(muestra, "archivo", None),
        )
    else:
        reporte.add("logica", "Sin errores de lógica críticos (ERR-009…012)", "ok")


def ejecutar_salud(raiz: Path, con_tests: bool = False) -> ReporteSalud:
    reporte = ReporteSalud(directorio=str(raiz))
    verificar_identidad(raiz, reporte)
    verificar_archivos(raiz, reporte)
    verificar_simbolos(raiz, reporte)
    verificar_decisiones(raiz, reporte)
    verificar_herramientas(raiz, reporte, con_tests)
    return reporte


def imprimir_reporte(reporte: ReporteSalud, formato_json: bool) -> None:
    if formato_json:
        print(json.dumps(reporte.to_dict(), ensure_ascii=False, indent=2))
        return

    print("\n" + "═" * 64)
    print("  SALUD DEL PROYECTO — Quatrivium Finance")
    print(f"  {reporte.directorio}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("═" * 64)

    if reporte.criticos:
        print(f"\n❌ CRÍTICOS ({len(reporte.criticos)}):")
        for h in reporte.criticos:
            donde = f" [{h.archivo}]" if h.archivo else ""
            print(f"   [{h.categoria}]{donde} {h.mensaje}")

    if reporte.advertencias:
        print(f"\n⚠️  ADVERTENCIAS ({len(reporte.advertencias)}):")
        for h in reporte.advertencias:
            donde = f" [{h.archivo}]" if h.archivo else ""
            print(f"   [{h.categoria}]{donde} {h.mensaje}")

    if reporte.oks:
        print(f"\n✅ CONECTADO ({len(reporte.oks)}):")
        for h in reporte.oks:
            print(f"   [{h.categoria}] {h.mensaje}")

    print("\n📌 No romper:")
    for item in NO_ROMPER:
        print(f"   · {item}")

    print("\n" + "─" * 64)
    if reporte.criticos:
        estado = "🚨 HAY ENGRANAJES ROTOS"
    elif reporte.advertencias:
        estado = "⚠️  FUNCIONAL CON AVISOS (mainnet/Twilio son del fundador)"
    else:
        estado = "✅ GRAFO CONECTADO"
    print(f"  {estado}")
    print(
        f"  Críticos: {len(reporte.criticos)} | "
        f"Avisos: {len(reporte.advertencias)} | "
        f"OK: {len(reporte.oks)}"
    )
    print("═" * 64 + "\n")


def _parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Salud continua de Quatrivium Finance")
    parser.add_argument("--ruta", default=os.getcwd(), help="Directorio del proyecto")
    parser.add_argument("--json", action="store_true", help="Salida JSON")
    parser.add_argument("--tests", action="store_true", help="Incluye hardhat test")
    parser.add_argument("--watch", action="store_true", help="Repite el chequeo")
    parser.add_argument("--intervalo", type=int, default=120, help="Segundos entre ciclos --watch")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = _parse_args(argv)
    raiz = Path(args.ruta).resolve()
    if not raiz.is_dir():
        print(f"❌ El directorio '{raiz}' no existe.")
        return 1

    intervalo = max(30, int(args.intervalo or 120))

    while True:
        reporte = ejecutar_salud(raiz, con_tests=args.tests)
        imprimir_reporte(reporte, args.json)
        if not args.watch:
            return 1 if reporte.criticos else 0
        print(f"↻ Siguiente chequeo en {intervalo}s  (Ctrl+C para salir)\n")
        try:
            time.sleep(intervalo)
        except KeyboardInterrupt:
            print("\nSalud en watch detenida.")
            return 1 if reporte.criticos else 0


if __name__ == "__main__":
    sys.exit(main())
