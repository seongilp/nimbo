import crypto from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { NimboAuthConfig, NimboRole, NimboUser } from "@/lib/types";
import { run, USE_MOCK } from "./exec";

// Shared secret for signing session tokens. MUST be provided via NIMBO_SECRET
// in production (install.sh generates one) so the Edge middleware verifies
// tokens with the same key. Dev falls back.
export function getSecret(): string {
  return process.env.NIMBO_SECRET || "nimbo-dev-insecure-secret-change-me";
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const GROUP_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const AUTH_FILE = process.env.NIMBO_AUTH_FILE ?? "/etc/nimbo/users.json";

// ---- token (HMAC-signed, includes role) ----------------------------------
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signToken(user: string, role: NimboRole): string {
  const payload = b64url(JSON.stringify({ u: user, r: role, exp: Date.now() + SESSION_TTL_MS }));
  const sig = b64url(crypto.createHmac("sha256", getSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined): { u: string; r: NimboRole; exp: number } | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", getSecret()).update(payload).digest());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { u: data.u, r: data.r === "admin" ? "admin" : "user", exp: data.exp };
  } catch {
    return null;
  }
}

// ---- Nimbo auth config (roles) persistence -------------------------------
let cache: NimboAuthConfig | null = null;

function emptyConfig(): NimboAuthConfig {
  return { adminClaimed: false, allowedGroup: "", users: [], isMock: USE_MOCK };
}

export async function loadAuthConfig(): Promise<NimboAuthConfig> {
  if (cache) return cache;
  if (USE_MOCK) {
    cache = emptyConfig();
    return cache;
  }
  try {
    const raw = await readFile(AUTH_FILE, "utf8");
    cache = { ...emptyConfig(), ...(JSON.parse(raw) as Partial<NimboAuthConfig>), isMock: false };
  } catch {
    cache = emptyConfig();
  }
  return cache;
}

async function saveAuthConfig(cfg: NimboAuthConfig): Promise<void> {
  cache = cfg;
  if (USE_MOCK) return;
  try {
    await mkdir(path.dirname(AUTH_FILE), { recursive: true });
    await writeFile(AUTH_FILE, JSON.stringify(cfg, null, 2), "utf8");
  } catch {
    // best-effort; keep in-memory cache
  }
}

async function inGroup(user: string, group: string): Promise<boolean> {
  if (!group) return true;
  if (!GROUP_RE.test(group)) return false;
  if (USE_MOCK) return user === "admin"; // dev
  const { stdout, code } = await run(`id -nG ${user}`);
  if (code !== 0) return false;
  return stdout.split(/\s+/).includes(group);
}

// ---- brute-force protection (fail2ban-lite, in-process) ------------------
interface Attempt { fails: number; until: number }
const attempts = new Map<string, Attempt>();
const MAX_FAILS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export function loginLocked(ip: string): number {
  const a = attempts.get(ip);
  if (a && a.until > Date.now() && a.fails >= MAX_FAILS) return Math.ceil((a.until - Date.now()) / 1000);
  return 0;
}
function recordFail(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip) ?? { fails: 0, until: 0 };
  if (a.until < now) a.fails = 0;
  a.fails += 1;
  a.until = now + (a.fails >= MAX_FAILS ? LOCK_MS : WINDOW_MS);
  attempts.set(ip, a);
}
function recordSuccess(ip: string) {
  attempts.delete(ip);
}

// ---- OS password verification --------------------------------------------
function shq(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

export async function verifyOsPassword(user: string, password: string): Promise<boolean> {
  if (!USER_RE.test(user) || !password) return false;
  if (USE_MOCK) return (user === "admin" || user === "root") && password === user;

  const { stdout, code } = await run(`getent shadow ${user}`);
  if (code !== 0 || !stdout.includes(":")) return false;
  const hash = stdout.split(":")[1];
  if (!hash || hash.startsWith("!") || hash.startsWith("*") || hash === "") return false;

  const py =
    "import sys,crypt;h=sys.argv[1];p=sys.stdin.readline().rstrip(chr(10));" +
    "sys.stdout.write('OK' if crypt.crypt(p,h)==h else 'NO')";
  const cmd = `printf '%s\\n' ${shq(password)} | python3 -c ${shq(py)} ${shq(hash)}`;
  const res = await run(cmd, { timeoutMs: 8000 });
  return res.code === 0 && res.stdout.trim() === "OK";
}

// ---- login (OS auth + role policy) ---------------------------------------
export interface LoginResult {
  ok: boolean;
  token?: string;
  user?: string;
  role?: NimboRole;
  error?: string;
  lockedFor?: number;
}

export async function login(user: string, password: string, ip: string): Promise<LoginResult> {
  const locked = loginLocked(ip);
  if (locked > 0) return { ok: false, error: `로그인 시도가 많아 잠겼습니다. ${locked}초 후 다시 시도하세요.`, lockedFor: locked };

  if (!(await verifyOsPassword(user, password))) {
    recordFail(ip);
    return { ok: false, error: "사용자 이름 또는 비밀번호가 올바르지 않습니다.", lockedFor: loginLocked(ip) || undefined };
  }
  recordSuccess(ip);

  const cfg = await loadAuthConfig();
  let role: NimboRole;
  const existing = cfg.users.find((u) => u.name === user);
  if (existing) {
    role = existing.role;
    existing.lastLogin = Date.now();
  } else if (!cfg.adminClaimed) {
    // First successful login claims admin.
    role = "admin";
    cfg.adminClaimed = true;
    cfg.users.push({ name: user, role, addedAt: Date.now(), lastLogin: Date.now() });
  } else if (await inGroup(user, cfg.allowedGroup)) {
    role = "user";
    cfg.users.push({ name: user, role, addedAt: Date.now(), lastLogin: Date.now() });
  } else {
    return { ok: false, error: "이 계정은 Nimbo 접근이 허용되지 않았습니다. 관리자에게 문의하세요." };
  }
  await saveAuthConfig(cfg);

  return { ok: true, token: signToken(user, role), user, role };
}

// ---- admin: manage Nimbo accounts ----------------------------------------
export async function getAuthConfig(): Promise<NimboAuthConfig> {
  return loadAuthConfig();
}

export interface AuthAdminAction {
  kind: string;
  name?: string;
  role?: NimboRole;
  group?: string;
}

export async function runAuthAdminAction(a: AuthAdminAction): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadAuthConfig();
  switch (a.kind) {
    case "user.setRole": {
      const u = cfg.users.find((x) => x.name === a.name);
      if (!u) return { ok: false, error: "사용자를 찾을 수 없습니다" };
      if (u.role === "admin" && a.role === "user" && cfg.users.filter((x) => x.role === "admin").length <= 1)
        return { ok: false, error: "마지막 관리자는 강등할 수 없습니다" };
      u.role = a.role === "admin" ? "admin" : "user";
      await saveAuthConfig(cfg);
      return { ok: true };
    }
    case "user.remove": {
      const u = cfg.users.find((x) => x.name === a.name);
      if (u?.role === "admin" && cfg.users.filter((x) => x.role === "admin").length <= 1)
        return { ok: false, error: "마지막 관리자는 삭제할 수 없습니다" };
      cfg.users = cfg.users.filter((x) => x.name !== a.name);
      await saveAuthConfig(cfg);
      return { ok: true };
    }
    case "allowedGroup.set": {
      const g = (a.group ?? "").trim();
      if (g && !GROUP_RE.test(g)) return { ok: false, error: "잘못된 그룹 이름" };
      cfg.allowedGroup = g;
      await saveAuthConfig(cfg);
      return { ok: true };
    }
    default:
      return { ok: false, error: "unknown action" };
  }
}
