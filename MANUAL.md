# Nimbo 사용자 매뉴얼

Nimbo는 리눅스 서버를 NAS처럼 관리하는 셀프호스팅 콘솔입니다. 브라우저 안에서
macOS 스타일 데스크톱으로 파일·ZFS 스토리지·백업·컨테이너·보안을 한곳에서 다룹니다.

이 문서는 **설치한 뒤 실제로 어떻게 쓰는지**를 순서대로 설명합니다.
개발/배포 세부는 [README.md](README.md) · [DEPLOYMENT.md](DEPLOYMENT.md)를 보세요.

- [1. 설치](#1-설치)
- [2. 접속하기 (포트 · HTTPS 인증서)](#2-접속하기-포트--https-인증서)
- [3. 첫 로그인과 초기 설정](#3-첫-로그인과-초기-설정)
- [4. 데스크톱 사용법](#4-데스크톱-사용법)
- [5. 앱별 안내](#5-앱별-안내)
- [6. 자주 하는 작업](#6-자주-하는-작업)
- [7. 보안](#7-보안)
- [8. 문제 해결](#8-문제-해결)
- [9. 제거](#9-제거)

---

## 1. 설치

서버(RHEL·Rocky·CentOS·Ubuntu·Debian)에 SSH로 접속한 뒤 **한 줄**이면 됩니다.
배포판을 자동 감지해 Node.js·git을 설치하고, 빌드하고, systemd 서비스로 등록합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash
```

### HTTPS까지 자동으로 (권장)

`--caddy` 뒤에 도메인 또는 서버 IP를 주면 Caddy 리버스 프록시가 443에서 TLS를
종료하고 인증서를 자동 발급합니다.

```bash
# 공개 도메인이 있을 때 (진짜 Let's Encrypt 인증서)
curl -fsSL .../bootstrap.sh | sudo bash -s -- --caddy nas.example.com

# LAN 전용, 도메인 없이 IP만 (Caddy 자체 서명 인증서 = tls internal)
curl -fsSL .../bootstrap.sh | sudo bash -s -- --caddy 192.168.0.10
```

### 설치가 해주는 일

- Node.js 20 · git · (필요 시) 빌드 도구 설치
- 앱 빌드 후 `/opt/nimbo` 에 설치, `nimbo` 전용 서비스 계정 생성
- `nimbo.service` (앱, 127.0.0.1:3000) · `nimbo-terminal.service` (터미널 PTY, 127.0.0.1:3001) 등록
- `--caddy` 시 Caddy 설정 + 방화벽 포트 개방
- fail2ban 잠금(로그인 무차별 대입 차단) 설정

> 포트가 이미 쓰이는 중이면 설치 스크립트가 대체 포트를 물어보거나 자동으로 올립니다.
> 터미널의 node-pty 빌드가 실패해도 나머지 설치는 계속되고, 터미널 앱만 비활성화됩니다.

---

## 2. 접속하기 (포트 · HTTPS 인증서)

| 설치 방식 | 접속 주소 |
| --- | --- |
| 기본 (프록시 없음) | `http://<서버-IP>:3000` |
| `--caddy 도메인` | `https://나스도메인` (443) |
| `--caddy IP` | `https://<서버-IP>` (443, 자체 서명 인증서) |

### 443 포트가 이미 쓰이는 경우

이미 다른 웹서버/리버스 프록시(nginx·Apache·기존 Caddy 등)가 80/443을 쓰고 있다면
Nimbo의 Caddy와 충돌합니다. 두 가지 선택:

1. **기존 프록시를 그대로 쓰기** — `--caddy` 없이 설치하고, 기존 프록시에서 아래처럼
   라우팅하세요. WebSocket 경로(터미널)를 **반드시 먼저** 넣어야 터미널 앱이 동작합니다.

   ```nginx
   location /api/terminal/ws {
       proxy_pass http://127.0.0.1:3001;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 86400s;
   }
   location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;   # 세션 쿠키 Secure 판정에 필요
   }
   ```

2. **다른 포트로 Caddy 실행** — 설치 중 HTTPS 포트를 443이 아닌 값(예: 8443)으로
   지정하면 `https://호스트:8443` 으로 접속합니다.

### 자체 서명 인증서 신뢰 (LAN·IP 설치)

도메인 없이 IP로 설치하면 Caddy가 자체 CA로 인증서를 만들기 때문에 브라우저가
"안전하지 않음" 경고를 냅니다. 정상입니다.

- 그냥 넘어가려면: 경고 화면에서 **고급 → 계속 진행**.
- 경고를 없애려면: 서버의 Caddy 루트 CA 인증서
  (`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`)를 내려받아
  접속하는 PC/브라우저의 신뢰할 수 있는 루트 인증 기관에 등록하세요.

---

## 3. 첫 로그인과 초기 설정

### 로그인

Nimbo는 **서버의 OS 계정**으로 로그인합니다. 별도 회원가입이 없습니다.

- 사용자명: 서버의 리눅스 계정 (예: `root`, 또는 본인 계정)
- 비밀번호: 그 계정의 리눅스 비밀번호

`root` 또는 sudo 권한이 있는 계정이 **관리자(admin)** 로 인식되어 시스템을 바꾸는
작업(서비스 제어, 디스크 교체, 터미널 등)을 할 수 있습니다.

### 설정 마법사

새 서버에서 처음 접속하면 설정 마법사가 뜹니다. 서버 이름, 기본 볼륨 경로 등을
확인하고 넘어가면 데스크톱이 나타납니다.
언제든 주소 끝에 `?setup=1` 을 붙이면 마법사를 다시 열 수 있습니다.

---

## 4. 데스크톱 사용법

Nimbo 화면은 브라우저 속 데스크톱입니다.

### 메뉴바 (상단)

- **왼쪽 위 Nimbo 메뉴** — 모든 앱 목록, 배경화면 바꾸기, 위젯 추가.
- **배경화면** — 기본 제공 배경 중 선택하거나, **내 이미지 업로드**로 사진을
  배경으로 지정할 수 있습니다(자동으로 크기를 줄여 브라우저에 저장). "내 이미지 제거"로 되돌립니다.
- **위젯 추가** — 바탕화면에 시계 · 시스템(CPU/메모리) · 가동시간 · 네트워크 위젯을 올립니다.

### 위젯

바탕화면 위젯은 **드래그로 옮길** 수 있고, 마우스를 올리면 나타나는 ✕ 로 제거합니다.
위치와 구성은 브라우저에 저장되어 다음에 열 때도 유지됩니다.

### 도크 (하단)

자주 쓰는 앱(즐겨찾기)이 놓입니다. 앱 아이콘을 눌러 실행합니다. 모바일에서는
아이콘 수가 줄어 화면에 맞게 표시됩니다.

### 윈도우

- 타이틀바를 잡고 **드래그**로 이동, 모서리로 **크기 조절**.
- 창 버튼으로 최소화 / 최대화 / 닫기.
- `Esc` — 앞의 메뉴/대화상자를 닫거나 현재 창을 최소화.

### ⌘K 커맨드 팔레트

`⌘K`(맥) / `Ctrl+K`(윈도우·리눅스)로 검색창을 열어 앱을 이름으로 빠르게 실행합니다.

---

## 5. 앱별 안내

| 앱 | 하는 일 |
| --- | --- |
| **Dashboard** | 시스템·CPU·메모리·스토리지·백업·보안 상태를 한 화면에 요약 |
| **File Station** | 파일시스템 탐색, Samba/NFS 공유 탐색, 업로드/다운로드/이동 |
| **ZFS** | 풀·데이터셋·스냅샷·복제·vdev·ARC 캐시 관리 |
| **Backup & Sync** | rsync 서버, rclone 클라우드(S3·Drive), Time Machine 타깃, 스케줄 |
| **Storage Manager** | 디스크·파티션·사용량, SMART 건강 상태, 온도 |
| **Disk Inventory** | 안정 식별자(serial/WWN) 기반 디스크 인벤토리, 결함, 부팅 전후 변경 이력, **교체 마법사** |
| **Resource Monitor** | CPU·메모리·네트워크 실시간 게이지 + 상위 프로세스 |
| **Container Manager** | Docker 컨테이너 상태·자원·포트, 시작/정지/재시작 |
| **System** | systemd 서비스·cron·로그 관리 |
| **Terminal** | 브라우저에서 인터랙티브 셸 실행 (관리자 전용, libghostty + PTY) |
| **Package Center** | Jellyfin·Immich·Nextcloud 등 셀프호스팅 앱 원클릭 설치 |
| **Shared Folders** | SMB·NFS 공유 생성/편집 |
| **Users** | 리눅스 사용자·그룹 관리 |
| **Security** | 방화벽, 보안 검사(advisor), 2FA(TOTP), 로그인 이력 |
| **Certificates** | HTTPS 인증서 — Let's Encrypt·자체 서명·가져오기 |
| **Hardware** | UPS(무정전 전원)·SNMP 모니터링 |
| **Audit Log** | 사용자 액션·로그인 이력 |
| **Notifications** | Slack·Telegram·Discord 알림 연동 |
| **Settings** | 서버 이름·강조색 등 시스템 환경설정 |

---

## 6. 자주 하는 작업

### ZFS 스냅샷 만들기 / 되돌리기
`ZFS` 앱 → 데이터셋 선택 → **스냅샷 생성**. 목록에서 스냅샷을 골라 롤백/복제할 수 있습니다.
`Backup & Sync`에서 스냅샷을 **스케줄**로 자동 생성하도록 예약할 수 있습니다.

### 장애 디스크 교체
1. `Disk Inventory` → **결함** 탭에서 SMART 경고/실패 또는 ZFS DEGRADED/FAULTED 디스크 확인.
2. 해당 디스크의 **위치(베이/라벨)** 를 메모해 두세요(미리 `인벤토리` 탭에서 라벨을 지정해 두면 편합니다).
3. **교체 마법사** 실행 → 오프라인(offline) → 물리 디스크 교체 → 새 디스크 감지 → replace → 리실버 대기 → clear.
   내부적으로 표준 ZFS 명령(`zpool offline/replace/clear`)을 순서대로 실행합니다.

### 디스크에 이름/위치 붙이기
`Disk Inventory` → **인벤토리** 탭 → 디스크의 위치 편집에서 베이 번호·라벨·메모를 저장.
이 정보는 서버에 영속 저장되어 재부팅해도 유지되고, 결함/교체 때 물리 위치를 찾는 데 씁니다.

### 백업 예약
`Backup & Sync` → 작업 추가 → 원본/대상, rsync 또는 rclone 리모트, 주기를 지정.

### 셀프호스팅 앱 설치
`Package Center` → 앱 선택 → 설치. docker compose로 배포됩니다(Docker 필요).

### 배경화면·위젯 바꾸기
좌측 상단 **Nimbo 메뉴** → 배경화면에서 고르거나 내 이미지 업로드 → 위젯 추가로 원하는 위젯 배치.

### 터미널 열기
도크 또는 앱 목록에서 **Terminal** 실행(관리자 계정만). 서버 셸이 바로 열립니다.
셸 안에서 `sudo`로 권한을 올릴 수 있으며, 모든 명령은 감사(sudo/journald)됩니다.

---

## 7. 보안

- **로그인 잠금** — 로그인 5회 실패 시 잠금. fail2ban이 설치되면 IP 차단(10분 내 5회 → 1시간)까지.
- **2FA** — `Security` 앱에서 TOTP(구글 OTP 등) 2단계 인증을 켤 수 있습니다.
- **방화벽** — `Security` 앱에서 ufw/firewalld 규칙을 관리.
- **감사 로그** — `Audit Log`에서 누가 언제 무엇을 했는지 확인.
- **세션** — HMAC 서명 토큰. 서버는 `NIMBO_SECRET`이 없으면 로그인을 막습니다(설치 시 자동 생성).
- **프록시 뒤 바인딩** — 앱은 `127.0.0.1`에만 바인딩하고 반드시 프록시(Caddy/nginx)를 통해
  노출하세요. `X-Forwarded-*` 헤더는 신뢰된 프록시만 설정해야 합니다.
- **터미널 교차 출처 차단** — 자체 프록시를 쓸 때는 `/etc/nimbo/nimbo.env`에
  `NIMBO_ORIGIN=https://<접속-호스트>`를 넣고 `sudo systemctl restart nimbo-terminal`
  (`--caddy` 설치 시 자동).

> ⚠ **알아두기:** 현재 `nimbo` 서비스 계정은 호환성 때문에 무암호 sudo(NOPASSWD: ALL)
> 권한을 가집니다. 즉 앱이 탈취되면 root와 같습니다. 신뢰된 네트워크 뒤에서 운용하고,
> 반드시 프록시·방화벽·2FA를 함께 쓰세요.

---

## 8. 문제 해결

**접속이 안 돼요 (연결 거부/타임아웃)**
```bash
systemctl status nimbo            # 앱이 떠 있는지
journalctl -u nimbo -n 50 --no-pager
sudo ss -tlnp | grep -E ':3000|:443'   # 포트 리슨 여부
```

**HTTPS인데 Caddy 주소가 안 열려요**
```bash
systemctl status caddy
journalctl -u caddy -n 50 --no-pager   # 80/443 포트 충돌·인증서 발급 실패 확인
```
80/443을 다른 프로그램이 쓰면 Caddy가 못 뜹니다. [2번 항목](#443-포트가-이미-쓰이는-경우) 참고.

**터미널 앱이 열리는데 연결이 안 돼요**
- `--caddy`로 설치했으면 자동 라우팅됩니다. 자체 프록시라면 `/api/terminal/ws → 127.0.0.1:3001`
  WebSocket 라우팅이 있는지 확인하세요([2번 항목](#443-포트가-이미-쓰이는-경우)).
- 사이드카 상태: `systemctl status nimbo-terminal`. 설치 때 node-pty 빌드가 실패했다면
  빌드 도구(gcc-c++·make·python3) 설치 후 인스톨러를 다시 실행하세요.

**인증서 경고가 떠요** — IP/LAN 설치는 자체 서명이라 정상입니다.
[자체 서명 인증서 신뢰](#자체-서명-인증서-신뢰-lanip-설치) 참고.

**로그인이 안 돼요** — 서버 OS 계정/비밀번호가 맞는지, 잠긴 상태(연속 실패)가 아닌지 확인.
`journalctl -u nimbo`에 로그인 시도가 남습니다.

**디스크 목록이 이상해요/SMART가 안 보여요** — SMART는 `smartctl`(sudo)로 읽습니다.
USB·iSCSI 디스크는 SMART/위치가 표시되지 않을 수 있습니다(정상).

---

## 9. 제거

`install.sh`가 설치한 것을 되돌립니다. root로 실행하세요.

```bash
# 1) 서비스 중지 · 비활성화
sudo systemctl disable --now nimbo
sudo systemctl disable --now nimbo-terminal 2>/dev/null || true
sudo rm -f /etc/systemd/system/nimbo.service /etc/systemd/system/nimbo-terminal.service
sudo systemctl daemon-reload

# 2) fail2ban jail 제거 (설치 시 추가된 경우)
sudo rm -f /etc/fail2ban/jail.d/nimbo.conf /etc/fail2ban/filter.d/nimbo.conf
sudo systemctl reload fail2ban 2>/dev/null || true

# 3) 앱 번들 · 터미널 사이드카 · 소스 · sudo 규칙 삭제
sudo rm -rf /opt/nimbo /opt/nimbo-terminal /opt/nimbo-src
sudo rm -f /etc/sudoers.d/nimbo

# 4) (선택) 설정·인증서·서비스 계정까지 완전 삭제
# sudo rm -rf /etc/nimbo
# sudo userdel -r nimbo 2>/dev/null || true
# sudo rm -f /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

---

문의·이슈: https://github.com/seongilp/nimbo
