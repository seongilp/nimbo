import crypto from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { NimboAuthConfig, NimboRole, NimboUser } from "@/lib/types";
import { run, runArgs, shq, USE_MOCK } from "./exec";
import { logAudit } from "./audit";
import { deriveSubnet, ipInCidrs, isValidCidrOrIp, normalizeIp } from "./ipacl";
import { getSecret as readSecret, isInsecureSecret, isProduction } from "@/lib/secret";

// Shared secret for signing session tokens. MUST be provided via NIMBO_SECRET
// in production (install.sh generates one) so the Edge middleware verifies
// tokens with the same key. Dev falls back to a well-known value.
//
// Fail closed: in production a missing/dev secret would make sessions forgeable
// by anyone, so we refuse to mint or trust tokens until a real secret is set.
if (isProduction() && isInsecureSecret()) {
  console.error(
    "[nimbo] FATAL: NIMBO_SECRET is unset or the dev default in production. " +
      "Sessions are disabled until a strong secret is configured (e.g. `openssl rand -hex 32`)."
  );
}

export function getSecret(): string {
  return readSecret();
}

/** False when running production with no real secret — callers must fail closed. */
function secretUsable(): boolean {
  return !(isProduction() && isInsecureSecret());
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
  if (!secretUsable()) {
    throw new Error("NIMBO_SECRET가 설정되지 않아 세션을 발급할 수 없습니다.");
  }
  const payload = b64url(JSON.stringify({ u: user, r: role, exp: Date.now() + SESSION_TTL_MS }));
  const sig = b64url(crypto.createHmac("sha256", getSecret()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined): { u: string; r: NimboRole; exp: number } | null {
  if (!secretUsable()) return null; // fail closed: never trust tokens signed with the dev key in prod
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
  return { adminClaimed: false, allowedGroup: "", allowedCidrs: [], users: [], isMock: USE_MOCK };
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
  if (!USER_RE.test(user)) return false;
  const { stdout, code } = await runArgs("id", ["-nG", user]);
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
// Drop expired entries so a flood of distinct source IPs cannot grow the map
// without bound (it is purely in-process, reset on restart).
function pruneAttempts(now: number) {
  if (attempts.size < 2048) return;
  for (const [ip, a] of attempts) if (a.until < now) attempts.delete(ip);
}
function recordFail(ip: string) {
  const now = Date.now();
  pruneAttempts(now);
  const prev = attempts.get(ip) ?? { fails: 0, until: 0 };
  const fails = (prev.until < now ? 0 : prev.fails) + 1;
  attempts.set(ip, { fails, until: now + (fails >= MAX_FAILS ? LOCK_MS : WINDOW_MS) });
}
function recordSuccess(ip: string) {
  attempts.delete(ip);
}

// ---- OS password verification --------------------------------------------
export async function verifyOsPassword(user: string, password: string): Promise<boolean> {
  if (!USER_RE.test(user) || !password) return false;
  if (USE_MOCK) return (user === "admin" || user === "root") && password === user;

  const { stdout, code } = await runArgs("getent", ["shadow", user]);
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
    // Structured line for the fail2ban `nimbo` jail (read from journald).
    console.warn(`Nimbo authentication failure from ${ip} (user=${user})`);
    logAudit(user, "로그인", "Nimbo 웹 콘솔", "failed", ip);
    return { ok: false, error: "사용자 이름 또는 비밀번호가 올바르지 않습니다.", lockedFor: loginLocked(ip) || undefined };
  }
  recordSuccess(ip);
  logAudit(user, "로그인", "Nimbo 웹 콘솔", "success", ip);

  const cfg = await loadAuthConfig();
  const now = Date.now();

  // ── login IP allow-list ──────────────────────────────────────────────────
  // Skipped in mock and never engaged on the very first login (the list is
  // empty until admin is claimed — that first login is what pins the subnet).
  if (!USE_MOCK && cfg.allowedCidrs.length > 0 && !ipInCidrs(ip, cfg.allowedCidrs)) {
    // Structured line for the fail2ban `nimbo` jail (correct password, wrong IP).
    console.warn(`Nimbo authentication failure from ${ip} (user=${user}) [ip-not-allowed]`);
    logAudit(user, "로그인", "Nimbo 웹 콘솔", "failed", ip);
    return { ok: false, error: "이 IP 주소에서는 로그인할 수 없습니다. 허용된 네트워크에서 접속하세요." };
  }

  let role: NimboRole;
  let nextCfg: NimboAuthConfig;
  const existing = cfg.users.find((u) => u.name === user);
  if (existing) {
    role = existing.role;
    nextCfg = { ...cfg, users: cfg.users.map((u) => (u.name === user ? { ...u, lastLogin: now } : u)) };
  } else if (!cfg.adminClaimed) {
    // First successful login claims admin AND pins its /24 (or /64) as the
    // trusted network. An IP that resolves to no subnet leaves the list empty
    // (no restriction) rather than risking a lock-out.
    role = "admin";
    const subnet = USE_MOCK ? null : deriveSubnet(ip);
    nextCfg = {
      ...cfg,
      adminClaimed: true,
      allowedCidrs: subnet ? [subnet] : cfg.allowedCidrs,
      users: [...cfg.users, { name: user, role, addedAt: now, lastLogin: now }],
    };
  } else if (cfg.allowedGroup && (await inGroup(user, cfg.allowedGroup))) {
    // Other OS accounts may log in only when an allowed group is explicitly set.
    // Empty group = closed: only the claimed admin + accounts an admin adds.
    role = "user";
    nextCfg = { ...cfg, users: [...cfg.users, { name: user, role, addedAt: now, lastLogin: now }] };
  } else {
    return { ok: false, error: "이 계정은 Nimbo 접근이 허용되지 않았습니다. 관리자에게 문의하세요." };
  }
  await saveAuthConfig(nextCfg);

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
  cidr?: string;
  /** Server-supplied client IP for `ip.addCurrent` (route overrides any client value). */
  ip?: string;
}

export async function runAuthAdminAction(a: AuthAdminAction): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadAuthConfig();
  switch (a.kind) {
    case "user.setRole": {
      const u = cfg.users.find((x) => x.name === a.name);
      if (!u) return { ok: false, error: "사용자를 찾을 수 없습니다" };
      if (u.role === "admin" && a.role === "user" && cfg.users.filter((x) => x.role === "admin").length <= 1)
        return { ok: false, error: "마지막 관리자는 강등할 수 없습니다" };
      const nextRole: NimboRole = a.role === "admin" ? "admin" : "user";
      await saveAuthConfig({
        ...cfg,
        users: cfg.users.map((x) => (x.name === a.name ? { ...x, role: nextRole } : x)),
      });
      return { ok: true };
    }
    case "user.remove": {
      const u = cfg.users.find((x) => x.name === a.name);
      if (u?.role === "admin" && cfg.users.filter((x) => x.role === "admin").length <= 1)
        return { ok: false, error: "마지막 관리자는 삭제할 수 없습니다" };
      await saveAuthConfig({ ...cfg, users: cfg.users.filter((x) => x.name !== a.name) });
      return { ok: true };
    }
    case "allowedGroup.set": {
      const g = (a.group ?? "").trim();
      if (g && !GROUP_RE.test(g)) return { ok: false, error: "잘못된 그룹 이름" };
      await saveAuthConfig({ ...cfg, allowedGroup: g });
      return { ok: true };
    }
    case "ip.add":
    case "ip.addCurrent": {
      // ip.addCurrent uses the server-derived caller IP as a bare /32 (or /128);
      // ip.add takes an admin-typed IP or CIDR.
      const raw = a.kind === "ip.addCurrent" ? normalizeIp(a.ip ?? "") : (a.cidr ?? "").trim();
      if (!raw || !isValidCidrOrIp(raw)) return { ok: false, error: "잘못된 IP 또는 CIDR입니다" };
      if (cfg.allowedCidrs.includes(raw)) return { ok: false, error: "이미 허용 목록에 있습니다" };
      await saveAuthConfig({ ...cfg, allowedCidrs: [...cfg.allowedCidrs, raw] });
      return { ok: true };
    }
    case "ip.remove": {
      const cidr = (a.cidr ?? "").trim();
      await saveAuthConfig({ ...cfg, allowedCidrs: cfg.allowedCidrs.filter((c) => c !== cidr) });
      return { ok: true };
    }
    case "ip.clear": {
      // Disables the IP restriction entirely (login allowed from any address).
      await saveAuthConfig({ ...cfg, allowedCidrs: [] });
      return { ok: true };
    }
    default:
      return { ok: false, error: "unknown action" };
  }
}
