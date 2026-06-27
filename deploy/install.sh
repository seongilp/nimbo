#!/usr/bin/env bash
# Nimbo installer — builds the app and installs it as a systemd service.
# Run from the project root:  sudo ./deploy/install.sh [PORT]
set -euo pipefail

APP_DIR=/opt/nimbo
ENV_DIR=/etc/nimbo
PORT="${1:-3000}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "이 스크립트는 root로 실행해야 합니다:  sudo ./deploy/install.sh" >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js가 필요합니다 (v20+ 권장)." >&2; exit 1; }

echo "==> 의존성 설치 & 빌드"
cd "$SRC"
npm ci
npm run build   # produces .next/standalone (output: 'standalone')

echo "==> $APP_DIR 에 설치"
mkdir -p "$APP_DIR"
# The standalone bundle is self-contained; copy it plus static assets.
cp -r .next/standalone/. "$APP_DIR/"
mkdir -p "$APP_DIR/.next"
cp -r .next/static "$APP_DIR/.next/static"
[[ -d public ]] && cp -r public "$APP_DIR/public" || true

echo "==> 설정 파일 ($ENV_DIR)"
mkdir -p "$ENV_DIR/certs"
if [[ ! -f "$ENV_DIR/nimbo.env" ]]; then
  cp "$SRC/deploy/nimbo.env.example" "$ENV_DIR/nimbo.env"
  sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_DIR/nimbo.env"
fi

echo "==> systemd 유닛 설치"
cp "$SRC/deploy/nimbo.service" /etc/systemd/system/nimbo.service
systemctl daemon-reload
systemctl enable --now nimbo

echo "==> (선택) sudoers 규칙 — 전용 유저로 돌릴 때만 필요"
echo "    cp deploy/nimbo.sudoers /etc/sudoers.d/nimbo"

echo ""
echo "✅ 완료. 상태:  systemctl status nimbo"
echo "   로그:        journalctl -u nimbo -f"
echo "   접속:        http://<this-host>:$PORT  (HTTPS는 Caddy 권장 — deploy/Caddyfile)"
echo "   포트 변경:   $ENV_DIR/nimbo.env 수정 후  systemctl restart nimbo"
