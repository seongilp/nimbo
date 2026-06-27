#!/usr/bin/env bash
# Nimbo one-line bootstrap. Installs git if needed, clones the repo, and runs
# the one-shot installer (which installs Node.js, builds, and sets up systemd).
#
#   curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash
#
# Pass installer args through after `-s --`, e.g. HTTPS via Caddy:
#   curl -fsSL .../bootstrap.sh | sudo bash -s -- --caddy nas.lan
set -euo pipefail

REPO="${NIMBO_REPO:-https://github.com/seongilp/nimbo}"
DIR="${NIMBO_DIR:-/opt/nimbo-src}"

if [[ $EUID -ne 0 ]]; then
  echo "root로 실행하세요:  curl -fsSL .../bootstrap.sh | sudo bash" >&2
  exit 1
fi

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
  echo "==> 클론: $REPO → $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
chmod +x deploy/install.sh
exec ./deploy/install.sh "$@"
