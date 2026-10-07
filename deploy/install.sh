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
  ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")
  WORKER_CODE=$(node -e "console.log(require('crypto').randomBytes(4).toString('hex'))")
  cat > "$APP_DIR/.env" <<ENV
PORT=${PORT:-80}
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
# ежедневный бэкап: консистентная копия базы (VACUUM INTO) + фото, храним 14 дней
cat > /etc/cron.daily/dna-backup <<'CRON'
#!/bin/sh
set -e
D=/var/backups/dna; mkdir -p "$D"; T=$(date +%F)
rm -f "$D/dna-$T.sqlite"
node -e "new (require('node:sqlite').DatabaseSync)('/opt/dna-detailing/data/dna.sqlite').exec(\"VACUUM INTO '$D/dna-$T.sqlite'\")" 2>/dev/null
tar -czf "$D/uploads-$T.tar.gz" -C /opt/dna-detailing/data uploads
find "$D" -type f -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/dna-backup

systemctl daemon-reload
systemctl enable dna-detailing >/dev/null
systemctl restart dna-detailing
command -v ufw >/dev/null && ufw status | grep -q active && ufw allow "$(grep ^PORT= "$APP_DIR/.env" | cut -d= -f2)/tcp" || true
sleep 2
systemctl --no-pager status dna-detailing | head -5
echo ">> Готово: http://$(hostname -I | awk '{print $1}'):$(grep ^PORT= "$APP_DIR/.env" | cut -d= -f2)/"
