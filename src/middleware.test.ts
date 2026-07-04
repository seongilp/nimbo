import crypto from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

const SECRET = "test-mw-secret-0123456789abcdef";
process.env.NIMBO_SECRET = SECRET; // read per-request by middleware (see secret.ts)

import { middleware } from "./middleware";

// --- token minting (matches the middleware's HMAC-SHA256 verify) ---
function b64url(b: Buffer | string): string {
  return Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function token(role: "admin" | "user"): string {
  const p = b64url(JSON.stringify({ u: "tester", r: role, exp: Date.now() + 60_000 }));
  return `${p}.${b64url(crypto.createHmac("sha256", SECRET).update(p).digest())}`;
}
async function statusFor(pathname: string, role: "admin" | "user" | null): Promise<number> {
  const headers: Record<string, string> = {};
  if (role) headers.cookie = `nimbo_session=${token(role)}`;
  const res = await middleware(new NextRequest(`http://nimbo.local${pathname}`, { headers }));
  return res.status; // NextResponse.next() → 200, deny → 401/403, redirect → 307
}

// --- the intended authorization policy (the source of truth for the matrix) ---
const PUBLIC = ["/api/auth/login", "/api/auth/logout"];
const OPEN = ["/api/auth/me", "/api/overview", "/api/processes", "/api/storage", "/api/shares", "/api/files"];
const ADMIN = [
  "/api/audit", "/api/backup", "/api/certs", "/api/cloud", "/api/docker", "/api/fail2ban",
  "/api/hardware", "/api/host", "/api/inventory", "/api/nimbo-users", "/api/notify",
  "/api/packages", "/api/power", "/api/security", "/api/setup", "/api/shares-admin",
  "/api/ssh", "/api/system", "/api/terminal", "/api/timemachine", "/api/users", "/api/zfs",
];

function enumerateApiRoutes(): string[] {
  const base = path.join(path.dirname(fileURLToPath(import.meta.url)), "app", "api");
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full, `${prefix}/${e}`);
      else if (e === "route.ts") out.push(prefix);
    }
  };
  walk(base, "/api");
  return out.sort();
}

describe("API authorization matrix", () => {
  it("every API route on disk is classified (nothing left ungoverned)", () => {
    const known = new Set([...PUBLIC, ...OPEN, ...ADMIN]);
    const routes = enumerateApiRoutes();
    const unclassified = routes.filter((r) => !known.has(r));
    expect(
      unclassified,
      `unclassified route(s) — add to PUBLIC/OPEN/ADMIN (and gate in middleware if privileged): ${unclassified.join(", ")}`
    ).toEqual([]);
    const onDisk = new Set(routes);
    const stale = [...known].filter((r) => !onDisk.has(r));
    expect(stale, `classified but no longer on disk: ${stale.join(", ")}`).toEqual([]);
  });

  it.each(ADMIN)("ADMIN %s → none:401, user:403, admin:200", async (route) => {
    expect(await statusFor(route, null)).toBe(401);
    expect(await statusFor(route, "user")).toBe(403);
    expect(await statusFor(route, "admin")).toBe(200);
  });

  it.each(OPEN)("OPEN %s → none:401, user:200, admin:200", async (route) => {
    expect(await statusFor(route, null)).toBe(401);
    expect(await statusFor(route, "user")).toBe(200);
    expect(await statusFor(route, "admin")).toBe(200);
  });

  it.each(PUBLIC)("PUBLIC %s → reachable without auth", async (route) => {
    expect(await statusFor(route, null)).toBe(200);
  });

  it("a non-public page redirects to /login when unauthenticated", async () => {
    expect(await statusFor("/", null)).toBe(307);
    expect(await statusFor("/definitely-not-public", null)).toBe(307);
  });

  it("an expired token is rejected", async () => {
    const p = b64url(JSON.stringify({ u: "t", r: "admin", exp: Date.now() - 1000 }));
    const expired = `${p}.${b64url(crypto.createHmac("sha256", SECRET).update(p).digest())}`;
    const res = await middleware(
      new NextRequest("http://nimbo.local/api/zfs", { headers: { cookie: `nimbo_session=${expired}` } })
    );
    expect(res.status).toBe(401);
  });
});
