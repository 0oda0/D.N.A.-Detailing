#!/usr/bin/env bash
# Установка / обновление D.N.A. Detailing на Ubuntu/Debian.
# Запуск из папки проекта на сервере:  sudo bash deploy/install.sh
set -euo pipefail
APP_DIR=/opt/dna-detailing
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo ">> Устанавливаю Node.js 22"
  apt-get update -y && apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id dna >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin dna
mkdir -p "$APP_DIR/data"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  cp -r "$SRC_DIR"/server.js "$SRC_DIR"/package.json "$SRC_DIR"/package-lock.json "$SRC_DIR"/public "$APP_DIR"/
fi
cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund

# Секреты создаются один раз и хранятся в /opt/dna-detailing/.env
if [ ! -f "$APP_DIR/.env" ]; then
  ADMIN_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)
  WORKER_CODE=$(tr -dc 'a-z0-9' </dev/urandom | head -c 8)
  cat > "$APP_DIR/.env" <<ENV
PORT=80
TZ=Europe/Moscow
ADMIN_PHONE=+79686107799
ADMIN_PASSWORD=$ADMIN_PASSWORD
WORKER_CODE=$WORKER_CODE
NODE_NO_WARNINGS=1
ENV
  chmod 600 "$APP_DIR/.env"
  echo ">> Админ: +79686107799 / $ADMIN_PASSWORD"
  echo ">> Код сотрудника для регистрации мастеров: $WORKER_CODE"
fi
chown -R dna:dna "$APP_DIR"

cat > /etc/systemd/system/dna-detailing.service <<UNIT
[Unit]
Description=D.N.A. Detailing site
After=network.target

[Service]
User=dna
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable dna-detailing >/dev/null
systemctl restart dna-detailing
command -v ufw >/dev/null && ufw status | grep -q active && ufw allow 80/tcp || true
sleep 2
systemctl --no-pager status dna-detailing | head -5
echo ">> Готово: http://$(curl -s4 https://ifconfig.me || hostname -I | awk '{print $1}')/"
