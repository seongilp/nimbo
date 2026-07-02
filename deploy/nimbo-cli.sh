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
    read -rp "Nimbo를 제거합니다$([[ $purge == 1 ]] && echo ' (--purge: 설정·계정까지 완전 삭제)'). 계속할까요? [y/N] " ans < /dev/tty || true
    [[ "$ans" =~ ^[yY]$ ]] || { echo "취소했습니다."; exit 0; }
  fi

  echo "==> 서비스 중지·비활성화"
  systemctl disable --now nimbo 2>/dev/null || true
  systemctl disable --now nimbo-terminal 2>/dev/null || true
  rm -f /etc/systemd/system/nimbo.service /etc/systemd/system/nimbo-terminal.service
  systemctl daemon-reload 2>/dev/null || true

  echo "==> fail2ban jail 제거"
  rm -f /etc/fail2ban/jail.d/nimbo.conf /etc/fail2ban/filter.d/nimbo.conf
  systemctl reload fail2ban 2>/dev/null || true

  echo "==> 앱·터미널·소스·sudo 규칙 삭제"
  rm -rf /opt/nimbo /opt/nimbo-terminal /opt/nimbo-src
  rm -f /etc/sudoers.d/nimbo

  if [[ $purge == 1 ]]; then
    echo "==> (purge) 설정·인증서·서비스 계정·Caddy 설정 삭제"
    rm -rf /etc/nimbo
    userdel -r nimbo 2>/dev/null || true
    rm -f "$CADDYFILE"
    systemctl reload caddy 2>/dev/null || systemctl stop caddy 2>/dev/null || true
  else
    echo "   보존됨: /etc/nimbo (NIMBO_SECRET·로그인 IP 허용목록·users.json) · nimbo 계정 · Caddy."
    echo "   ⚠ Caddy는 계속 443을 점유하지만 앱이 없어 502가 납니다. 보안 리셋/완전 삭제는:  sudo nimbo uninstall --purge"
    echo "   (참고) /etc/fail2ban/jail.d/sshd.local 은 SSH 보호용이라 남겨둡니다."
  fi
  rm -f /usr/local/bin/nimbo /usr/sbin/nimbo
  echo "✅ 제거 완료."
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
  uninstall|remove) shift || true; cmd_uninstall "${1:-}" ;;
  help|-h|--help)  cmd_help ;;
  *) echo "알 수 없는 명령: $1" >&2; cmd_help; exit 1 ;;
esac
