<p align="center"><img src="public/logo.svg" width="96" alt="Nimbo"></p>

<h1 align="center">Nimbo</h1>

<p align="center"><strong>Your own cloud, self-hosted.</strong><br>당신만의 클라우드, 당신의 서버에.</p>

<p align="center">
  <a href="https://seongilp.github.io/nimbo/"><strong>🌐 Website / 소개 페이지</strong></a>
  &nbsp;·&nbsp;
  <a href="#1-systemd로-띄우는-방법-권장">📦 한 줄 설치</a>
  &nbsp;·&nbsp;
  <a href="DEPLOYMENT.md">🚀 배포 가이드</a>
</p>

<p align="center"><code>curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash</code></p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-App%20Router-000?logo=nextdotjs&logoColor=white" alt="Next.js">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white" alt="Tailwind">
  <img src="https://img.shields.io/badge/shadcn%2Fui-slate-0f172a" alt="shadcn/ui">
  <img src="https://img.shields.io/badge/License-MIT-3B82F6" alt="MIT">
</p>

<p align="center"><img src="public/screenshots/desktop.png" width="900" alt="Nimbo desktop console"></p>

Nimbo is a Synology DSM-style web console to manage a Linux server like a NAS. It
renders a desktop-in-the-browser: a wallpaper, a top taskbar, an app launcher,
and draggable/resizable windows. Each "app" is a window.

> A polished marketing landing page lives at the **`/landing`** route
> (`src/app/landing/page.tsx`).

Built with Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + lucide-react.

## Features

- 🖥️ **데스크톱 UI** — macOS 스타일 윈도우 · 도크 · ⌘K 커맨드 팔레트
- 🗄️ **ZFS 관리** — 풀 · 데이터셋 · 스냅샷 · 복제
- 💾 **백업 & 동기화** — rsync · rclone 클라우드 · Time Machine
- 📦 **컨테이너 & 패키지 센터** — Docker 제어 + 원클릭 셀프호스팅 앱
- 🛡️ **보안** — 방화벽 · 2FA · 감사 로그
- 👥 **사용자 / 공유폴더** — 계정 권한 + Samba · NFS 공유
- 📊 **모니터링 대시보드** — CPU · 메모리 · 네트워크 · 스토리지 실시간
- 🔒 **HTTPS / 인증서** — Caddy 리버스 프록시 자동 TLS
- 🔌 **UPS / SNMP** 모니터링 · 🔔 **알림** (Slack / Telegram / Discord)
- ⚙️ **systemd 네이티브 배포** — Docker 없이 직접 실행, Docker가 죽어도 생존

## Screenshots

| 모니터링 대시보드 | ZFS 스토리지 |
| --- | --- |
| ![Dashboard](public/screenshots/dashboard.png) | ![ZFS](public/screenshots/zfs.png) |

| 패키지 센터 | 보안 센터 |
| --- | --- |
| ![Packages](public/screenshots/packages.png) | ![Security](public/screenshots/security.png) |

## Apps (v1)

| App | What it does |
| --- | --- |
| **File Station** | Browse the filesystem, navigate Samba/NFS shares, breadcrumb + sidebar |
| **Storage Manager** | Disks, partitions, usage bars, SMART health, temperature |
| **Resource Monitor** | Live CPU / memory / network gauges + sparklines, top processes |
| **Container Manager** | Docker containers with live CPU/mem, ports, start/stop/restart |

## Architecture

The app runs **directly on the server** it manages. UI and API live in one
Next.js codebase. The API routes read real system state through a provider layer
in `src/lib/system/`:

- `stats.ts` — `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `os` module
- `storage.ts` — `lsblk -J`, `smartctl`
- `files.ts` — `fs` with a path-traversal allowlist (`NAS_FILE_ROOTS`)
- `docker.ts` — `docker ps` / `docker stats` and lifecycle actions
- `shares.ts` — parses `/etc/samba/smb.conf` and `/etc/exports`

Every provider has a **mock fallback** (`mock.ts`) so the UI runs on any OS during
development. Mock mode auto-activates when not on Linux, or when `NAS_MOCK=1`.

## Development

```bash
npm install
npm run dev          # http://localhost:3000  (mock data on macOS/Windows)
NAS_MOCK=1 npm run dev   # force mock data even on Linux
```

## Production (on the Linux server)

```bash
npm run build
NAS_FILE_ROOTS=/volume1:/volume2 npm run start
```

The Node process needs permission to read the paths and run the system commands
it shells out to (`lsblk`, `smartctl`, `docker`). Run it as a user with the
appropriate access (e.g. in the `docker` group, with sudo rules for `smartctl`),
behind a reverse proxy with authentication.

### Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `NAS_MOCK` | unset | `1` forces demo data |
| `NAS_FILE_ROOTS` | `/` | Colon-separated roots File Station may read |

## Security notes

This v1 has **no authentication** — put it behind an authenticating reverse proxy
(or a VPN) before exposing it. File access is constrained to `NAS_FILE_ROOTS`,
and Docker actions are restricted to a fixed allowlist of verbs.
