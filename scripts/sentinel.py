#!/usr/bin/env python3
"""Centinela de cuentas Quatrivium: solo bloques ya minados, solo lectura.

Si se rompe el NAV de Credit o la caja de Reserva, avisa por Telegram.
No firma, no pausa, no usa la mempool. La llave de admin no entra aqui.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    from web3 import Web3
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Falta web3. Instale: pip install -r requirements-sentinel.txt") from exc

CREDIT_ABI = [
    {
        "name": "outstandingLoans",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "token", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "name": "totalLiquidity",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "token", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
    {
        "name": "collectedFees",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "token", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
]
RESERVA_ABI = [
    {
        "name": "bote",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "name": "totalBloqueado",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
]
ERC20_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    }
]


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def env_addr(name: str, fallback: str = "") -> str:
    raw = (os.environ.get(name) or fallback).strip()
    if not raw or raw == "0x0000000000000000000000000000000000000000":
        return ""
    return Web3.to_checksum_address(raw)


def telegram_send(text: str) -> None:
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat = (os.environ.get("TELEGRAM_ADMIN_CHAT_ID") or os.environ.get("SENTINEL_CHAT_ID") or "").strip()
    if not token or not chat:
        print("ALERTA (sin Telegram configurado):", text, file=sys.stderr)
        return
    body = json.dumps({"chat_id": chat, "text": text, "disable_web_page_preview": True}).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Telegram fallo: {exc}", file=sys.stderr)


def read_nav(w3: Web3, credit_addr: str, token_addr: str) -> dict:
    token = w3.eth.contract(address=token_addr, abi=ERC20_ABI)
    credit = w3.eth.contract(address=credit_addr, abi=CREDIT_ABI)
    cash = int(token.functions.balanceOf(credit_addr).call())
    outstanding = int(credit.functions.outstandingLoans(token_addr).call())
    liquidity = int(credit.functions.totalLiquidity(token_addr).call())
    fees = int(credit.functions.collectedFees(token_addr).call())
    return {
        "cash": cash,
        "outstanding": outstanding,
        "liquidity": liquidity,
        "fees": fees,
        "ok": cash + outstanding == liquidity + fees,
    }


def read_reserva(w3: Web3, reserva_addr: str, token_addr: str) -> dict:
    token = w3.eth.contract(address=token_addr, abi=ERC20_ABI)
    reserva = w3.eth.contract(address=reserva_addr, abi=RESERVA_ABI)
    cash = int(token.functions.balanceOf(reserva_addr).call())
    bote = int(reserva.functions.bote().call())
    locked = int(reserva.functions.totalBloqueado().call())
    return {
        "cash": cash,
        "bote": bote,
        "locked": locked,
        "ok": cash == bote + locked,
    }


def check_once(w3: Web3, credit_addr: str, token_addr: str, reserva_addr: str, block: int) -> list[str]:
    broken: list[str] = []
    nav = read_nav(w3, credit_addr, token_addr)
    if not nav["ok"]:
        broken.append(
            f"NAV Credit roto bloque {block}: "
            f"caja {nav['cash']} + prestado {nav['outstanding']} != "
            f"liq {nav['liquidity']} + fees {nav['fees']}"
        )
    if reserva_addr:
        caja = read_reserva(w3, reserva_addr, token_addr)
        if not caja["ok"]:
            broken.append(
                f"Caja Reserva rota bloque {block}: "
                f"saldo {caja['cash']} != bote {caja['bote']} + bloqueado {caja['locked']}"
            )
    return broken


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Centinela de cuentas Quatrivium (solo lectura).")
    parser.add_argument("--once", action="store_true", help="Un bloque y salir.")
    parser.add_argument("--poll", type=int, default=0, help="Segundos entre bloques (0 = SENTINEL_POLL_SEC o 12).")
    return parser.parse_args()


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env")
    args = parse_args()

    rpc = (
        os.environ.get("SENTINEL_RPC_URL")
        or os.environ.get("BSC_TESTNET_RPC_URL")
        or os.environ.get("EXPO_PUBLIC_BSC_RPC_URL_PRIMARY")
        or ""
    ).strip()
    if not rpc:
        print("Falta SENTINEL_RPC_URL o BSC_TESTNET_RPC_URL.", file=sys.stderr)
        return 2
    if rpc.startswith("ws"):
        print("Use HTTP(S) de bloques confirmados, no WebSocket de mempool.", file=sys.stderr)
        return 2

    credit_addr = env_addr("SENTINEL_CREDIT") or env_addr("EXPO_PUBLIC_CONTRACT_ADDRESS_TESTNET")
    token_addr = env_addr("SENTINEL_TOKEN") or env_addr("USDT_ADDRESS") or env_addr("EXPO_PUBLIC_USDT_ADDRESS")
    reserva_addr = env_addr("SENTINEL_RESERVA") or env_addr("EXPO_PUBLIC_RESERVA_ADDRESS_TESTNET")
    if not credit_addr or not token_addr:
        print("Falta SENTINEL_CREDIT y SENTINEL_TOKEN (o las EXPO_PUBLIC_*).", file=sys.stderr)
        return 2

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        print("No hay conexion RPC.", file=sys.stderr)
        return 2

    poll = args.poll or int(os.environ.get("SENTINEL_POLL_SEC") or "12")
    last_block = -1
    last_alert = ""

    while True:
        try:
            block = int(w3.eth.block_number)
            if block == last_block:
                if args.once:
                    return 0
                time.sleep(poll)
                continue
            last_block = block
            broken = check_once(w3, credit_addr, token_addr, reserva_addr, block)
            if broken:
                text = "QUATRIVIUM ALERTA ROJA\n" + "\n".join(broken)
                print(text, file=sys.stderr)
                if text != last_alert:
                    telegram_send(text)
                    last_alert = text
                if args.once:
                    return 1
            else:
                print(f"ok bloque {block} credit={credit_addr}")
                last_alert = ""
                if args.once:
                    return 0
        except (OSError, ValueError, TimeoutError) as exc:
            print(f"lectura fallo: {exc}", file=sys.stderr)
            if args.once:
                return 2
        time.sleep(poll)


if __name__ == "__main__":
    raise SystemExit(main())
