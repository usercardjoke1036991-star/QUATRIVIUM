#!/usr/bin/env bash
# Slither con el Hardhat de este repo. En Windows, run-slither.mjs puede llamarlo vía WSL.
cd "$(dirname "$0")/.." || exit 1
export PATH="$HOME/.local/bin:$PWD/node_modules/.bin:$PATH"
unset npm_config_prefix npm_config_devdir npm_config_local_prefix NODE_PATH
export HARDHAT_CONFIG="$PWD/hardhat.config.cjs"

hh_cli="$PWD/node_modules/hardhat/internal/cli/cli.js"
if [[ ! -f "$hh_cli" ]]; then
  echo "No está node_modules/hardhat. Ejecuta npm install en la raíz del repo." >&2
  exit 1
fi

node "$hh_cli" --config hardhat.config.cjs compile --force || exit 1
if command -v slither >/dev/null 2>&1; then
  slither . --config-file slither.config.json --compile-force-framework hardhat --hardhat-ignore-compile "$@"
else
  python3 -m slither . --config-file slither.config.json --compile-force-framework hardhat --hardhat-ignore-compile "$@"
fi
