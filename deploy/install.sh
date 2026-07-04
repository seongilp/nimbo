#!/usr/bin/env bash
# Nimbo one-shot installer — installs prerequisites (Node.js, git), builds the
# app, creates a dedicated `nimbo` service account (passwordless sudo), and runs
# it as a systemd service behind Caddy (HTTPS on 443).
#
#   sudo ./deploy/install.sh [--port N] [--caddy <domain-or-ip>] [--no-caddy]
#
# Caddy(HTTPS/443)가 기본값이다. --caddy 없이 실행하면 서버 IP를 자동 감지해
# 자체 서명 인증서로 https://<서버-IP> 를 띄운다. --caddy <도메인>이면 진짜 인증서.
# 이미 리버스 프록시가 있으면 --no-caddy 로 Caddy를 건너뛰고 앱을 127.0.0.1:PORT에
# 둔 뒤 직접 라우팅하라.
set -euo pipefail

APP_DIR=/opt/nimbo
ENV_DIR=/etc/nimbo
SVC_USER=nimbo
PORT=3000
CADDY_HOST=""
USE_CADDY=1        # HTTPS via Caddy on 443 by default; --no-caddy opts out
CADDY_AUTO=0       # 1 when CADDY_HOST was auto-detected (no explicit --caddy)
CADDY_EXPLICIT=0   # 1 when --caddy/--no-caddy was passed (vs. preserving prior mode)
HTTPS_PORT=443
NODE_MAJOR=20
TERMINAL_PORT=3001 # fixed sidecar port — the app port must never collide with it

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) [[ -n "${2:-}" ]] || { echo "--port 에 포트 번호가 필요합니다" >&2; exit 1; }; PORT="$2"; shift 2 ;;
    --caddy) [[ -n "${2:-}" ]] || { echo "--caddy 에 도메인 또는 IP가 필요합니다" >&2; exit 1; }; CADDY_HOST="$2"; USE_CADDY=1; CADDY_EXPLICIT=1; shift 2 ;;
    --no-caddy) USE_CADDY=0; CADDY_EXPLICIT=1; shift ;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
  esac
done

# Primary IPv4 of this host (default route source), for the auto Caddy target.
detect_ip() {
  local ip=""
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
  if [[ -z "$ip" ]]; then
    # Fallback: first hostname IP that isn't loopback, link-local, or the
    # docker default bridge (172.17.x) — those would make the site unreachable.
    ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -vE '^(127\.|169\.254\.|172\.17\.)' | head -1)
  fi
  echo "$ip"
}

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
# free_port also skips the fixed terminal sidecar port so the app never grabs it.
free_port() { local p=$1; while port_in_use "$p" || [[ "$p" == "$TERMINAL_PORT" ]]; do p=$((p+1)); done; echo "$p"; }
choose_port() { # $1 wanted, $2 label
  local want=$1 label=$2 p=$1
  # Treat the fixed terminal sidecar port as unavailable too — assigning it to
  # the app would leave the PTY service (hard-wired to 127.0.0.1:$TERMINAL_PORT)
  # unable to bind, silently killing the terminal feature.
  if port_in_use "$p" || [[ "$p" == "$TERMINAL_PORT" ]]; then
    local nf; nf=$(free_port $((p+1)))
    if [[ -e /dev/tty ]]; then
      local ans=""; read -rp "⚠ $label 포트 $p 사용 중. 사용할 포트 [$nf]: " ans < /dev/tty || true
      if [[ "$ans" =~ ^[0-9]+$ ]] && (( ans >= 1 && ans <= 65535 )) && [[ "$ans" != "$TERMINAL_PORT" ]] && ! port_in_use "$ans"; then p=$ans; else p=$nf; fi
    else
      p=$nf; echo "⚠ $label 포트 $want 사용 중 → $p 로 변경" >&2
    fi
  fi
  echo "$p"
}
# HTTPS port for Caddy: prefer 443, fall back to 10443, then prompt (or auto-pick).
choose_https_port() {
  if ! port_in_use 443; then echo 443; return; fi
  if ! port_in_use 10443; then
    echo "⚠ 443 사용 중 → 10443 사용" >&2
    echo 10443; return
  fi
  if [[ -e /dev/tty ]]; then
    local ans=""
    read -rp "⚠ 443·10443 모두 사용 중. 사용할 HTTPS 포트 입력: " ans < /dev/tty || true
    if [[ "$ans" =~ ^[0-9]+$ ]] && (( ans >= 1 && ans <= 65535 )) && ! port_in_use "$ans"; then
      echo "$ans"; return
    fi
    echo "⚠ 입력이 비었거나 사용 중인 포트 → 자동 선택" >&2
  fi
  free_port 10444
}

# ── prerequisites: curl, git, node, ss ───────────────────────────────────
command -v curl >/dev/null || pkg_install curl ca-certificates
command -v git  >/dev/null || pkg_install git
command -v openssl >/dev/null || pkg_install openssl || true
# `ss` (iproute2) backs the port-conflict detection below. Without it we'd
# silently assume every port is free and later collide with an existing proxy.
command -v ss >/dev/null || pkg_install iproute2 || pkg_install iproute || true
command -v ss >/dev/null || echo "⚠ 'ss' 없음 — 포트 충돌 감지를 건너뜁니다(다른 서비스와 겹칠 수 있음)." >&2
# python3 + system libcrypt back OS-password verification (auth.ts). REQUIRED —
# without a working libcrypt the web console can never authenticate anyone.
command -v python3 >/dev/null || pkg_install python3 || true
command -v python3 >/dev/null || { echo "python3 설치 실패 — OS 비밀번호 검증에 필요합니다." >&2; exit 1; }
if ! python3 - <<'PY'
import sys,ctypes,ctypes.util
for n in (ctypes.util.find_library('crypt'),'libcrypt.so.1','libcrypt.so'):
    if not n: continue
    try:
        ctypes.CDLL(n); sys.exit(0)
    except OSError:
        pass
sys.exit(1)
PY
then
  echo "==> libcrypt 미탑재 — 설치 시도"
  case "$PKG" in
    dnf|yum) pkg_install libxcrypt || true ;;
    apt)     pkg_install libcrypt1 || pkg_install libcrypt-dev || true ;;
  esac
  python3 - <<'PY' || { echo "⚠ libcrypt 로드 실패 — OS 비밀번호 검증 불가(libxcrypt/libcrypt1 필요)." >&2; exit 1; }
import sys,ctypes,ctypes.util
for n in (ctypes.util.find_library('crypt'),'libcrypt.so.1','libcrypt.so'):
    if not n: continue
    try:
        ctypes.CDLL(n); sys.exit(0)
    except OSError:
        pass
sys.exit(1)
PY
fi
# Next 16 requires Node >=20.9 (engines). Accept only that; a pre-existing
# Node 18/19/20.0-20.8 must trigger the NodeSource 20 install below, else the
# service silently crash-loops or the build aborts.
node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=9)?0:1)' 2>/dev/null; }
if ! node_ok; then
  echo "==> Node.js $NODE_MAJOR 설치"
  case "$PKG" in
    dnf|yum) curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - ; pkg_install nodejs ;;
    apt)     curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - ; pkg_install nodejs ;;
  esac
fi
node_ok || { echo "Node.js 설치 실패" >&2; exit 1; }
echo "==> Node $(node --version)"

# ── preserve the prior HTTPS mode on a bare re-run (no --caddy/--no-caddy) ────
# so re-running the one-liner on a DOMAIN install doesn't silently revert it to
# an auto-IP self-signed cert. `nimbo update` passes the mode explicitly; this
# also covers a raw `curl | bash` re-run.
if [[ "$CADDY_EXPLICIT" == 0 && -f "$ENV_DIR/nimbo.env" ]]; then
  _prev=$(grep -oE '^NIMBO_CADDY=.*' "$ENV_DIR/nimbo.env" 2>/dev/null | cut -d= -f2 || true)
  case "$_prev" in
    none)    USE_CADDY=0; echo "==> 기존 설정 유지: --no-caddy" ;;
    auto|"") : ;;                                   # keep default (auto-detect IP)
    *)       CADDY_HOST="$_prev"; USE_CADDY=1; echo "==> 기존 설정 유지: --caddy $_prev" ;;
  esac
fi

# ── Caddy target: default to the server's own IP (self-signed) unless given ──
if [[ "$USE_CADDY" == 1 && -z "$CADDY_HOST" ]]; then
  CADDY_HOST="$(detect_ip)"; CADDY_AUTO=1
  if [[ -z "$CADDY_HOST" ]]; then
    echo "⚠ 서버 IP 자동 감지 실패 — 도메인/IP를 지정하세요:  --caddy <도메인-또는-IP>" >&2
    echo "  (또는 --no-caddy 로 Caddy 없이 설치)" >&2
    exit 1
  fi
  echo "==> Caddy 대상 자동 감지: $CADDY_HOST (자체 서명 인증서)"
fi

# ── dedicated service account (passwordless sudo) ────────────────────────
echo "==> 서비스 계정 '$SVC_USER' 준비"
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd -r -m -d "/home/$SVC_USER" -s /bin/bash "$SVC_USER" 2>/dev/null || useradd -r -s /usr/sbin/nologin "$SVC_USER"
fi
getent group docker >/dev/null 2>&1 && usermod -aG docker "$SVC_USER" || true
# ⚠ 보안 주의 (BLANKET NOPASSWD): 아래 줄은 nimbo 계정에 *모든* 명령의 무암호 sudo를
#   부여한다. 이는 레거시 읽기 경로(exec.ts의 `sudo -n bash -c '<cmd>'`)가 임의의 셸
#   명령을 필요로 하기 때문에 호환성 목적으로 유지된다. 즉, 앱을 탈취당하면 곧 root다.
#   하드닝 경로: 데이터플레인 argv 마이그레이션은 **완료**됐다(모든 시스템 모듈이
#   `sudo -n <binary> <args>`, no shell). 다만 셸이 본질인 예외 2곳(인터랙티브
#   터미널, zfs send|receive 파이프)이 남아 좁은 sudoers로 전면 교체하려면 추가
#   작업이 필요하다(터미널 Runas 스코핑 + 파이프 프리미티브). 그래서 install.sh는
#   아직 blanket sudo를 유지한다. 자세한 내용·채택 조건은 deploy/nimbo.sudoers 헤더 참고.
echo "$SVC_USER ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/nimbo
chmod 440 /etc/sudoers.d/nimbo
visudo -cf /etc/sudoers.d/nimbo >/dev/null || { rm -f /etc/sudoers.d/nimbo; echo "sudoers 검증 실패" >&2; exit 1; }

# ── stop existing services so their ports don't look "in use" ─────────────
# (Re-run safety: a running instance holding 3000/443/80 would otherwise make
# choose_port bump to the next free port and silently move the site.)
systemctl stop nimbo 2>/dev/null || true
[[ "$USE_CADDY" == 1 ]] && systemctl stop caddy 2>/dev/null || true

# ── port selection ───────────────────────────────────────────────────────
PORT=$(choose_port "$PORT" "Nimbo")
[[ "$USE_CADDY" == 1 ]] && HTTPS_PORT=$(choose_https_port)

# ── build (skipped for a prebuilt release bundle) ─────────────────────────
cd "$SRC"
if [[ -f "$SRC/PREBUILT" ]]; then
  echo "==> 프리빌트 번들 감지 ($(cat "$SRC/PREBUILT" 2>/dev/null || echo '?')) — 서버 빌드 생략"
  [[ -f "$SRC/.next/standalone/server.js" ]] || { echo "프리빌트 번들이 손상됨(.next/standalone 없음)" >&2; exit 1; }
else
  echo "==> 의존성 설치 & 빌드 (시간이 좀 걸립니다)"
  npm ci
  npm run build   # output: 'standalone'
fi

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
if [[ "$USE_CADDY" == 1 ]]; then
  set_env HOSTNAME "127.0.0.1"   # app is loopback-only; Caddy is the only way in
  # Remembered so `nimbo update` keeps the HTTPS mode. "auto" = re-detect the IP
  # on each update (self-heals a DHCP address change); otherwise the exact host.
  set_env NIMBO_CADDY "$([[ "$CADDY_AUTO" == 1 ]] && echo auto || echo "$CADDY_HOST")"
  # Origin allow-list for the terminal WS (CSWSH defense-in-depth). Scheme is
  # https because Caddy terminates TLS; :443 is omitted (default port).
  _origin="https://$CADDY_HOST"; [[ "$HTTPS_PORT" != "443" ]] && _origin="$_origin:$HTTPS_PORT"
  set_env NIMBO_ORIGIN "$_origin"
else
  set_env NIMBO_CADDY "none"
fi
# Stable session-signing secret (generated once).
grep -q "^NIMBO_SECRET=" "$ENV_DIR/nimbo.env" || \
  echo "NIMBO_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')" >> "$ENV_DIR/nimbo.env"

chown -R "$SVC_USER:$SVC_USER" "$APP_DIR" "$ENV_DIR"

# ── secret/key file permissions (하드닝) ──────────────────────────────────
# nimbo.env는 NIMBO_SECRET(세션 서명 키)를 담는다 → 소유자만 읽기.
chmod 600 "$ENV_DIR/nimbo.env"          # -rw-------  nimbo nimbo
# /etc/nimbo: world-readable 금지. nimbo가 소유(앱이 setup.json 등을 여기 기록).
# root:nimbo 750으로 두면 nimbo 그룹에 쓰기 권한이 없어 setup 마법사가 깨지므로,
# 'nimbo 소유 + 750'(others 차단)을 택한다.
chmod 750 "$ENV_DIR"                    # drwxr-x---  nimbo nimbo
# TLS 개인키가 들어가는 certs/ → nimbo 전용 700.
chmod 700 "$ENV_DIR/certs"              # drwx------  nimbo nimbo

# ── systemd (runs as the nimbo account) ──────────────────────────────────
echo "==> systemd 유닛 설치 (User=$SVC_USER)"
cp "$SRC/deploy/nimbo.service" /etc/systemd/system/nimbo.service
systemctl daemon-reload
systemctl enable --now nimbo

# ── interactive terminal PTY sidecar (libghostty terminal backend) ────────
# A tiny WebSocket<->PTY bridge (node-pty) on 127.0.0.1:3001. The reverse proxy
# routes /api/terminal/ws here. Kept separate so the native module never enters
# the web build. Requires a proxy (Caddy below) to reach the browser same-origin.
# BEST-EFFORT: node-pty is a native module; if its build fails we skip the
# Terminal app rather than aborting the whole install (set -e would otherwise
# kill it here, after the app but before Caddy/fail2ban).
echo "==> 터미널 PTY 사이드카 설치 (/opt/nimbo-terminal)"
TERM_DIR=/opt/nimbo-terminal
TERM_OK=0
systemctl stop nimbo-terminal 2>/dev/null || true   # re-run: don't hold stale code/port
rm -rf "$TERM_DIR"; mkdir -p "$TERM_DIR"
# Copy the whole dir — a prebuilt bundle ships node_modules (CI-built node-pty).
cp -r "$SRC/deploy/terminal-pty/." "$TERM_DIR/"

# node-pty loads? (prebuilt bundle on a matching arch → no rebuild needed)
term_ready() { node -e "require('$TERM_DIR/node_modules/node-pty')" >/dev/null 2>&1; }
term_build() {
  case "$PKG" in   # node-gyp needs a C/C++ toolchain
    dnf|yum) pkg_install gcc-c++ make python3 >/dev/null 2>&1 || true ;;
    apt)     pkg_install build-essential python3 >/dev/null 2>&1 || true ;;
  esac
  if [[ -f "$TERM_DIR/package-lock.json" ]]; then
    ( cd "$TERM_DIR" && npm ci --omit=dev --no-audit --no-fund )
  else
    ( cd "$TERM_DIR" && npm install --omit=dev --no-audit --no-fund )
  fi
}
if term_ready; then
  echo "   프리빌트 node-pty 사용 (재빌드 생략)"
  TERM_OK=1
elif term_build && term_ready; then
  TERM_OK=1
fi

if [[ "$TERM_OK" == 1 ]]; then
  chown -R "$SVC_USER:$SVC_USER" "$TERM_DIR"
  cp "$SRC/deploy/nimbo-terminal.service" /etc/systemd/system/nimbo-terminal.service
  systemctl daemon-reload
  systemctl enable nimbo-terminal >/dev/null 2>&1 || true
  systemctl restart nimbo-terminal || true
  echo "   nimbo-terminal.service 등록됨 (127.0.0.1:3001, 셸은 nimbo 권한 · sudo로 승격)"
else
  echo "   ⚠ node-pty 빌드 실패 — 터미널 앱을 건너뜁니다(나머지 설치는 계속). 빌드 도구 설치 후 재실행하면 활성화됩니다." >&2
fi

# ── Caddy (HTTPS) — default; skipped only with --no-caddy ────────────────
if [[ "$USE_CADDY" == 1 ]]; then
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
  # Port 80 backs Caddy's HTTP→HTTPS redirect and (for real domains) the ACME
  # HTTP challenge. If something else already owns it, Caddy may fail to bind or
  # certificate issuance may fail — warn loudly so a dead proxy isn't reported
  # as success. `tls internal` (IP hosts) doesn't need 80, so only warn there.
  if port_in_use 80; then
    if [[ "$CADDY_HOST" =~ ^[0-9.]+$ ]]; then
      echo "   ⚠ 80 포트 사용 중 — self-signed(tls internal)에는 무방하나 HTTP 리다이렉트는 동작 안 할 수 있습니다." >&2
    else
      echo "   ⚠ 80 포트 사용 중 — 다른 리버스 프록시가 있는 것 같습니다. Caddy의 TLS 발급(ACME)이 실패할 수 있습니다." >&2
      echo "     기존 프록시를 쓰려면 Caddy 없이 설치하고, 그 프록시에서 다음을 라우팅하세요:" >&2
      echo "       /api/terminal/ws → 127.0.0.1:3001   ·   그 외 → 127.0.0.1:$PORT" >&2
    fi
  fi
  # A real domain gets a Let's Encrypt cert, which needs the 80/443 ACME
  # challenge — impossible if we were bumped off 443. Warn (self-signed IP is fine).
  if [[ ! "$CADDY_HOST" =~ ^[0-9.]+$ && "$HTTPS_PORT" != "443" ]]; then
    echo "   ⚠ 도메인 인증서(Let's Encrypt)는 443 챌린지가 필요한데 HTTPS 포트가 $HTTPS_PORT 입니다 —" >&2
    echo "     자동 발급이 실패할 수 있습니다. 443을 비우고 재설치하거나 DNS 챌린지를 구성하세요." >&2
  fi
  local_site="$CADDY_HOST"; [[ "$HTTPS_PORT" != "443" ]] && local_site="$CADDY_HOST:$HTTPS_PORT"
  [[ "$CADDY_HOST" =~ ^[0-9.]+$ ]] && TLS_LINE="  tls internal" || TLS_LINE=""
  cat > /etc/caddy/Caddyfile <<EOF
$local_site {
$TLS_LINE
  encode zstd gzip
  # 보안 헤더: HSTS + 클릭재킹/MIME 스니핑 방지 (데스크톱-메타포 UI → frame-ancestors).
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Frame-Options DENY
    X-Content-Type-Options nosniff
    Referrer-Policy no-referrer
    Content-Security-Policy "frame-ancestors 'none'"
  }
  # Interactive terminal WebSocket -> PTY sidecar; everything else -> the app.
  # header_up overwrites X-Forwarded-For with the real client so the app can't
  # be fed a spoofed leftmost XFF value (login IP allow-list / fail2ban target).
  handle /api/terminal/ws {
    reverse_proxy 127.0.0.1:3001 {
      header_up X-Forwarded-For {remote_host}
    }
  }
  handle {
    reverse_proxy 127.0.0.1:$PORT {
      header_up X-Forwarded-For {remote_host}
    }
  }
}
EOF
  # Open the HTTPS port (and 80 for the redirect/ACME) on whichever firewall runs.
  if command -v firewall-cmd >/dev/null; then
    firewall-cmd --add-port="$HTTPS_PORT"/tcp --permanent >/dev/null 2>&1 || true
    [[ "$CADDY_HOST" =~ ^[0-9.]+$ ]] || firewall-cmd --add-port=80/tcp --permanent >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
  elif command -v ufw >/dev/null; then
    ufw allow "$HTTPS_PORT"/tcp >/dev/null 2>&1 || true
    [[ "$CADDY_HOST" =~ ^[0-9.]+$ ]] || ufw allow 80/tcp >/dev/null 2>&1 || true
  fi
  systemctl enable caddy >/dev/null 2>&1 || true
  systemctl restart caddy 2>/dev/null || systemctl start caddy 2>/dev/null || true
  # Don't report success for a Caddy that failed to start/bind.
  if systemctl is-active --quiet caddy; then
    echo "   Caddy 실행 중 ($local_site → 127.0.0.1:$PORT)"
  else
    echo "   ⚠ Caddy가 시작되지 않았습니다 — 로그 확인: journalctl -u caddy -n 50 --no-pager" >&2
    echo "     (포트 충돌이면 --caddy 대신 기존 프록시에서 /api/terminal/ws → :3001, 그 외 → :$PORT 라우팅)" >&2
  fi
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

# ── management CLI (nimbo status/logs/update/uninstall) ──────────────────
# /usr/local/bin for interactive use (in every user's PATH); a /usr/sbin symlink
# so `sudo nimbo` resolves too (RHEL's sudo secure_path omits /usr/local/bin).
if install -m 0755 "$SRC/deploy/nimbo-cli.sh" /usr/local/bin/nimbo 2>/dev/null; then
  ln -sf /usr/local/bin/nimbo /usr/sbin/nimbo 2>/dev/null || true
  echo "==> 'nimbo' 명령 설치됨 (nimbo help)"
else
  echo "⚠ nimbo CLI 설치 실패 (/usr/local/bin 쓰기 불가)" >&2
fi

# ── done ─────────────────────────────────────────────────────────────────
echo ""
echo "✅ 완료. (서비스 계정: $SVC_USER, passwordless sudo)"
echo "   상태:   nimbo status   ·   로그: nimbo logs   ·   제거: sudo nimbo uninstall"
if [[ "$USE_CADDY" == 1 ]]; then
  echo "   접속:   https://$CADDY_HOST$([[ "$HTTPS_PORT" != 443 ]] && echo ":$HTTPS_PORT")"
  [[ "$CADDY_HOST" =~ ^[0-9.]+$ ]] && echo "           (자체 서명 인증서 — 브라우저 경고가 뜨면 '고급 → 계속 진행'으로 접속)"
else
  echo "   접속:   앱은 127.0.0.1:$PORT 에서만 수신합니다 — 앞단 리버스 프록시를 통해 접속하세요."
  echo "           (LAN 직접 접속이 필요하면 /etc/nimbo/nimbo.env 의 HOSTNAME=0.0.0.0 로 바꾸고 sudo systemctl restart nimbo)"
fi
echo "   로그인: 이 서버의 OS 계정(root 등)으로 로그인"
# The Terminal app talks to the sidecar over /api/terminal/ws (same-origin).
# Caddy wires that automatically; with --no-caddy the operator's own proxy must.
if [[ "$TERM_OK" == "1" && "$USE_CADDY" == 0 ]]; then
  echo ""
  echo "ℹ 터미널 앱: 리버스 프록시에서 WebSocket 경로를 라우팅해야 동작합니다."
  echo "   /api/terminal/ws → 127.0.0.1:3001  (그 외 → 127.0.0.1:$PORT)"
  echo "   nginx 예시:"
  echo "     location /api/terminal/ws { proxy_pass http://127.0.0.1:3001;"
  echo "       proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade;"
  echo "       proxy_set_header Connection \"upgrade\"; proxy_set_header Host \$host; }"
  echo "   교차 출처 차단(권장): /etc/nimbo/nimbo.env 에 NIMBO_ORIGIN=https://<your-host> 추가 후"
  echo "     sudo systemctl restart nimbo-terminal"
fi
