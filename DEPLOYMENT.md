# Nimbo — 배포 가이드

## TL;DR — 왜 Docker가 아니라 systemd인가

이건 **서버를 관리하는 도구**다. 그래서 자기가 관리하는 대상(특히 Docker)에 의존하면 안 된다.
DSM·OpenMediaVault·Cockpit·TrueNAS가 전부 컨테이너가 아니라 **호스트의 네이티브 서비스**로 도는 이유다.

```
잘못된 구조                         권장 구조
┌───────────────┐                  ┌──────────────────────────┐
│  Docker        │                  │  호스트 OS                 │
│  ┌──────────┐  │                  │  ┌────────────────────┐   │
│  │ NAS콘솔   │  │  ← Docker 죽으면 │  │ NAS콘솔 (systemd)   │   │
│  └──────────┘  │     콘솔도 죽음   │  │  Restart=always     │   │
└───────────────┘                  │  └─────────┬──────────┘   │
                                   │            ↓ 관리/재시작    │
                                   │  Docker · ZFS · systemd …  │
                                   └──────────────────────────┘
```

systemd로 돌리면: Docker가 죽어도 콘솔은 살아있고 → **콘솔이 `systemctl restart docker`로 Docker를 되살릴 수 있다.** 콘솔 자체가 크래시해도 `Restart=always`가 다시 띄운다.

---

## 1. systemd로 띄우는 방법 (권장)

한 줄 설치 (기본: Caddy HTTPS · 서버 IP 자동 감지 · 자체 서명 인증서):

```bash
curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash
```

또는 소스에서 직접:

```bash
git clone <repo> nimbo && cd nimbo
sudo ./deploy/install.sh                       # 기본값: Caddy로 https://<서버-IP> (자체 서명)
# 도메인에 진짜 인증서:  sudo ./deploy/install.sh --caddy nas.example.com   # https://nas.example.com
# 직접 리버스 프록시 운영:  sudo ./deploy/install.sh --no-caddy            # 앱은 http://<서버-IP>:포트
# 포트 지정:  --port 3000  (생략 시 3000 · 443이 쓰이는 중이면 10443 자동)
```

`install.sh`가 하는 일:
1. `npm ci && npm run build` — `output: 'standalone'` 덕분에 `.next/standalone/server.js` 단일 번들 생성
2. `/opt/nimbo` 에 번들 + 정적 파일 복사
3. `/etc/nimbo/nimbo.env` 설정 파일 생성(포트 등) + **`NIMBO_SECRET` 자동 생성**(세션 서명 키). 파일은 `chmod 600`, `certs/`는 `chmod 700`으로 잠근다.
4. `deploy/nimbo.service` 를 `/etc/systemd/system/` 에 설치하고 `systemctl enable --now`
5. **(기본) Caddy 설치·설정** → 443에서 HTTPS, 앱은 `127.0.0.1:3000` 루프백 전용(외부 직접 노출 없음). 터미널 PTY 사이드카·fail2ban·`nimbo` 관리 CLI(`/usr/local/bin/nimbo`)도 함께 설치. `--no-caddy`면 Caddy를 건너뛰고 앱을 `http://<서버-IP>:포트`에 둔다.

핵심 유닛 설정 (`deploy/nimbo.service`):

```ini
[Unit]
After=network-online.target
Wants=network-online.target docker.service   # Requires 아님! Docker 죽어도 콘솔 유지

[Service]
ExecStart=/usr/bin/node /opt/nimbo/server.js
EnvironmentFile=/etc/nimbo/nimbo.env
Restart=always            # 크래시/OOM 후 자동 복구
RestartSec=2
User=nimbo                # 전용 계정(무암호 sudo). 권한 명령은 sudo로 실행 — 프로세스 자체는 root 아님

[Install]
WantedBy=multi-user.target
```

운영 명령:

```bash
systemctl status nimbo      # 상태
systemctl restart nimbo     # 재시작 (설정 변경 후)
journalctl -u nimbo -f      # 실시간 로그
```

> **`nimbo` 관리 CLI**(설치 스크립트가 `/usr/local/bin/nimbo`에 함께 설치):
> `nimbo status | logs [app|term|caddy] | restart | update | url | uninstall [--purge] | help`.
> 한 방에 제거: `sudo nimbo uninstall` (`--purge`면 `/etc/nimbo`·`nimbo` 계정·`/etc/caddy/Caddyfile`까지 삭제).

### 프리빌트 번들 vs 소스 빌드

`bootstrap.sh`는 기본적으로 **프리빌트 릴리스 번들**(`…/releases/latest/download/nimbo-dist.tar.gz`)을
받아 서버 빌드 없이 설치합니다. GitHub Actions(`.github/workflows/release.yml`)가 태그(`v*`) 푸시 때
Next.js standalone + 터미널 사이드카(node-pty, x64)를 빌드해 릴리스 자산으로 올립니다.

- 릴리스가 없거나 다운로드 실패 → **소스 클론 + 서버 빌드**로 자동 폴백. `NIMBO_SOURCE=1`로 강제.
- 번들 안의 `PREBUILT` 마커를 보고 `install.sh`가 `npm ci && npm run build`를 건너뜁니다.
- 터미널 사이드카는 x64 프리빌트 node-pty를 그대로 쓰고(로드 확인), arch가 다르면 서버에서 재빌드(best-effort).
- 앱 실행에는 Node.js 런타임이 필요하므로 `install.sh`가 Node 20(≥20.9, Next 16 요구)을 설치합니다(빌드 툴체인은 불필요).
- 또한 OS 비밀번호 검증에 쓰는 **`python3` + 시스템 `libcrypt`**(dnf/yum: `libxcrypt`, apt: `libcrypt1`)를 **필수 런타임 의존성**으로 설치하고, libcrypt 로드를 자가검증해 안 되면 설치를 중단합니다(프리빌트 설치에도 필요 — Python 3.13이 stdlib `crypt`를 제거해 ctypes/libcrypt로 검증하기 때문).

> **수동 systemd 등록**(스크립트 없이): `npm run build` → `.next/standalone` 통째로 `/opt/nimbo`에 복사하고 `.next/static`·`public`도 같이 복사 → 위 유닛 파일을 `/etc/systemd/system/`에 두고 `systemctl daemon-reload && systemctl enable --now nimbo`.

---

## 2. 설치 후 셋업으로 포트 등 설정

포트·바인드 주소·경로는 **설정 파일 한 곳**에서 바꾼다 — `/etc/nimbo/nimbo.env`:

```bash
PORT=8080                 # 원하는 포트로
HOSTNAME=127.0.0.1        # 127.0.0.1 = 프록시 뒤에서만 / 0.0.0.0 = LAN 직접 노출
NAS_FILE_ROOTS=/volume1:/volume2
NAS_MOCK=0                # 실제 호스트는 0 (데모 데이터 끔)
```

바꾼 뒤:

```bash
sudo systemctl restart nimbo
```

또한 **첫 접속 시 웹 셋업 마법사**가 뜬다(앱 내장): 관리자 계정·호스트명·시간대·데이터 경로·HTTPS 사용 여부를 GUI로 설정하고 완료하면 `/etc/nimbo/setup.json`에 저장된다. (포트처럼 프로세스 재시작이 필요한 항목은 마법사가 env 수정 + 재시작 명령을 안내한다.)

---

## 3. 앞단의 Caddy(HTTPS) — 이제 기본값

**Caddy는 이제 기본으로 설치된다.** `install.sh`가 Caddy를 깔고 443에서 TLS를 종료하며,
앱은 `127.0.0.1:3000`(루프백 전용)에 묶여 외부로 직접 노출되지 않는다. 도메인을 안 주면
서버 IP를 자동 감지해 자체 서명 인증서로 `https://<서버-IP>`를, `--caddy <도메인>`을 주면
그 도메인에 진짜 Let's Encrypt 인증서를 발급한다. (443이 이미 쓰이면 10443으로, 그것도
막혀 있으면 사용할 포트를 물어본다.)

| 상황 | 방법 |
|---|---|
| 기본 (도메인 없음) | 그냥 설치 → `https://<서버-IP>` (자체 서명, `tls internal`) |
| 공개 도메인 있음 | `--caddy nas.example.com` → 진짜 Let's Encrypt 자동 |
| 직접 리버스 프록시 운영 | `--no-caddy` → 앱은 `http://<서버-IP>:포트`, 프록시는 직접 라우팅 |

설치 스크립트가 Caddy 설치와 `/etc/caddy/Caddyfile` 생성을 자동으로 처리한다. 앱은
`127.0.0.1:3000`에서 평문 HTTP만 말하고 TLS는 Caddy가 처리한다. 수동으로 설정하려면
`deploy/Caddyfile`을 참고한다:

```bash
sudo apt install caddy            # 또는 배포판 패키지
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # 도메인/IP 수정
sudo systemctl reload caddy
```

- **공개 도메인 있음** → 진짜 Let's Encrypt 자동 (`nas.example.com { reverse_proxy 127.0.0.1:3000 }`)
- **LAN 전용, 도메인 없음** → `tls internal` (Caddy 자체 CA) 또는 DNS 챌린지로 진짜 인증서
- 앱의 **Certificates 앱**이 인증서 발급/자체서명/가져오기와 HTTP/HTTPS 포트 정책을 관리한다 (실제 TLS 종료는 이 프록시가 수행).

### 직접 프록시를 쓸 때 (`--no-caddy`)

`--no-caddy`로 설치하면 Caddy를 건너뛰고 앱이 `http://<서버-IP>:포트`에 뜬다. 이미 nginx를
쓴다면 아래처럼 프록시한다. `X-Forwarded-Proto`를 꼭 전달해야 세션 쿠키에 `Secure`
플래그가 붙는다(HSTS·보안 헤더는 nginx `add_header`로 별도 설정).

```nginx
# 터미널 앱: WebSocket 사이드카(node-pty)를 먼저 라우팅한다. 이 블록이 없으면
# 터미널 앱은 열려도 연결이 되지 않는다(Caddy는 자동 설정됨).
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
    # 반드시 덮어쓰기($proxy_add_x_forwarded_for는 append라 클라이언트가 보낸 값이 남는다).
    # 앱은 로그인 IP 허용목록·fail2ban 대상에 이 값을 쓰므로 클라이언트 위조값이 섞이면 안 된다.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

> **터미널 교차 출처 차단(권장).** 자체 프록시를 쓸 때는 `/etc/nimbo/nimbo.env`에
> `NIMBO_ORIGIN=https://<접속-호스트>`를 추가하고 `sudo systemctl restart nimbo-terminal`.
> 그러면 PTY WebSocket이 해당 Origin만 허용한다(CSWSH 방어). Caddy 기본 모드로
> 설치하면 자동 설정된다.

> **프록시 뒤 바인딩(중요).** 프록시를 쓸 때는 앱을 반드시 `HOSTNAME=127.0.0.1`로
> 바인딩해 외부에서 직접 닿지 못하게 하라. 앱은 클라이언트 IP를(쿠키 `Secure` 판정과
> fail2ban 차단 대상에 쓰이는) `X-Forwarded-For` / `X-Forwarded-Proto` 헤더에서 읽는다.
> 이 헤더는 **신뢰된 프록시만** 설정해야 한다. 앱이 직접 노출되면 클라이언트가 헤더를
> 위조해 차단을 회피하거나 무고한 IP를 차단시킬 수 있다.
>
> ⚠️ **중요:** `X-Forwarded-For`는 프록시가 기본적으로 **append**한다(`<클라이언트값>, <실제IP>`).
> 그래서 앱은 **맨 오른쪽(프록시가 붙인) 값**만 신뢰한다. 자체 프록시를 쓸 때는 위 nginx 예시처럼
> `X-Forwarded-For $remote_addr`로 **덮어써서** 클라이언트 위조값을 제거하라. Caddy 기본 설치는
> `header_up X-Forwarded-For {remote_host}`로 자동으로 덮어쓴다.

---

## 4. 권한(중요)

콘솔은 디스크·ZFS·systemd·방화벽·사용자를 건드리므로 **권한**이 필요하다.

- **기본**: 유닛이 전용 `nimbo` 계정(무암호 sudo)으로 실행된다. `install.sh`가 `nimbo`에 blanket `NOPASSWD: ALL`을 부여한다 — **데이터플레인 argv 마이그레이션은 완료**됐지만, 셸이 본질인 예외 2곳(인터랙티브 터미널 · `zfs send|receive` 복제 파이프)과 shares 설정파일 쓰기(아직 node `writeFile`, 무-sudo) 때문에 유지된다. **반드시 인증 프록시 뒤 또는 신뢰 네트워크에서만** 노출할 것.
- **하드닝(선택)**: `deploy/nimbo.sudoers`로 blanket sudo를 **특정 명령만 NOPASSWD**인 최소권한 화이트리스트로 교체한다. 모든 시스템 모듈의 권한 명령은 이미 argv(`sudo -n <binary> <args>`, no shell)로 실행된다. 최소권한 sudoers로 전면 교체하려면 위 셸 예외 2곳의 스코핑/스트리밍 파이프 프리미티브와 shares 설정파일 쓰기 경로 전환이 선행돼야 한다. 자세한 내용은 그 파일 헤더 참고.
- 권한이 없으면 각 API가 안전하게 `"권한 필요"`로 거부한다(시스템을 망가뜨리지 않음).

---

## 5. Docker로 돌리고 싶다면 (비권장, 주의사항 숙지)

Docker가 편하다면 가능은 하다 — 단 **Docker 관리 기능은 docker.sock에, 콘솔 생존은 Docker 데몬에 묶인다**(=Docker 죽으면 콘솔도 죽음).

> ⚠️ **공식 컨테이너 이미지는 없다.** Nimbo는 이미지나 Dockerfile을 배포하지 않는다(릴리스
> 산출물은 systemd-native `nimbo-dist.tar.gz`). 아래 `nimbo:latest`는 **예시**이며, 쓰려면
> standalone 번들로 **직접 이미지를 빌드**해야 한다.

그래도 쓰겠다면(이미지를 직접 빌드한 뒤):

```bash
docker run -d --name nimbo --restart=always \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /etc/nimbo:/etc/nimbo \
  -v /:/host:ro -v /volume1:/volume1 \
  -e NAS_MOCK=0 -e PORT=3000 \
  -e NIMBO_SECRET=$(openssl rand -hex 32) \
  nimbo:latest    # ← 직접 빌드한 이미지
```

> **`/etc/nimbo` 볼륨은 필수다.** 이걸 매핑하지 않으면 최초 관리자 계정·허용 IP·서비스
> 설정(`users.json` 등)이 컨테이너 임시 FS에만 저장돼 재생성 때 전부 사라진다.
>
> **`NIMBO_SECRET`은 필수다.** 프로덕션에서 이 값이 비어 있으면 앱은 **fail-closed** —
> 세션을 신뢰하지 않아(모든 요청을 미인증으로 처리) 로그인이 불가능하다. systemd
> 설치는 `install.sh`가 자동 생성하지만, Docker는 위처럼 직접 주입해야 한다. 단,
> 컨테이너를 재생성할 때마다 `$(openssl rand -hex 32)`가 새 값을 만들어 기존 세션이
> 무효화되므로, 안정적으로 쓰려면 한 번 생성한 값을 고정해 두는 편이 좋다.

`--restart=always`로 컨테이너 크래시는 복구되지만, **Docker 데몬 자체가 죽으면 못 살린다.** 그래서 프로덕션은 systemd-native를 권장한다. (Docker 데몬은 보통 systemd가 관리하므로, 콘솔을 systemd로 두면 Docker까지 콘솔이 관리·재시작할 수 있다.)
