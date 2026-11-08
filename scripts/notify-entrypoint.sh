#!/bin/sh
set -e
# El disco de Render/Hetzner monta /data encima de la carpeta de la imagen (a menudo como root).
mkdir -p /data 2>/dev/null || true
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data || true
  exec su-exec node "$@"
fi
exec "$@"
