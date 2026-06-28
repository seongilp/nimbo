import crypto from "node:crypto";

import { run, USE_MOCK } from "./exec";

// Shared secret for signing session tokens. MUST be provided via NIMBO_SECRET
// in production (install.sh generates one) so the Edge middleware — which can
// only read env vars — verifies tokens with the same key. Dev falls back.
export function getSecret(): string {
  return process.env.NIMBO_SECRET || "nimbo-dev-insecure-secret-change-me";
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

// ---- token (HMAC-signed, matches middleware verification) ----------------
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signToken(user: string): string {
  const payload = b64url(JSON.stringify({ u: user, exp: Date.now() + SESSION_TTL_MS }));
  const sig = b64url(crypto.createHmac("sha256", getSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined): { u: string; exp: number } | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", getSecret()).update(payload).digest());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// ---- brute-force protection (fail2ban-lite) ------------------------------
interface Attempt { fails: number; until: number }
const attempts = new Map<string, Attempt>();
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export function loginLocked(ip: string): number {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
  return 0;
}
function recordFail(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip) ?? { fails: 0, until: 0 };
  // reset the counter if the last failure window elapsed
  if (a.until && a.until < now && a.fails >= MAX_FAILS) a.fails = 0;
  a.fails += 1;
  if (a.fails >= MAX_FAILS) a.until = now + LOCK_MS;
  else a.until = now + WINDOW_MS;
  attempts.set(ip, a);
}
function recordSuccess(ip: string) {
  attempts.delete(ip);
}

// ---- OS password verification --------------------------------------------
function shq(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** Verify a username/password against the host's OS accounts (/etc/shadow). */
export async function verifyOsPassword(user: string, password: string): Promise<boolean> {
  if (!USER_RE.test(user) || !password) return false;

  if (USE_MOCK) {
    // Dev convenience (macOS): log in with admin / admin or root / root.
    return (user === "admin" || user === "root") && password === user;
  }

  // Pull the shadow hash for the user (requires root, which the service has).
  const { stdout, code } = await run(`getent shadow ${user}`);
  if (code !== 0 || !stdout.includes(":")) return false;
  const hash = stdout.split(":")[1];
  // Empty / locked / disabled passwords cannot authenticate.
  if (!hash || hash.startsWith("!") || hash.startsWith("*") || hash === "") return false;

  // crypt(3) via python supports the system scheme (sha512crypt $6$, yescrypt $y$).
  const py =
    "import sys,crypt;h=sys.argv[1];p=sys.stdin.readline().rstrip(chr(10));" +
    "sys.stdout.write('OK' if crypt.crypt(p,h)==h else 'NO')";
  const cmd = `printf '%s\\n' ${shq(password)} | python3 -c ${shq(py)} ${shq(hash)}`;
  const res = await run(cmd, { timeoutMs: 8000 });
  return res.code === 0 && res.stdout.trim() === "OK";
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  user?: string;
  error?: string;
  lockedFor?: number;
}

export async function login(user: string, password: string, ip: string): Promise<LoginResult> {
  const locked = loginLocked(ip);
  if (locked > 0) return { ok: false, error: `로그인 시도가 많아 잠겼습니다. ${locked}초 후 다시 시도하세요.`, lockedFor: locked };

  const ok = await verifyOsPassword(user, password);
  if (!ok) {
    recordFail(ip);
    const nowLocked = loginLocked(ip);
    return { ok: false, error: "사용자 이름 또는 비밀번호가 올바르지 않습니다.", lockedFor: nowLocked || undefined };
  }
  recordSuccess(ip);
  return { ok: true, token: signToken(user), user };
}
