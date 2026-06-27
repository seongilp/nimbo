# Nimbo

A Synology DSM-style web UI to manage a Linux server like a NAS. It renders a
desktop-in-the-browser: a wallpaper, a top taskbar, an app launcher, and
draggable/resizable windows. Each "app" is a window.

Built with Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + lucide-react.

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
