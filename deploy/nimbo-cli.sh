#!/usr/bin/env bash
# Nimbo management CLI — installed to /usr/local/bin/nimbo by install.sh.
# Self-contained: does NOT depend on /opt/nimbo-src (which `uninstall` removes).
set -euo pipefail

BOOTSTRAP="${NIMBO_BOOTSTRAP:-https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh}"
ENV_FILE=/etc/nimbo/nimbo.env
CADDYFILE=/etc/caddy/Caddyfile

need_root() { [[ $EUID -eq 0 ]] || { echo "root 권한이 필요합니다:  sudo nimbo $1" >&2; exit 1; }; }

cmd_status() {
  systemctl status nimbo nimbo-terminal caddy --no-pager 2>/dev/null || true
}

cmd_logs() {
  local unit
  case "${1:-app}" in
    app|"") unit="nimbo" ;;
    term|terminal) unit="nimbo-terminal" ;;
    caddy) unit="caddy" ;;
    *) unit="$1" ;;
  esac
  exec journalctl -u "$unit" -f
}

cmd_restart() {
  need_root restart
  systemctl restart nimbo 2>/dev/null || true
  systemctl restart nimbo-terminal 2>/dev/null || true
  systemctl is-active --quiet caddy && systemctl reload caddy 2>/dev/null || true
  echo "재시작 완료:"
  systemctl is-active nimbo nimbo-terminal 2>/dev/null || true
}

cmd_url() {
  if systemctl is-active --quiet caddy && [[ -f "$CADDYFILE" ]]; then
    echo "https://$(awk 'NF{gsub(/ *\{.*/,"");print;exit}' "$CADDYFILE")"
  else
    # `|| true`: grep exits non-zero on no-match; without it set -e/pipefail
    # would abort before the ${port:-3000} fallback runs.
    local port; port=$(grep -oE '^PORT=.*' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
    echo "http://<this-host>:${port:-3000}   (자체 프록시/직접 접속)"
  fi
}

cmd_update() {
  need_root update
  # Preserve the install's HTTPS mode across updates.
  #   NIMBO_CADDY = "auto" (re-detect IP) | "none" (--no-caddy) | "<host>" (--caddy host)
  # `|| true`: a legacy install has no NIMBO_CADDY line; grep's exit 1 must not
  # abort under set -e/pipefail (else `nimbo update` silently no-ops).
  local mode args=()
  mode=$(grep -oE '^NIMBO_CADDY=.*' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
  if [[ -z "$mode" ]]; then
    # Legacy install: infer from the Caddyfile (present → keep Caddy+host; absent → own proxy).
    if [[ -f "$CADDYFILE" ]]; then
      mode=$(awk 'NF{gsub(/ *\{.*/,"");gsub(/:.*/,"");print;exit}' "$CADDYFILE")
    else
      mode=none
    fi
  fi
  case "$mode" in
    auto) : ;;                    # re-detect the current IP → no --caddy arg
    none) args=(--no-caddy) ;;
    *)    args=(--caddy "$mode") ;;
  esac
  echo "==> 최신 버전으로 업데이트 (HTTPS: ${mode:-자동})"
  # ${args[@]+...} keeps set -u happy when args is empty (bash < 4.4 safe).
  curl -fsSL "$BOOTSTRAP" | bash -s -- ${args[@]+"${args[@]}"}
}

cmd_uninstall() {
  need_root uninstall
  local purge=0 yes=0
  for a in "$@"; do
    case "$a" in
      --purge) purge=1 ;;
      --yes|-y) yes=1 ;;
    esac
  done
  if [[ $yes == 0 && -e /dev/tty ]]; then
    local ans=""
    read -rp "Nimbo를 제거합니다$([[ $purge == 1 ]] && echo ' (--purge: 설정·계정·저장소·방화벽까지 완전 삭제)'). 계속할까요? [y/N] " ans < /dev/tty || true
    [[ "$ans" =~ ^[yY]$ ]] || { echo "취소했습니다."; exit 0; }
  fi

  # Read the HTTPS port from the Caddyfile BEFORE removing anything, so --purge
  # can also close the firewall port the installer opened. Handles ":10443",
  # "host:10443" and a bare "host" (→ 443) site addresses.
  local https_port=""
  if [[ -f "$CADDYFILE" ]]; then
    https_port=$(awk '/^[^[:space:]{}]/ && /\{/ { s=$1; sub(/\{.*/,"",s); n=s; sub(/^.*:/,"",n); if (n ~ /^[0-9]+$/) print n; else print 443; exit }' "$CADDYFILE" 2>/dev/null)
  fi

  echo "==> 서비스 중지·비활성화 (nimbo · nimbo-terminal · caddy)"
  systemctl disable --now nimbo 2>/dev/null || true
  systemctl disable --now nimbo-terminal 2>/dev/null || true
  # install.sh re-enables Caddy on every (re)install, so disabling here is
  # reversible — and it frees the HTTPS port + stops boot-time restarts (no more
  # orphan Caddy holding the port and returning 502).
  systemctl disable --now caddy 2>/dev/null || true
  rm -f /etc/systemd/system/nimbo.service /etc/systemd/system/nimbo-terminal.service
  systemctl daemon-reload 2>/dev/null || true

  echo "==> fail2ban jail 제거"
  rm -f /etc/fail2ban/jail.d/nimbo.conf /etc/fail2ban/filter.d/nimbo.conf
  systemctl reload fail2ban 2>/dev/null || true

  echo "==> 앱·터미널·소스·sudo 규칙·CLI 삭제"
  rm -rf /opt/nimbo /opt/nimbo-terminal /opt/nimbo-src
  rm -f /etc/sudoers.d/nimbo
  rm -f /usr/local/bin/nimbo /usr/sbin/nimbo

  if [[ $purge == 1 ]]; then
    echo "==> (purge) 설정·인증서·서비스 계정·Caddy 설정 삭제"
    rm -rf /etc/nimbo
    userdel -r nimbo 2>/dev/null || true
    rm -f "$CADDYFILE"

    echo "==> (purge) 설치 시 추가한 패키지 저장소·키 삭제"
    rm -f /etc/apt/sources.list.d/nodesource.list /usr/share/keyrings/nodesource.gpg
    rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    rm -f /etc/yum.repos.d/nodesource*.repo 2>/dev/null || true
    rm -f /etc/yum.repos.d/*caddy*.repo 2>/dev/null || true

    if [[ -n "$https_port" ]]; then
      echo "==> (purge) 방화벽 포트 정리 (${https_port}/tcp · 80/tcp)"
      if command -v firewall-cmd >/dev/null; then
        firewall-cmd --remove-port="$https_port"/tcp --permanent >/dev/null 2>&1 || true
        firewall-cmd --remove-port=80/tcp --permanent >/dev/null 2>&1 || true
        firewall-cmd --reload >/dev/null 2>&1 || true
      elif command -v ufw >/dev/null; then
        ufw delete allow "$https_port"/tcp >/dev/null 2>&1 || true
        ufw delete allow 80/tcp >/dev/null 2>&1 || true
      fi
    fi

    echo "✅ 완전 제거 완료."
    echo "   ℹ 시스템 패키지(Node.js·Caddy·fail2ban)는 다른 용도로 쓰일 수 있어 남겨둡니다."
    echo "     직접 지우려면:  apt remove --purge caddy nodejs fail2ban   (dnf 계열은 dnf remove …)"
    echo "   ℹ SSH 보호용 /etc/fail2ban/jail.d/sshd.local 은 보안상 남겨둡니다."
  else
    echo "✅ 제거 완료."
    echo "   보존됨(재설치 시 재사용): /etc/nimbo(NIMBO_SECRET·users.json·IP 허용목록) · nimbo 계정 · Caddyfile · 패키지 저장소."
    echo "   완전 삭제(위 항목 + 저장소·방화벽 정리):  sudo nimbo uninstall --purge"
  fi
}

cmd_help() {
  cat <<'H'
Nimbo 관리 CLI

  nimbo status                 서비스 상태 (nimbo · nimbo-terminal · caddy)
  nimbo logs [app|term|caddy]  로그 팔로우 (기본: app)
  nimbo restart                서비스 재시작                    (sudo)
  nimbo update                 최신 버전으로 업데이트            (sudo)
  nimbo url                    접속 주소 출력
  nimbo uninstall [--purge] [--yes]  제거 (--purge: 설정·계정까지, --yes: 확인 생략) (sudo)
  nimbo help                   이 도움말
H
}

case "${1:-help}" in
  status)          cmd_status ;;
  logs|log)        shift || true; cmd_logs "${1:-}" ;;
  restart)         cmd_restart ;;
  update|upgrade)  cmd_update ;;
  url)             cmd_url ;;
  uninstall|remove) shift || true; cmd_uninstall "$@" ;;
  help|-h|--help)  cmd_help ;;
  *) echo "알 수 없는 명령: $1" >&2; cmd_help; exit 1 ;;
esac
