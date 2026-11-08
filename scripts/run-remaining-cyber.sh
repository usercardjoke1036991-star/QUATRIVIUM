#!/usr/bin/env bash
# Repite solo Trivy, Semgrep y Mythril sin rehacer Aderyn, Forge ni Slither.
# Antes era una copia del pipeline completo y arrastraba sus mismos fallos
# (Trivy con varias rutas, pack p/solidity inexistente, Mythril sin solc).
exec env CYBER_STAGES="trivy semgrep mythril" \
  bash "$(dirname "$0")/run-full-cyber-audit.sh" "$@"
