import type { Fail2banJail, Fail2banStatus } from "@/lib/types";
import { hasCommand, runArgs, USE_MOCK } from "./exec";

const JAIL_RE = /^[A-Za-z0-9_.\-]+$/;
const IP_RE = /^[0-9a-fA-F:.]{1,45}$/;

function mockStatus(): Fail2banStatus {
  return {
    available: true,
    running: true,
    jails: [
      { name: "sshd", currentlyBanned: 2, totalBanned: 14, currentlyFailed: 3, bannedIps: ["203.0.113.7", "198.51.100.22"] },
      { name: "nimbo", currentlyBanned: 1, totalBanned: 5, currentlyFailed: 1, bannedIps: ["192.0.2.55"] },
    ],
    isMock: true,
  };
}

function num(s: string | undefined): number {
  const n = Number((s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

async function parseJail(name: string): Promise<Fail2banJail> {
  const jail: Fail2banJail = { name, currentlyBanned: 0, totalBanned: 0, currentlyFailed: 0, bannedIps: [] };
  if (!JAIL_RE.test(name)) return jail;
  const { stdout, code } = await runArgs("fail2ban-client", ["status", name]);
  if (code !== 0) return jail;
  for (const line of stdout.split("\n")) {
    const cf = line.match(/Currently failed:\s*(\d+)/);
    const tf = line.match(/Total failed:\s*(\d+)/);
    const cb = line.match(/Currently banned:\s*(\d+)/);
    const tb = line.match(/Total banned:\s*(\d+)/);
    const il = line.match(/Banned IP list:\s*(.*)$/);
    if (cf) jail.currentlyFailed = num(cf[1]);
    if (tf) jail.totalBanned = jail.totalBanned || 0; // total failed not used
    if (cb) jail.currentlyBanned = num(cb[1]);
    if (tb) jail.totalBanned = num(tb[1]);
    if (il) jail.bannedIps = il[1].trim().split(/\s+/).filter(Boolean);
  }
  return jail;
}

export async function getFail2banStatus(): Promise<Fail2banStatus> {
  if (USE_MOCK) return mockStatus();
  if (!(await hasCommand("fail2ban-client"))) {
    return { available: false, running: false, jails: [], isMock: false };
  }
  const ping = await runArgs("fail2ban-client", ["ping"]);
  const running = ping.code === 0 && /pong/i.test(ping.stdout);
  if (!running) return { available: true, running: false, jails: [], isMock: false };

  const status = await runArgs("fail2ban-client", ["status"]);
  const m = status.stdout.match(/Jail list:\s*(.*)$/m);
  const names = m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  const jails: Fail2banJail[] = [];
  for (const n of names) jails.push(await parseJail(n));
  return { available: true, running: true, jails, isMock: false };
}

export interface Fail2banAction {
  kind: string;
  jail?: string;
  ip?: string;
}

export async function runFail2banAction(a: Fail2banAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "unban": {
      if (!a.jail || !JAIL_RE.test(a.jail) || !a.ip || !IP_RE.test(a.ip)) return { ok: false, error: "잘못된 인자" };
      if (USE_MOCK) return { ok: true };
      const { code, stderr } = await runArgs("fail2ban-client", ["set", a.jail, "unbanip", a.ip]);
      return code === 0 ? { ok: true } : { ok: false, error: stderr.trim() || "unban 실패 — 권한 필요" };
    }
    case "toggle": {
      if (USE_MOCK) return { ok: true };
      // start/stop the fail2ban service
      const enable = a.ip === "on"; // reuse field: ip="on"/"off"
      const { code, stderr } = await runArgs(
        "systemctl",
        enable ? ["enable", "--now", "fail2ban"] : ["disable", "--now", "fail2ban"],
        { timeoutMs: 15000 }
      );
      return code === 0 ? { ok: true } : { ok: false, error: stderr.trim() || "권한 필요" };
    }
    default:
      return { ok: false, error: "unknown action" };
  }
}
