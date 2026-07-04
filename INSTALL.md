# Nimbo 설치 가이드

리눅스 서버를 NAS처럼 관리하는 셀프호스팅 콘솔, **Nimbo** 설치 문서입니다.
대부분 **한 줄**이면 끝납니다. 설치 후 사용법은 [MANUAL.md](MANUAL.md),
고급 배포·프록시 설정은 [DEPLOYMENT.md](DEPLOYMENT.md)를 보세요.

- [1. 요구 사항](#1-요구-사항)
- [2. 빠른 설치 (한 줄)](#2-빠른-설치-한-줄)
- [3. 설치 옵션](#3-설치-옵션)
- [4. 설치 후 첫 접속 · 로그인](#4-설치-후-첫-접속--로그인)
- [5. 설치가 해주는 일](#5-설치가-해주는-일)
- [6. 업데이트](#6-업데이트)
- [7. 제거](#7-제거)
- [8. 설치 문제 해결](#8-설치-문제-해결)

---

## 1. 요구 사항

- **OS**: systemd 기반 64-bit 리눅스 — RHEL · Rocky · CentOS · Ubuntu · Debian (배포판 자동 감지)
- **권한**: `root` 또는 `sudo`
- **네트워크**: 인터넷 연결 (Node.js·Caddy 설치용)
- 그 외 의존성(Node.js·git·빌드 도구)은 설치 스크립트가 알아서 설치합니다.

> Docker는 **필요 없습니다.** Nimbo는 systemd 서비스로 직접 실행됩니다.
> (셀프호스팅 앱 설치 기능을 쓸 때만 Docker가 필요합니다.)

---

## 2. 빠른 설치 (한 줄)

서버에 SSH로 접속한 뒤 아래 한 줄을 실행하세요.

```bash
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash
```

배포판을 감지해 Node.js·git 설치 → 빌드 → systemd 서비스 등록 → Caddy(HTTPS) 설정까지
자동으로 진행합니다. 서버의 기본 IP를 자동으로 찾아 **443 포트에서 HTTPS**로 서비스합니다
(IP 접속은 Caddy 자체 서명 인증서 `tls internal`). 끝나면 접속 주소가 출력됩니다:

```
✅ 완료.
   접속:   https://<서버-IP>
```

> IP 접속은 자체 서명 인증서라 브라우저가 경고를 냅니다 → [8번](#8-설치-문제-해결) 참고.
> 앱은 `127.0.0.1:3000`(로컬 전용)에 바인딩되며, 3000 포트는 외부에 직접 열리지 않습니다.
> 도메인 인증서·자체 프록시·포트 충돌 대응은 아래 **[3. 설치 옵션](#3-설치-옵션)** 참고.

---

## 3. 설치 옵션

기본 설치는 서버 IP에 **자체 서명 HTTPS**를 붙입니다. 상황에 맞게 아래 옵션을 쓰세요.

```bash
# 공개 도메인이 있을 때 (진짜 Let's Encrypt 인증서)
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash -s -- --caddy nas.example.com

# 특정 IP에 자체 서명 인증서를 명시할 때
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash -s -- --caddy 192.168.0.10

# Caddy 없이 설치 (직접 리버스 프록시를 운영할 때)
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash -s -- --no-caddy
```

- **`--caddy <도메인>`** → 그 도메인에 Let's Encrypt 인증서 발급, `https://도메인`으로 접속.
- **`--caddy <IP>`** → 그 IP에 자체 서명 인증서, `https://<IP>`로 접속.
- **`--no-caddy`** → Caddy를 건너뜁니다. 앱이 `http://<IP>:PORT`로 직접 열리며, 기존
  프록시(nginx 등)에서 Nimbo로 라우팅해야 합니다. 이때 터미널용 WebSocket 경로
  `/api/terminal/ws → 127.0.0.1:3001`도 직접 연결해야 합니다([DEPLOYMENT.md](DEPLOYMENT.md)).

IP로 설치하면 자체 서명 인증서라 브라우저가 경고를 냅니다 → [8번](#8-설치-문제-해결) 참고.

> **포트 충돌 시** — 443이 이미 쓰이면 자동으로 **10443**을 씁니다. 10443도 막혀 있으면
> 설치 중에 사용할 포트를 물어봅니다.

---

## 4. 설치 후 첫 접속 · 로그인

1. 출력된 주소(`https://<서버-IP>` 또는 `https://도메인`)로 접속합니다.
2. **서버의 OS 계정**으로 로그인합니다. 별도 회원가입은 없습니다.
   - 사용자명: 리눅스 계정 (예: 본인 계정 또는 `root`)
   - 비밀번호: 그 계정의 리눅스 비밀번호

> ⚠️ **중요 — 첫 로그인은 특별합니다 (베타 사용자 필독)**
> - **처음 로그인한 계정이 관리자**가 됩니다.
> - 그때 접속한 **네트워크(/24)가 접속 허용 IP로 자동 등록**되고, 이후 로그인은
>   그 대역에서만 가능합니다. → **실제로 사용할 네트워크에서 첫 로그인을 하세요.**
> - 이후엔 관리자와 관리자가 추가한 계정만 로그인할 수 있습니다.
> - 허용 IP·계정은 로그인 후 **Users → Nimbo 접근**에서 추가/변경할 수 있습니다.
>   (VPN·Tailscale로도 접속한다면 그 IP도 추가하세요.)
> - IP를 잘못 설정해 잠기면: 서버에서 `/etc/nimbo/users.json`의 `allowedCidrs`를
>   비우고 `sudo systemctl restart nimbo`로 복구합니다.

터미널 앱은 **로그인한 계정 권한**으로 열립니다(관리자 전용).

---

## 5. 설치가 해주는 일

- **프리빌트 릴리스 번들을 내려받아 설치** — 서버에서 빌드하지 않아 빠릅니다.
  릴리스가 없거나 받기 실패하면 소스를 받아 서버에서 빌드하는 방식으로 자동 폴백합니다
  (`NIMBO_SOURCE=1`로 강제 소스 빌드).
- Node.js 20(≥20.9) · git · `python3`(+시스템 `libcrypt` — OS 비밀번호 검증에 필요) · (필요 시) 빌드 도구 설치
- 앱 빌드 후 `/opt/nimbo`에 설치, 전용 서비스 계정 `nimbo` 생성
- systemd 서비스 등록:
  - `nimbo.service` — 웹 앱 (`127.0.0.1:3000`)
  - `nimbo-terminal.service` — 터미널 PTY 브리지 (`127.0.0.1:3001`)
- Caddy 설치·설정(HTTPS, 기본 443 · 충돌 시 10443 등) + 방화벽 포트 개방 (`--no-caddy`면 생략)
- 관리 CLI 설치: `/usr/local/bin/nimbo` (`status`·`logs`·`restart`·`update`·`url`·`uninstall`)
- fail2ban 설정(로그인 무차별 대입 차단)

설정·비밀 파일은 `/etc/nimbo/`에 저장됩니다(`nimbo.env`, `users.json`, 인증서 등).

---

## 6. 업데이트

관리 CLI로 최신 버전으로 올립니다. **프리빌트 릴리스 번들을 내려받아** 교체하고
서비스를 재시작합니다(서버 빌드 없이 빠름 · 설정·데이터는 유지). 릴리스를 받지
못하면 소스를 받아 서버에서 빌드하는 방식으로 자동 폴백합니다.

```bash
sudo nimbo update
```

> 설치 명령(위 한 줄)을 같은 인자로 다시 실행해도 됩니다.

---

## 7. 제거

한 줄이면 됩니다. 서비스 중지·비활성화, systemd·fail2ban·sudo 규칙, 앱·소스까지 되돌립니다.

```bash
sudo nimbo uninstall
```

`--purge`를 붙이면 설정·인증서(`/etc/nimbo`), 서비스 계정 `nimbo`, `/etc/caddy/Caddyfile`까지
완전히 삭제합니다.

```bash
sudo nimbo uninstall --purge
```

<details>
<summary>수동 제거 (CLI를 못 쓸 때 대체)</summary>

root로 실행하세요.

```bash
# 서비스 중지 · 비활성화
sudo systemctl disable --now nimbo
sudo systemctl disable --now nimbo-terminal 2>/dev/null || true
sudo rm -f /etc/systemd/system/nimbo.service /etc/systemd/system/nimbo-terminal.service
sudo systemctl daemon-reload

# fail2ban jail 제거 (설치 시 추가된 경우)
sudo rm -f /etc/fail2ban/jail.d/nimbo.conf /etc/fail2ban/filter.d/nimbo.conf
sudo systemctl reload fail2ban 2>/dev/null || true

# 앱 · 터미널 사이드카 · 소스 · sudo 규칙 삭제
sudo rm -rf /opt/nimbo /opt/nimbo-terminal /opt/nimbo-src
sudo rm -f /etc/sudoers.d/nimbo

# (선택) 설정·인증서·서비스 계정까지 완전 삭제
# sudo rm -rf /etc/nimbo
# sudo userdel -r nimbo 2>/dev/null || true
# sudo rm -f /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

</details>

---

## 8. 설치 문제 해결

**포트가 이미 사용 중** — 443이 쓰이면 자동으로 **10443**, 그것도 막혀 있으면 설치 중에
사용할 포트를 물어봅니다. 기존 웹서버(nginx 등)를 그대로 쓰려면 `--no-caddy`로 설치하고
그 프록시에서 Nimbo로 라우팅하세요([DEPLOYMENT.md](DEPLOYMENT.md)).

**인증서 경고(안전하지 않음)** — IP/LAN 설치는 Caddy 자체 서명이라 정상입니다.
그냥 진행하려면 브라우저에서 **고급 → 계속 진행**. 경고를 없애려면 서버의 Caddy 루트 CA
(`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`)를 접속 PC의
신뢰할 수 있는 루트 인증 기관에 등록하세요.

**터미널 앱이 열리는데 연결 안 됨** — 기본(Caddy) 설치에서는 자동 설정됩니다. `--no-caddy`로
자체 프록시를 쓴다면 `/api/terminal/ws → 127.0.0.1:3001` WebSocket 라우팅이 필요합니다([DEPLOYMENT.md](DEPLOYMENT.md)).
사이드카 상태: `systemctl status nimbo-terminal`.

**설치 중 터미널 빌드 실패 경고** — node-pty 네이티브 빌드가 실패해도 나머지 설치는
계속되고 터미널 앱만 비활성화됩니다. 빌드 도구(gcc-c++·make·python3) 설치 후
설치를 다시 실행하면 활성화됩니다.

**로그인이 안 됨(비밀번호가 맞는데 거부)** — OS 비밀번호 검증에는 `python3`와 시스템
`libcrypt`가 필요합니다. 설치 스크립트가 자동으로 설치·검증하지만(안 되면 설치를
중단), 수동 환경이라면 `python3`와 `libxcrypt`(RHEL) 또는 `libcrypt1`(Debian/Ubuntu)를
설치하세요. 또 **첫 로그인한 IP 대역(/24)만 접속 허용**되므로([4번](#4-설치-후-첫-접속--로그인)),
다른 네트워크에서 접속하면 비밀번호가 맞아도 거부됩니다 — 허용 대역을 추가하거나
`/etc/nimbo/users.json`의 `allowedCidrs`를 비우고 `sudo systemctl restart nimbo`.

**서비스 상태 확인** — 간단하게는 `nimbo status` · `nimbo logs [app|term|caddy]`.
```bash
nimbo status
nimbo logs                      # 앱 로그 (nimbo logs term / caddy 도 가능)
systemctl status nimbo
journalctl -u nimbo -n 50 --no-pager
systemctl status caddy          # 기본 설치(Caddy)일 때
```

---

문의·이슈: https://github.com/seongilp/nimbo/issues
설치 후 사용법: [MANUAL.md](MANUAL.md) · 고급 배포: [DEPLOYMENT.md](DEPLOYMENT.md)
