import os from "node:os";

import type { HostConfig, NetInterfaceConfig } from "@/lib/types";
import { hasCommand, run, USE_MOCK } from "./exec";

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------
const HOSTNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-]{0,62}$/;
const TZ_RE = /^[A-Za-z0-9_\-/+]+$/;
const IP_RE = /^[0-9.]{0,15}$/;
const IFACE_RE = /^[A-Za-z0-9._\-:@]+$/;
const NTP_SERVER_RE = /^[A-Za-z0-9._\-]+$/;

// --------------------------------------------------------------------------
// Mock state (mutable module-level)
// --------------------------------------------------------------------------
const MOCK_TIMEZONES = [
  "UTC",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Moscow",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "America/Toronto",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Africa/Johannesburg",
  "Africa/Cairo",
];

interface State {
  hostname: string;
  timezone: string;
  timezones: string[];
  ntpEnabled: boolean;
  ntpServer: string;
  datetimeIso: string;
  interfaces: NetInterfaceConfig[];
}

const state: State = {
  hostname: "nas-server",
  timezone: "Asia/Seoul",
  timezones: MOCK_TIMEZONES,
  ntpEnabled: true,
  ntpServer: "pool.ntp.org",
  datetimeIso: new Date().toISOString(),
  interfaces: [
    {
      name: "eth0",
      mac: "3c:7c:3f:1a:2b:0a",
      mode: "static",
      ipv4: "192.168.1.10",
      netmask: "255.255.255.0",
      gateway: "192.168.1.1",
      dns: ["192.168.1.1", "8.8.8.8"],
      up: true,
      speedMbps: 1000,
    },
    {
      name: "eth1",
      mac: "3c:7c:3f:1a:2b:0b",
      mode: "dhcp",
      ipv4: "10.0.0.23",
      netmask: "255.255.255.0",
      gateway: "10.0.0.1",
      dns: ["10.0.0.1"],
      up: true,
      speedMbps: 2500,
    },
  ],
};

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------
export async function getHostConfig(): Promise<HostConfig> {
  if (USE_MOCK) {
    return {
      hostname: state.hostname,
      timezone: state.timezone,
      timezones: state.timezones,
      ntpEnabled: state.ntpEnabled,
      ntpServer: state.ntpServer,
      datetimeIso: new Date().toISOString(),
      interfaces: state.interfaces,
      isMock: true,
    };
  }
  return readRealHostConfig();
}

async function readRealHostConfig(): Promise<HostConfig> {
  const hostname = os.hostname();

  let timezone = "";
  const tzRes = await run("timedatectl show -p Timezone --value");
  if (tzRes.code === 0) timezone = tzRes.stdout.trim();
  if (!timezone) {
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      timezone = "UTC";
    }
  }

  let timezones: string[] = [];
  const tzListRes = await run("timedatectl list-timezones");
  if (tzListRes.code === 0) {
    timezones = tzListRes.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (!timezones.length) timezones = MOCK_TIMEZONES;
  if (timezone && !timezones.includes(timezone)) timezones = [timezone, ...timezones];

  let ntpEnabled = false;
  const ntpRes = await run("timedatectl show -p NTP --value");
  if (ntpRes.code === 0) ntpEnabled = ntpRes.stdout.trim() === "yes";

  const interfaces = await readInterfaces();

  return {
    hostname,
    timezone,
    timezones,
    ntpEnabled,
    ntpServer: state.ntpServer,
    datetimeIso: new Date().toISOString(),
    interfaces,
    isMock: false,
  };
}

interface IpAddrInfo {
  family?: string;
  local?: string;
  prefixlen?: number;
}
interface IpLink {
  ifname?: string;
  address?: string;
  operstate?: string;
  addr_info?: IpAddrInfo[];
}

function cidrToNetmask(prefix: number): string {
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return "";
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [(mask >>> 24) & 0xff, (mask >>> 16) & 0xff, (mask >>> 8) & 0xff, mask & 0xff].join(".");
}

async function readInterfaces(): Promise<NetInterfaceConfig[]> {
  const out: NetInterfaceConfig[] = [];
  try {
    const addrRes = await run("ip -j addr");
    if (addrRes.code !== 0 || !addrRes.stdout.trim()) return state.interfaces;

    const links = JSON.parse(addrRes.stdout) as IpLink[];

    // Best-effort gateway map from default routes.
    const gateways: Record<string, string> = {};
    const routeRes = await run("ip route");
    if (routeRes.code === 0) {
      for (const line of routeRes.stdout.split("\n")) {
        const m = line.match(/^default via (\S+) dev (\S+)/);
        if (m) gateways[m[2]] = m[1];
      }
    }

    for (const link of links) {
      const name = link.ifname ?? "";
      if (!name || name === "lo") continue;
      const inet = (link.addr_info ?? []).find((a) => a.family === "inet");
      out.push({
        name,
        mac: link.address ?? "",
        mode: "dhcp",
        ipv4: inet?.local ?? "",
        netmask: inet?.prefixlen != null ? cidrToNetmask(inet.prefixlen) : "",
        gateway: gateways[name] ?? "",
        dns: [],
        up: link.operstate === "UP",
        speedMbps: 0,
      });
    }
  } catch {
    return state.interfaces;
  }
  return out.length ? out : state.interfaces;
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface HostAction {
  kind: string;
  hostname?: string;
  timezone?: string;
  ntpEnabled?: boolean;
  ntpServer?: string;
  datetimeIso?: string;
  iface?: {
    name: string;
    mode: "dhcp" | "static";
    ipv4?: string;
    netmask?: string;
    gateway?: string;
    dns?: string[];
  };
}

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

function netmaskToCidr(netmask: string): number | null {
  const parts = netmask.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  let bits = 0;
  for (const p of parts) {
    bits += (p >>> 0).toString(2).split("").filter((b) => b === "1").length;
  }
  return bits;
}

export async function runHostAction(a: HostAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "host.setHostname": {
      const h = a.hostname?.trim() ?? "";
      if (!HOSTNAME_RE.test(h)) return fail("유효하지 않은 호스트 이름");
      if (!USE_MOCK) {
        const { code, stderr } = await run(`hostnamectl set-hostname ${h}`);
        if (code !== 0) return fail(stderr.trim() || "호스트 이름 변경은 권한 필요");
      }
      state.hostname = h;
      return ok();
    }
    case "time.setTimezone": {
      const tz = a.timezone?.trim() ?? "";
      if (!TZ_RE.test(tz)) return fail("유효하지 않은 시간대");
      if (!USE_MOCK) {
        const { code, stderr } = await run(`timedatectl set-timezone ${tz}`);
        if (code !== 0) return fail(stderr.trim() || "시간대 변경은 권한 필요");
      }
      state.timezone = tz;
      return ok();
    }
    case "time.setNtp": {
      const enabled = Boolean(a.ntpEnabled);
      const server = a.ntpServer?.trim();
      if (server != null && server !== "" && !NTP_SERVER_RE.test(server)) {
        return fail("유효하지 않은 NTP 서버");
      }
      if (!USE_MOCK) {
        const { code, stderr } = await run(`timedatectl set-ntp ${enabled ? "true" : "false"}`);
        if (code !== 0) return fail(stderr.trim() || "NTP 변경은 권한 필요");
      }
      state.ntpEnabled = enabled;
      if (server) state.ntpServer = server;
      return ok();
    }
    case "time.setManual": {
      const iso = a.datetimeIso?.trim() ?? "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return fail("유효하지 않은 시간");
      if (!USE_MOCK) {
        const pad = (n: number) => String(n).padStart(2, "0");
        const formatted = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        const { code, stderr } = await run(`timedatectl set-time "${formatted}"`);
        if (code !== 0) return fail(stderr.trim() || "시간 변경은 권한 필요");
      }
      state.datetimeIso = d.toISOString();
      return ok();
    }
    case "network.setInterface": {
      const i = a.iface;
      if (!i || !IFACE_RE.test(i.name)) return fail("유효하지 않은 인터페이스");
      const mode = i.mode === "static" ? "static" : "dhcp";
      const ipv4 = i.ipv4?.trim() ?? "";
      const netmask = i.netmask?.trim() ?? "";
      const gateway = i.gateway?.trim() ?? "";
      const dns = (i.dns ?? []).map((d) => d.trim()).filter(Boolean);
      if (mode === "static") {
        if (!IP_RE.test(ipv4) || !ipv4) return fail("유효하지 않은 IPv4 주소");
        if (!IP_RE.test(netmask)) return fail("유효하지 않은 넷마스크");
        if (gateway && !IP_RE.test(gateway)) return fail("유효하지 않은 게이트웨이");
        for (const d of dns) {
          if (!IP_RE.test(d)) return fail("유효하지 않은 DNS");
        }
      }

      if (!USE_MOCK) {
        if (!(await hasCommand("nmcli"))) return fail("네트워크 변경은 권한 필요");
        if (mode === "static") {
          const cidr = netmask ? netmaskToCidr(netmask) : null;
          const addr = cidr != null ? `${ipv4}/${cidr}` : ipv4;
          const dnsArg = dns.join(" ");
          const cmd = `nmcli con mod ${i.name} ipv4.method manual ipv4.addresses ${addr}` +
            (gateway ? ` ipv4.gateway ${gateway}` : "") +
            (dnsArg ? ` ipv4.dns "${dnsArg}"` : "");
          const mres = await run(cmd, { timeoutMs: 15000 });
          if (mres.code !== 0) return fail(mres.stderr.trim() || "네트워크 변경은 권한 필요");
          const ures = await run(`nmcli con up ${i.name}`, { timeoutMs: 15000 });
          if (ures.code !== 0) return fail(ures.stderr.trim() || "네트워크 변경은 권한 필요");
        } else {
          const mres = await run(`nmcli con mod ${i.name} ipv4.method auto`, { timeoutMs: 15000 });
          if (mres.code !== 0) return fail(mres.stderr.trim() || "네트워크 변경은 권한 필요");
          await run(`nmcli con up ${i.name}`, { timeoutMs: 15000 });
        }
      }

      const existing = state.interfaces.find((x) => x.name === i.name);
      if (existing) {
        const idx = state.interfaces.indexOf(existing);
        state.interfaces[idx] = {
          ...existing,
          mode,
          ipv4: mode === "static" ? ipv4 : existing.ipv4,
          netmask: mode === "static" ? netmask : existing.netmask,
          gateway: mode === "static" ? gateway : existing.gateway,
          dns: mode === "static" ? dns : existing.dns,
        };
      }
      return ok();
    }
    default:
      return fail("알 수 없는 작업");
  }
}
