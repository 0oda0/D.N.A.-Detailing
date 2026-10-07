#!/usr/bin/env bash
# Установка / обновление Studio site на Ubuntu/Debian.
# Запуск из папки проекта на сервере:  sudo bash deploy/install.sh
set -euo pipefail
APP_DIR=/opt/studio-site
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo ">> Устанавливаю Node.js 22"
  apt-get update -y && apt-get install -y curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id studio >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin studio
mkdir -p "$APP_DIR/data"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  cp -r "$SRC_DIR"/server.js "$SRC_DIR"/package.json "$SRC_DIR"/package-lock.json "$SRC_DIR"/public "$APP_DIR"/
fi
cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund

# Секреты создаются один раз и хранятся в /opt/studio-site/.env
if [ ! -f "$APP_DIR/.env" ]; then
  ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")
  WORKER_CODE=$(node -e "console.log(require('crypto').randomBytes(4).toString('hex'))")
  cat > "$APP_DIR/.env" <<ENV
PORT=${PORT:-80}
TZ=Europe/Moscow
ADMIN_PHONE=${ADMIN_PHONE:-+79990000000}
ADMIN_PASSWORD=$ADMIN_PASSWORD
WORKER_CODE=$WORKER_CODE
NODE_NO_WARNINGS=1
ENV
  chmod 600 "$APP_DIR/.env"
  echo ">> Админ: ${ADMIN_PHONE:-+79990000000} / $ADMIN_PASSWORD"
  echo ">> Код сотрудника для регистрации мастеров: $WORKER_CODE"
fi
chown -R studio:studio "$APP_DIR"

cat > /etc/systemd/system/studio-site.service <<UNIT
[Unit]
Description=Studio site site
After=network.target

[Service]
User=studio
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node server.js
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
# ежедневный бэкап: консистентная копия базы (VACUUM INTO) + фото, храним 14 дней
cat > /etc/cron.daily/studio-backup <<'CRON'
#!/bin/sh
set -e
D=/var/backups/studio; mkdir -p "$D"; T=$(date +%F)
rm -f "$D/db-$T.sqlite"
node -e "new (require('node:sqlite').DatabaseSync)('/opt/studio-site/data/app.sqlite').exec(\"VACUUM INTO '$D/db-$T.sqlite'\")" 2>/dev/null
tar -czf "$D/uploads-$T.tar.gz" -C /opt/studio-site/data uploads
find "$D" -type f -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/studio-backup

systemctl daemon-reload
systemctl enable studio-site >/dev/null
systemctl restart studio-site
command -v ufw >/dev/null && ufw status | grep -q active && ufw allow "$(grep ^PORT= "$APP_DIR/.env" | cut -d= -f2)/tcp" || true
sleep 2
systemctl --no-pager status studio-site | head -5
echo ">> Готово: http://$(hostname -I | awk '{print $1}'):$(grep ^PORT= "$APP_DIR/.env" | cut -d= -f2)/"
