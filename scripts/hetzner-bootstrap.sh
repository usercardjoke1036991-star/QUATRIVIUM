#!/bin/sh
# Primera vez en el VPS Hetzner (Ubuntu). No imprime secretos.
set -eu

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-v2 ufw fail2ban unattended-upgrades

systemctl enable --now docker
systemctl enable --now fail2ban

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p /opt/quatrivium-notify
echo "Hetzner listo. Suba el worker con npm run notify:hetzner"
