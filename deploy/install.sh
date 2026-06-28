#!/usr/bin/env bash
# Nimbo one-shot installer — installs prerequisites (Node.js, git), builds the
# app, creates a dedicated `nimbo` service account (passwordless sudo), and runs
# it as a systemd service. Optionally sets up Caddy (HTTPS).
#
#   sudo ./deploy/install.sh [--port N] [--caddy <domain-or-ip>]
set -euo pipefail

APP_DIR=/opt/nimbo
ENV_DIR=/etc/nimbo
SVC_USER=nimbo
PORT=3000
CADDY_HOST=""
HTTPS_PORT=443
NODE_MAJOR=20

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --caddy) CADDY_HOST="$2"; shift 2 ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

SRC="$(cd "$(dirname "$0")/.." && pwd)"
[[ $EUID -eq 0 ]] || { echo "root로 실행해야 합니다:  sudo ./deploy/install.sh" >&2; exit 1; }

# ── package manager ──────────────────────────────────────────────────────
if command -v dnf >/dev/null; then PKG=dnf
elif command -v apt-get >/dev/null; then PKG=apt
elif command -v yum >/dev/null; then PKG=yum
else echo "지원하지 않는 배포판 (dnf/apt/yum 없음)." >&2; exit 1; fi
echo "==> 패키지 관리자: $PKG"
pkg_install() { case "$PKG" in dnf|yum) "$PKG" install -y "$@";; apt) export DEBIAN_FRONTEND=noninteractive; apt-get install -y "$@";; esac; }

# ── port conflict helpers ────────────────────────────────────────────────
port_in_use() { command -v ss >/dev/null && ss -Htln "sport = :$1" 2>/dev/null | grep -q .; }
free_port() { local p=$1; while port_in_use "$p"; do p=$((p+1)); done; echo "$p"; }
choose_port() { # $1 wanted, $2 label
  local want=$1 label=$2 p=$1
  if port_in_use "$p"; then
    local nf; nf=$(free_port $((p+1)))
    if [[ -e /dev/tty ]]; then
      local ans=""; read -rp "⚠ $label 포트 $p 사용 중. 사용할 포트 [$nf]: " ans < /dev/tty || true
      p=${ans:-$nf}
    else
      p=$nf; echo "⚠ $label 포트 $want 사용 중 → $p 로 변경" >&2
    fi
  fi
  echo "$p"
}

# ── prerequisites: curl, git, node ───────────────────────────────────────
command -v curl >/dev/null || pkg_install curl ca-certificates
command -v git  >/dev/null || pkg_install git
command -v openssl >/dev/null || pkg_install openssl || true
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

# ── dedicated service account (passwordless sudo) ────────────────────────
echo "==> 서비스 계정 '$SVC_USER' 준비"
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd -r -m -d "/home/$SVC_USER" -s /bin/bash "$SVC_USER" 2>/dev/null || useradd -r -s /usr/sbin/nologin "$SVC_USER"
fi
getent group docker >/dev/null 2>&1 && usermod -aG docker "$SVC_USER" || true
echo "$SVC_USER ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/nimbo
chmod 440 /etc/sudoers.d/nimbo
visudo -cf /etc/sudoers.d/nimbo >/dev/null || { rm -f /etc/sudoers.d/nimbo; echo "sudoers 검증 실패" >&2; exit 1; }

# ── stop existing service so its port doesn't look "in use" ──────────────
systemctl stop nimbo 2>/dev/null || true

# ── port selection ───────────────────────────────────────────────────────
PORT=$(choose_port "$PORT" "Nimbo")
[[ -n "$CADDY_HOST" ]] && HTTPS_PORT=$(choose_port "$HTTPS_PORT" "HTTPS")

# ── build ────────────────────────────────────────────────────────────────
echo "==> 의존성 설치 & 빌드 (시간이 좀 걸립니다)"
cd "$SRC"
npm ci
npm run build   # output: 'standalone'

# ── install bundle ───────────────────────────────────────────────────────
echo "==> $APP_DIR 에 설치"
rm -rf "$APP_DIR"; mkdir -p "$APP_DIR/.next"
cp -r .next/standalone/. "$APP_DIR/"
cp -r .next/static "$APP_DIR/.next/static"
[[ -d public ]] && cp -r public "$APP_DIR/public" || true

# ── config ───────────────────────────────────────────────────────────────
echo "==> 설정 파일 ($ENV_DIR)"
mkdir -p "$ENV_DIR/certs"
[[ -f "$ENV_DIR/nimbo.env" ]] || cp "$SRC/deploy/nimbo.env.example" "$ENV_DIR/nimbo.env"
set_env() { if grep -q "^$1=" "$ENV_DIR/nimbo.env"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_DIR/nimbo.env"; else echo "$1=$2" >> "$ENV_DIR/nimbo.env"; fi; }
set_env PORT "$PORT"
set_env NIMBO_SUDO 1
set_env NAS_MOCK 0
[[ -n "$CADDY_HOST" ]] && set_env HOSTNAME "127.0.0.1"
# Stable session-signing secret (generated once).
grep -q "^NIMBO_SECRET=" "$ENV_DIR/nimbo.env" || \
  echo "NIMBO_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')" >> "$ENV_DIR/nimbo.env"

chown -R "$SVC_USER:$SVC_USER" "$APP_DIR" "$ENV_DIR"

# ── systemd (runs as the nimbo account) ──────────────────────────────────
echo "==> systemd 유닛 설치 (User=$SVC_USER)"
cp "$SRC/deploy/nimbo.service" /etc/systemd/system/nimbo.service
systemctl daemon-reload
systemctl enable --now nimbo

# ── optional Caddy (HTTPS) ───────────────────────────────────────────────
if [[ -n "$CADDY_HOST" ]]; then
  echo "==> Caddy 설치 & 설정 ($CADDY_HOST:$HTTPS_PORT → 127.0.0.1:$PORT)"
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
  local_site="$CADDY_HOST"; [[ "$HTTPS_PORT" != "443" ]] && local_site="$CADDY_HOST:$HTTPS_PORT"
  [[ "$CADDY_HOST" =~ ^[0-9.]+$ ]] && TLS_LINE="  tls internal" || TLS_LINE=""
  cat > /etc/caddy/Caddyfile <<EOF
$local_site {
$TLS_LINE
  encode zstd gzip
  reverse_proxy 127.0.0.1:$PORT
}
EOF
  command -v firewall-cmd >/dev/null && { firewall-cmd --add-port="$HTTPS_PORT"/tcp --permanent >/dev/null 2>&1 || true; firewall-cmd --reload >/dev/null 2>&1 || true; }
  systemctl enable --now caddy || true
  systemctl reload caddy || systemctl restart caddy || true
fi

# ── fail2ban (SSH + Nimbo login brute-force protection) ──────────────────
echo "==> fail2ban 설치 & Nimbo jail 등록"
if ! command -v fail2ban-client >/dev/null; then
  pkg_install fail2ban || true
fi
# systemd backend needs the python journal bindings.
case "$PKG" in
  dnf|yum) command -v fail2ban-client >/dev/null && pkg_install python3-systemd || true ;;
  apt)     command -v fail2ban-client >/dev/null && pkg_install python3-systemd || true ;;
esac
if command -v fail2ban-client >/dev/null; then
  mkdir -p /etc/fail2ban/filter.d /etc/fail2ban/jail.d
  cp "$SRC/deploy/fail2ban/filter.d/nimbo.conf" /etc/fail2ban/filter.d/nimbo.conf
  cp "$SRC/deploy/fail2ban/jail.d/nimbo.conf"   /etc/fail2ban/jail.d/nimbo.conf
  cp "$SRC/deploy/fail2ban/jail.d/sshd.local"   /etc/fail2ban/jail.d/sshd.local
  systemctl enable --now fail2ban || true
  fail2ban-client reload >/dev/null 2>&1 || systemctl restart fail2ban || true
  echo "   jail 'nimbo' + 'sshd' 등록됨 (5회/10분 실패 → 1시간 차단). 확인: fail2ban-client status"
else
  echo "   ⚠ fail2ban 설치 실패 — 내장 락아웃(5회/15분)만 동작합니다."
fi

# ── done ─────────────────────────────────────────────────────────────────
echo ""
echo "✅ 완료. (서비스 계정: $SVC_USER, passwordless sudo)"
echo "   상태:   systemctl status nimbo   ·   로그: journalctl -u nimbo -f"
if [[ -n "$CADDY_HOST" ]]; then
  echo "   접속:   https://$CADDY_HOST$([[ "$HTTPS_PORT" != 443 ]] && echo ":$HTTPS_PORT")"
else
  echo "   접속:   http://<this-host>:$PORT"
fi
echo "   로그인: 이 서버의 OS 계정(root 등)으로 로그인"
