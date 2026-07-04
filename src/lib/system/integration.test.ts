import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny fake OS behind the exec boundary. login()/files.ts shell out via
// ./exec (getent, id, sudo, python) — we mock that layer so the REAL auth
// policy + file-scope logic runs against controllable OS responses. File
// persistence stays real, pointed at a temp dir per test.
const fakeOs = vi.hoisted(() => ({
  users: {} as Record<string, { groups: string[]; home: string }>,
  goodPassword: "goodpass",
}));

vi.mock("./exec", () => ({
  USE_MOCK: false,
  shq: (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`,
  runArgs: vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === "getent" && args[0] === "shadow") {
      const u = args[1];
      return fakeOs.users[u]
        ? { stdout: `${u}:$6$salt$hashhashhashhash:19000:0:99999:7:::\n`, stderr: "", code: 0 }
        : { stdout: "", stderr: "", code: 2 };
    }
    if (cmd === "getent" && args[0] === "passwd") {
      const u = args[1];
      const home = fakeOs.users[u]?.home ?? `/home/${u}`;
      return { stdout: `${u}:x:1000:1000::${home}:/bin/bash\n`, stderr: "", code: 0 };
    }
    if (cmd === "id" && args[0] === "-nG") {
      const u = args[1];
      return { stdout: (fakeOs.users[u]?.groups ?? []).join(" "), stderr: "", code: 0 };
    }
    if (cmd === "sudo") {
      // files.ts directory listing runs `sudo … node -e <script> <path>`.
      const p = args[args.length - 1];
      return {
        stdout: JSON.stringify({ path: p, entries: [{ name: "notes.txt", type: "file", size: 12, mtime: 0, mode: 33188, uid: 1000 }] }),
        stderr: "",
        code: 0,
      };
    }
    return { stdout: "", stderr: "", code: 0 };
  }),
  run: vi.fn(async (cmd: string) => {
    if (cmd.startsWith("last")) return { stdout: "", stderr: "", code: 0 }; // login history
    // verifyOsPassword's python crypt check: OK iff the good password is embedded.
    return { stdout: cmd.includes(fakeOs.goodPassword) ? "OK" : "NO", stderr: "", code: 0 };
  }),
}));

let tmpDir: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The auth code intentionally console.warn()s a fail2ban line on each failed
  // login; silence it so the expected security logs don't clutter test output.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules(); // fresh auth module → fresh in-memory config cache + lockout map
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "nimbo-it-"));
  process.env.NIMBO_AUTH_FILE = path.join(tmpDir, "users.json");
  process.env.NIMBO_AUDIT_FILE = path.join(tmpDir, "audit.jsonl");
  process.env.NIMBO_SECRET = "test-secret-integration-0123456789";
  delete process.env.NAS_FILE_ROOTS; // admin roots default to "/"
  fakeOs.users = {
    alice: { groups: ["alice"], home: "/home/alice" },
    bob: { groups: ["bob", "nimbo-users"], home: "/home/bob" },
    root: { groups: ["root", "wheel"], home: "/root" },
  };
  fakeOs.goodPassword = "goodpass";
});

afterEach(() => {
  warnSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("login policy — first-login claim, IP allow-list, account lockdown", () => {
  it("first successful login claims admin AND pins the /24 as the allow-list", async () => {
    const { login, getAuthConfig } = await import("./auth");
    const r = await login("alice", "goodpass", "192.168.50.10");
    expect(r.ok).toBe(true);
    expect(r.role).toBe("admin");
    const cfg = await getAuthConfig();
    expect(cfg.adminClaimed).toBe(true);
    expect(cfg.allowedCidrs).toContain("192.168.50.0/24");
    expect(cfg.users.map((u) => u.name)).toContain("alice");
  });

  it("rejects a wrong password (before any policy)", async () => {
    const { login } = await import("./auth");
    const r = await login("alice", "wrongpass", "192.168.50.10");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/올바르지 않/);
  });

  it("enforces the IP allow-list after claim (same /24 ok, outside denied)", async () => {
    const { login } = await import("./auth");
    await login("alice", "goodpass", "192.168.50.10"); // claim + pin 192.168.50.0/24
    const outside = await login("alice", "goodpass", "10.0.0.5");
    expect(outside.ok).toBe(false);
    expect(outside.error).toMatch(/이 IP 주소에서는/);
    const inside = await login("alice", "goodpass", "192.168.50.200");
    expect(inside.ok).toBe(true);
  });

  it("account lockdown: empty allowedGroup rejects a non-claimed account", async () => {
    const { login } = await import("./auth");
    await login("alice", "goodpass", "192.168.50.10"); // alice becomes admin
    const bob = await login("bob", "goodpass", "192.168.50.11"); // correct pw + allowed IP
    expect(bob.ok).toBe(false);
    expect(bob.error).toMatch(/허용되지 않/);
  });

  it("allows a non-admin once an allowed group is set and the user is in it", async () => {
    const { login, runAuthAdminAction } = await import("./auth");
    await login("alice", "goodpass", "192.168.50.10");
    await runAuthAdminAction({ kind: "allowedGroup.set", group: "nimbo-users" });
    const bob = await login("bob", "goodpass", "192.168.50.11"); // bob ∈ nimbo-users
    expect(bob.ok).toBe(true);
    expect(bob.role).toBe("user");
  });

  it("locks out an IP after repeated failures", async () => {
    const { login } = await import("./auth");
    for (let i = 0; i < 5; i++) await login("alice", "wrongpass", "203.0.113.9");
    const r = await login("alice", "goodpass", "203.0.113.9"); // even correct pw is locked
    expect(r.ok).toBe(false);
    expect(r.lockedFor).toBeGreaterThan(0);
  });
});

describe("File Station scope — per-user home, admin vs non-admin", () => {
  it("getFileContext: a non-admin is scoped to their home only", async () => {
    const { getFileContext } = await import("./files");
    const ctx = await getFileContext("alice", false);
    expect(ctx.home).toBe("/home/alice");
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.roots.map((r) => r.path)).toEqual(["/home/alice"]);
  });

  it("getFileContext: an admin gets home plus the broader roots", async () => {
    const { getFileContext } = await import("./files");
    const ctx = await getFileContext("root", true);
    expect(ctx.isAdmin).toBe(true);
    const paths = ctx.roots.map((r) => r.path);
    expect(paths).toContain("/root");
    expect(paths).toContain("/");
  });

  it("a non-admin can list their own home", async () => {
    const { getFileContext, listDirectory } = await import("./files");
    const ctx = await getFileContext("alice", false);
    const d = await listDirectory("/home/alice", ctx);
    expect(d.path).toBe("/home/alice");
    expect(d.entries.length).toBeGreaterThan(0);
  });

  it("empty path defaults to the user's home", async () => {
    const { getFileContext, listDirectory } = await import("./files");
    const ctx = await getFileContext("alice", false);
    const d = await listDirectory("", ctx);
    expect(d.path).toBe("/home/alice");
  });

  it("a non-admin is DENIED outside their home (/etc, another home, /)", async () => {
    const { getFileContext, listDirectory } = await import("./files");
    const ctx = await getFileContext("alice", false);
    await expect(listDirectory("/etc", ctx)).rejects.toThrow(/not permitted/);
    await expect(listDirectory("/home/bob", ctx)).rejects.toThrow(/not permitted/);
    await expect(listDirectory("/", ctx)).rejects.toThrow(/not permitted/);
    await expect(listDirectory("/home/alice/../bob", ctx)).rejects.toThrow(/not permitted/);
  });

  it("an admin can list outside their home (/etc)", async () => {
    const { getFileContext, listDirectory } = await import("./files");
    const ctx = await getFileContext("root", true);
    const d = await listDirectory("/etc", ctx);
    expect(d.path).toBe("/etc");
  });
});
