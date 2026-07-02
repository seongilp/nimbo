# Nimbo 설치 가이드

리눅스 서버를 NAS처럼 관리하는 셀프호스팅 콘솔, **Nimbo** 설치 문서입니다.
대부분 **한 줄**이면 끝납니다. 설치 후 사용법은 [MANUAL.md](MANUAL.md),
고급 배포·프록시 설정은 [DEPLOYMENT.md](DEPLOYMENT.md)를 보세요.

- [1. 요구 사항](#1-요구-사항)
- [2. 빠른 설치 (한 줄)](#2-빠른-설치-한-줄)
- [3. HTTPS로 설치 (권장)](#3-https로-설치-권장)
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

배포판을 감지해 Node.js·git 설치 → 빌드 → systemd 서비스 등록까지 자동으로 진행합니다.
끝나면 접속 주소가 출력됩니다:

```
✅ 완료.
   접속:   http://<서버-IP>:3000
```

> 평문 HTTP입니다. 실제 사용 전에는 아래 **HTTPS 설치**를 권장합니다.

---

## 3. HTTPS로 설치 (권장)

`--caddy` 뒤에 **도메인** 또는 **서버 IP**를 주면, Caddy 리버스 프록시가 443에서
TLS를 종료하고 인증서를 자동으로 처리합니다.

```bash
# 공개 도메인이 있을 때 (진짜 Let's Encrypt 인증서)
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash -s -- --caddy nas.example.com

# LAN 전용, 도메인 없이 IP만 (Caddy 자체 서명 인증서)
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash -s -- --caddy 192.168.0.10
```

접속 주소는 `https://나스도메인` 또는 `https://<서버-IP>` (443)이 됩니다.
IP로 설치하면 자체 서명 인증서라 브라우저가 경고를 냅니다 → [8번](#8-설치-문제-해결) 참고.

> **이미 80/443을 다른 웹서버가 쓰고 있다면** `--caddy`를 빼고 설치한 뒤, 기존
> 프록시(nginx 등)에서 Nimbo로 라우팅하세요. 방법은 [DEPLOYMENT.md](DEPLOYMENT.md)에
> 있습니다(터미널용 WebSocket 경로 `/api/terminal/ws → 127.0.0.1:3001` 포함).

---

## 4. 설치 후 첫 접속 · 로그인

1. 출력된 주소로 접속합니다 (`http://<IP>:3000` 또는 `https://...`).
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

- Node.js 20 · git · (필요 시) 빌드 도구 설치
- 앱 빌드 후 `/opt/nimbo`에 설치, 전용 서비스 계정 `nimbo` 생성
- systemd 서비스 등록:
  - `nimbo.service` — 웹 앱 (`127.0.0.1:3000`)
  - `nimbo-terminal.service` — 터미널 PTY 브리지 (`127.0.0.1:3001`)
- `--caddy` 사용 시: Caddy 설치·설정(443) + 방화벽 포트 개방
- fail2ban 설정(로그인 무차별 대입 차단)

설정·비밀 파일은 `/etc/nimbo/`에 저장됩니다(`nimbo.env`, `users.json`, 인증서 등).

---

## 6. 업데이트

최신 버전으로 올리려면 **설치 명령을 다시 실행**하면 됩니다. 소스를 새로 받아
다시 빌드하고 서비스를 재시작합니다(설정·데이터는 유지).

```bash
# HTTP로 설치했다면
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash

# --caddy로 설치했다면 같은 인자를 다시 주세요
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash -s -- --caddy nas.example.com
```

---

## 7. 제거

`install.sh`가 설치한 것을 되돌립니다. root로 실행하세요.

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

---

## 8. 설치 문제 해결

**포트가 이미 사용 중** — 설치 스크립트가 대체 포트를 물어보거나 자동으로 올립니다.
`--caddy`에서 80/443을 다른 프로그램이 쓰면 경고가 나옵니다. 기존 프록시를 쓰려면
`--caddy` 없이 설치하고 그 프록시에서 라우팅하세요([DEPLOYMENT.md](DEPLOYMENT.md)).

**인증서 경고(안전하지 않음)** — IP/LAN 설치는 Caddy 자체 서명이라 정상입니다.
그냥 진행하려면 브라우저에서 **고급 → 계속 진행**. 경고를 없애려면 서버의 Caddy 루트 CA
(`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`)를 접속 PC의
신뢰할 수 있는 루트 인증 기관에 등록하세요.

**터미널 앱이 열리는데 연결 안 됨** — `--caddy`로 설치하면 자동 설정됩니다. 자체 프록시라면
`/api/terminal/ws → 127.0.0.1:3001` WebSocket 라우팅이 필요합니다([DEPLOYMENT.md](DEPLOYMENT.md)).
사이드카 상태: `systemctl status nimbo-terminal`.

**설치 중 터미널 빌드 실패 경고** — node-pty 네이티브 빌드가 실패해도 나머지 설치는
계속되고 터미널 앱만 비활성화됩니다. 빌드 도구(gcc-c++·make·python3) 설치 후
설치를 다시 실행하면 활성화됩니다.

**서비스 상태 확인**
```bash
systemctl status nimbo
journalctl -u nimbo -n 50 --no-pager
systemctl status caddy          # --caddy로 설치한 경우
```

---

문의·이슈: https://github.com/seongilp/nimbo/issues
설치 후 사용법: [MANUAL.md](MANUAL.md) · 고급 배포: [DEPLOYMENT.md](DEPLOYMENT.md)
