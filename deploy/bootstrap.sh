#!/usr/bin/env bash
# Nimbo one-line bootstrap. Fetches Nimbo and runs the one-shot installer.
#
# By default it downloads a PREBUILT release bundle (no build on the server —
# fast), and falls back to cloning the source and building if no release/bundle
# is available. Either way the installer sets up systemd + Caddy(HTTPS/443).
#
# 기본값은 Caddy(HTTPS/443): 서버 IP를 자동 감지해 self-signed 인증서로 https://<ip> 제공.
#   curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash
#
# Pass installer args through after `-s --`:
#   --caddy <domain>  실제 도메인에 Let's Encrypt 인증서(https://domain)
#   --no-caddy        Caddy 생략 (직접 리버스 프록시 운영 시). 앱은 http://<ip>:PORT
#   e.g.  curl -fsSL .../bootstrap.sh | sudo bash -s -- --caddy nas.example.com
#
# Env overrides: NIMBO_DIST_URL (prebuilt tarball), NIMBO_REPO (source),
#   NIMBO_DIR (install source dir), NIMBO_SOURCE=1 (force source build).
set -euo pipefail

REPO="${NIMBO_REPO:-https://github.com/seongilp/nimbo}"
DIST_URL="${NIMBO_DIST_URL:-https://github.com/seongilp/nimbo/releases/latest/download/nimbo-dist.tar.gz}"
DIR="${NIMBO_DIR:-/opt/nimbo-src}"

if [[ $EUID -ne 0 ]]; then
  echo "root로 실행하세요:  curl -fsSL .../bootstrap.sh | sudo bash" >&2
  exit 1
fi

# ── try the prebuilt release bundle first (no server build) ───────────────
fetch_prebuilt() {
  [[ "${NIMBO_SOURCE:-0}" == "1" ]] && return 1
  command -v curl >/dev/null || return 1
  command -v tar  >/dev/null || return 1
  echo "==> 프리빌트 릴리스 확인: $DIST_URL"
  local tmp; tmp=$(mktemp -d)
  if curl -fsSL "$DIST_URL" -o "$tmp/nimbo-dist.tar.gz" 2>/dev/null; then
    rm -rf "$DIR"; mkdir -p "$DIR"
    if tar -xzf "$tmp/nimbo-dist.tar.gz" -C "$DIR" 2>/dev/null && [[ -f "$DIR/PREBUILT" ]]; then
      rm -rf "$tmp"
      echo "==> 프리빌트 번들 사용 (버전: $(cat "$DIR/PREBUILT" 2>/dev/null || echo '?'), 서버 빌드 없음)"
      return 0
    fi
  fi
  rm -rf "$tmp"
  return 1
}

# ── otherwise clone the source and build on the server ────────────────────
fetch_source() {
  if ! command -v git >/dev/null; then
    if command -v dnf >/dev/null; then dnf install -y git
    elif command -v apt-get >/dev/null; then export DEBIAN_FRONTEND=noninteractive; apt-get install -y git
    elif command -v yum >/dev/null; then yum install -y git
    else echo "git 설치 실패 — 수동 설치 필요" >&2; exit 1; fi
  fi
  if [[ -d "$DIR/.git" ]]; then
    echo "==> 기존 소스 업데이트: $DIR"
    git -C "$DIR" fetch --depth 1 origin main && git -C "$DIR" reset --hard origin/main
  else
    echo "==> 소스 클론(서버에서 빌드): $REPO → $DIR"
    rm -rf "$DIR"
    git clone --depth 1 "$REPO" "$DIR"
  fi
}

fetch_prebuilt || fetch_source

cd "$DIR"
chmod +x deploy/install.sh
exec ./deploy/install.sh "$@"
