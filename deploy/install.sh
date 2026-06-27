#!/usr/bin/env bash
# Nimbo one-shot installer — installs prerequisites (Node.js, git), builds the
# app, and installs it as a systemd service. Optionally sets up Caddy (HTTPS).
#
#   sudo ./deploy/install.sh [--port N] [--caddy <domain-or-ip>]
#
# Examples:
#   sudo ./deploy/install.sh                       # localhost:3000, no proxy
#   sudo ./deploy/install.sh --port 8080
#   sudo ./deploy/install.sh --caddy nas.lan       # HTTPS on 443 via Caddy
set -euo pipefail

APP_DIR=/opt/nimbo
ENV_DIR=/etc/nimbo
PORT=3000
CADDY_HOST=""
NODE_MAJOR=20

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --caddy) CADDY_HOST="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

SRC="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "root로 실행해야 합니다:  sudo ./deploy/install.sh" >&2
  exit 1
fi

# ── package manager detection ───────────────────────────────────────────
if command -v dnf >/dev/null; then PKG=dnf
elif command -v apt-get >/dev/null; then PKG=apt
elif command -v yum >/dev/null; then PKG=yum
else echo "지원하지 않는 배포판 (dnf/apt/yum 없음). 수동으로 Node.js 20+ 설치 후 다시 실행하세요." >&2; exit 1
fi
echo "==> 패키지 관리자: $PKG"

pkg_install() {
  case "$PKG" in
    dnf|yum) "$PKG" install -y "$@" ;;
    apt) export DEBIAN_FRONTEND=noninteractive; apt-get install -y "$@" ;;
  esac
}

# ── prerequisites: curl, git, node ──────────────────────────────────────
command -v curl >/dev/null || pkg_install curl ca-certificates
command -v git  >/dev/null || pkg_install git

node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]]; }
if ! node_ok; then
  echo "==> Node.js $NODE_MAJOR 설치"
  case "$PKG" in
    dnf|yum) curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - ; pkg_install nodejs ;;
    apt)     curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - ; pkg_install nodejs ;;
  esac
fi
node_ok || { echo "Node.js 설치 실패" >&2; exit 1; }
echo "==> Node $(node --version)"

# ── build ───────────────────────────────────────────────────────────────
echo "==> 의존성 설치 & 빌드 (시간이 좀 걸립니다)"
cd "$SRC"
npm ci
npm run build   # output: 'standalone' → .next/standalone/server.js

# ── install bundle ──────────────────────────────────────────────────────
echo "==> $APP_DIR 에 설치"
rm -rf "$APP_DIR"; mkdir -p "$APP_DIR/.next"
cp -r .next/standalone/. "$APP_DIR/"
cp -r .next/static "$APP_DIR/.next/static"
[[ -d public ]] && cp -r public "$APP_DIR/public" || true

# ── config ──────────────────────────────────────────────────────────────
echo "==> 설정 파일 ($ENV_DIR)"
mkdir -p "$ENV_DIR/certs"
if [[ ! -f "$ENV_DIR/nimbo.env" ]]; then
  cp "$SRC/deploy/nimbo.env.example" "$ENV_DIR/nimbo.env"
fi
sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_DIR/nimbo.env"
# When Caddy fronts us, bind to localhost only; otherwise expose on the LAN.
if [[ -n "$CADDY_HOST" ]]; then
  sed -i "s/^HOSTNAME=.*/HOSTNAME=127.0.0.1/" "$ENV_DIR/nimbo.env"
fi

# ── systemd ─────────────────────────────────────────────────────────────
echo "==> systemd 유닛 설치"
cp "$SRC/deploy/nimbo.service" /etc/systemd/system/nimbo.service
systemctl daemon-reload
systemctl enable --now nimbo

# ── optional: Caddy (HTTPS reverse proxy on :443) ───────────────────────
if [[ -n "$CADDY_HOST" ]]; then
  echo "==> Caddy 설치 & 설정 ($CADDY_HOST → 127.0.0.1:$PORT)"
  if ! command -v caddy >/dev/null; then
    case "$PKG" in
      dnf|yum) "$PKG" install -y 'dnf-command(copr)' || true; "$PKG" copr enable -y @caddy/caddy || true; pkg_install caddy ;;
      apt)
        pkg_install debian-keyring debian-archive-keyring apt-transport-https gnupg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update; pkg_install caddy ;;
    esac
  fi
  # LAN IP → internal cert; real domain → automatic Let's Encrypt.
  if [[ "$CADDY_HOST" =~ ^[0-9.]+$ ]]; then TLS_LINE="  tls internal"; else TLS_LINE=""; fi
  cat > /etc/caddy/Caddyfile <<EOF
$CADDY_HOST {
$TLS_LINE
  encode zstd gzip
  reverse_proxy 127.0.0.1:$PORT
}
EOF
  systemctl enable --now caddy || true
  systemctl reload caddy || systemctl restart caddy || true
fi

# ── done ────────────────────────────────────────────────────────────────
echo ""
echo "✅ 완료."
echo "   상태:   systemctl status nimbo"
echo "   로그:   journalctl -u nimbo -f"
if [[ -n "$CADDY_HOST" ]]; then
  echo "   접속:   https://$CADDY_HOST   (Caddy → 127.0.0.1:$PORT)"
else
  echo "   접속:   http://<this-host>:$PORT"
  echo "   ⚠ 인증 없음 — 신뢰 네트워크에서만, 또는 SSH 터널로 접속하세요:"
  echo "            ssh -L $PORT:localhost:$PORT <user>@<this-host>  →  http://localhost:$PORT"
fi
echo "   포트변경: $ENV_DIR/nimbo.env 수정 후  systemctl restart nimbo"
