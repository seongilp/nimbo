# Security Policy

Nimbo is **self-hosted** software: it runs on your own Linux server and manages
that server with elevated privileges. Security matters, and responsible
disclosure is welcome.

> **Status:** Nimbo is in **beta**. Run it behind a trusted network / VPN /
> authenticated proxy, keep it updated (`sudo nimbo update`), and review the
> hardening notes in [DEPLOYMENT.md](DEPLOYMENT.md).

## Supported Versions

Only the **latest release** receives security fixes during the beta.

| Version                  | Supported |
| ------------------------ | --------- |
| latest `v0.1.0-beta.*`   | ✅        |
| older pre-releases       | ❌        |

Update with `sudo nimbo update` (or re-run the install one-liner).

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via **GitHub Security Advisories**:

- Repository **Security** tab → **Report a vulnerability**
  (<https://github.com/seongilp/nimbo/security/advisories/new>)

Please include: the affected version, a description, reproduction steps or a
proof-of-concept, and the impact.

We aim to **acknowledge within 72 hours** and to ship a fix or mitigation for
confirmed high/critical issues as fast as the beta cadence allows. Reporters are
credited in the release notes unless you prefer to remain anonymous.

## Scope

**In scope:** the Nimbo web console and its API, the installer (`deploy/`), the
terminal PTY sidecar, session/authentication handling, and privilege boundaries.

**Out of scope:** vulnerabilities in the underlying OS, Docker, ZFS, Caddy, or
other third-party software Nimbo manages (report those upstream); issues that
require an already-compromised host or physical access; and missing hardening
that is already documented as an operator responsibility (e.g. exposing the
console to the public internet without a trusted network or proxy).

## Security Model (summary)

- **Runs behind a reverse proxy.** The app binds `127.0.0.1` only; Caddy
  terminates TLS. The app port is never exposed directly.
- **Authentication.** Login authenticates against the server's own OS accounts
  (shadow/libcrypt); there is no separate password store, and passwords are
  verified, never stored. Sessions are HMAC-signed cookies that **fail closed**
  when `NIMBO_SECRET` is missing in production.
- **First-login TOFU + IP allow-list.** The first successful login claims admin
  and pins that network (`/24`); later logins are restricted to the allowed
  CIDRs.
- **Two-factor authentication.** Optional TOTP second factor for admin logins.
- **Brute-force protection.** In-process lockout plus a `fail2ban` jail.
- **No shell injection.** Privileged system actions run via argv
  (`sudo -n <binary> <args>`, no shell); all interpolated inputs are validated
  against strict allow-lists/regexes.
- **Trusted proxy headers.** The app trusts only the **rightmost**
  `X-Forwarded-For` entry (set by the proxy). Do not run it un-proxied.

### Known accepted trade-off

The `nimbo` service account is installed with passwordless (`NOPASSWD: ALL`)
sudo. This is a documented architecture decision — see the header of
[`deploy/nimbo.sudoers`](deploy/nimbo.sudoers) for the least-privilege target and
the path to adopting it. **Run Nimbo only behind a trusted network or an
authenticated reverse proxy.**

---

Non-security questions and bug reports: <https://github.com/seongilp/nimbo/issues>
