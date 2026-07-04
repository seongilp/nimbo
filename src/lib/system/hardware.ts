import { writeFile } from "node:fs/promises";

import type { HardwareOverview, SnmpConfig, UpsStatus } from "@/lib/types";
import { hasCommand, runArgs, USE_MOCK } from "./exec";

const SNMP_CONF = process.env.SNMP_CONF ?? "/etc/snmp/snmpd.conf";

// Community string must be a simple token (no shell metacharacters / config injection).
const COMMUNITY_RE = /^[A-Za-z0-9_\-]+$/;

// Smoothly varying pseudo-random value seeded by time so the gauges feel alive.
function wave(period: number, offset = 0): number {
  const t = Date.now() / 1000;
  return (Math.sin((t / period) * Math.PI * 2 + offset) + 1) / 2; // 0..1
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// --------------------------------------------------------------------------
// Mock state (mutable config; the UPS readings are derived dynamically)
// --------------------------------------------------------------------------
interface State {
  shutdownDelaySeconds: number;
  shutdownAtPercent: number;
  upsMode: "standalone" | "netserver" | "netclient";
  snmp: SnmpConfig;
  // transient: a manual battery test flips the status briefly.
  testUntil: number;
}

// Demo SNMP config — only used in mock/dev mode. On a real deployment the
// config starts from neutral empty defaults and is filled from the actual
// /etc/snmp/snmpd.conf (or left empty if absent).
function seedSnmp(): SnmpConfig {
  return {
    enabled: false,
    version: "v2c",
    community: "public",
    location: "서버실 랙 A",
    contact: "admin@nas.local",
    port: 161,
  };
}

function defaultSnmp(): SnmpConfig {
  return {
    enabled: false,
    version: "v2c",
    community: "",
    location: "",
    contact: "",
    port: 161,
  };
}

const state: State = {
  // Plain config defaults — acceptable in both modes.
  shutdownDelaySeconds: 120,
  shutdownAtPercent: 20,
  upsMode: "standalone",
  // Rich demo SNMP only in mock mode; neutral empty defaults on real deploys.
  snmp: USE_MOCK ? seedSnmp() : defaultSnmp(),
  testUntil: 0,
};

function mockUps(): UpsStatus {
  const onTest = Date.now() < state.testUntil;
  const batteryPercent = Number((96 + wave(47) * 4).toFixed(0)); // 96..100
  return {
    connected: true,
    model: "APC Back-UPS Pro 1500",
    status: onTest ? "onbattery" : "online",
    batteryPercent,
    loadPercent: Number((24 + wave(13) * 9).toFixed(0)), // ~28
    runtimeSeconds: Math.round(2520 + wave(29) * 360), // ~2700
    inputVoltage: Number((224 + wave(11) * 8).toFixed(0)), // 224..232
  };
}

// --------------------------------------------------------------------------
// Real readers (best-effort; never throw)
// --------------------------------------------------------------------------
function mapUpsStatus(raw: string): UpsStatus["status"] {
  const flags = raw.split(/\s+/);
  if (flags.includes("LB")) return "lowbattery";
  if (flags.includes("OB")) return "onbattery";
  if (flags.includes("CHRG")) return "charging";
  if (flags.includes("OL")) return "online";
  return "offline";
}

function parseUpsc(out: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

async function readRealUps(): Promise<UpsStatus> {
  const offline: UpsStatus = {
    connected: false,
    model: "",
    status: "offline",
    batteryPercent: 0,
    loadPercent: 0,
    runtimeSeconds: 0,
    inputVoltage: 0,
  };
  if (!(await hasCommand("upsc"))) return offline;
  const list = await runArgs("upsc", ["-l"]);
  const upsName = list.stdout.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  if (list.code !== 0 || !upsName) return offline;
  const res = await runArgs("upsc", [`${upsName}@localhost`]);
  if (res.code !== 0) return offline;
  const v = parseUpsc(res.stdout);
  const num = (key: string) => {
    const n = Number(v[key]);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    connected: true,
    model: v["ups.model"] || v["device.model"] || upsName,
    status: mapUpsStatus(v["ups.status"] ?? ""),
    batteryPercent: num("battery.charge"),
    loadPercent: num("ups.load"),
    runtimeSeconds: num("battery.runtime"),
    inputVoltage: num("input.voltage"),
  };
}

async function readRealSnmp(): Promise<SnmpConfig> {
  const snmp: SnmpConfig = { ...state.snmp };
  const active = await runArgs("systemctl", ["is-active", "snmpd"]);
  snmp.enabled = active.stdout.trim() === "active";
  const conf = await runArgs("cat", [SNMP_CONF]);
  if (conf.code === 0) {
    const community = conf.stdout.match(/^\s*rocommunity\s+(\S+)/m);
    if (community) snmp.community = community[1];
    const location = conf.stdout.match(/^\s*sysLocation\s+(.+)$/m);
    if (location) snmp.location = location[1].trim();
    const contact = conf.stdout.match(/^\s*sysContact\s+(.+)$/m);
    if (contact) snmp.contact = contact[1].trim();
  }
  return snmp;
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getHardwareOverview(): Promise<HardwareOverview> {
  if (USE_MOCK) {
    return {
      ups: mockUps(),
      shutdownDelaySeconds: state.shutdownDelaySeconds,
      shutdownAtPercent: state.shutdownAtPercent,
      upsMode: state.upsMode,
      snmp: { ...state.snmp },
      isMock: true,
    };
  }
  const [ups, snmp] = await Promise.all([readRealUps(), readRealSnmp()]);
  return {
    ups,
    shutdownDelaySeconds: state.shutdownDelaySeconds,
    shutdownAtPercent: state.shutdownAtPercent,
    upsMode: state.upsMode,
    snmp,
    isMock: false,
  };
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface HardwareAction {
  kind: string;
  // ups.setPolicy
  shutdownDelaySeconds?: number;
  shutdownAtPercent?: number;
  upsMode?: "standalone" | "netserver" | "netclient";
  // snmp.update
  enabled?: boolean;
  version?: "v2c" | "v3";
  community?: string;
  location?: string;
  contact?: string;
  port?: number;
}

function ok(note?: string) {
  return note ? { ok: true as const, note } : { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

function buildSnmpConf(snmp: SnmpConfig): string {
  return [
    "# Generated by Nimbo",
    `agentAddress udp:${snmp.port}`,
    `rocommunity ${snmp.community}`,
    `sysLocation ${snmp.location}`,
    `sysContact ${snmp.contact}`,
    "",
  ].join("\n");
}

export async function runHardwareAction(
  a: HardwareAction
): Promise<{ ok: boolean; error?: string; note?: string }> {
  switch (a.kind) {
    case "ups.setPolicy": {
      if (a.shutdownDelaySeconds !== undefined) {
        state.shutdownDelaySeconds = clamp(Math.round(a.shutdownDelaySeconds), 0, 3600);
      }
      if (a.shutdownAtPercent !== undefined) {
        state.shutdownAtPercent = clamp(Math.round(a.shutdownAtPercent), 0, 100);
      }
      if (a.upsMode === "standalone" || a.upsMode === "netserver" || a.upsMode === "netclient") {
        state.upsMode = a.upsMode;
      }
      if (USE_MOCK) return ok();
      // Real: would rewrite /etc/nut/upsmon.conf (MODE + SHUTDOWNCMD) and reload.
      try {
        const conf =
          `# Generated by Nimbo\nMODE ${state.upsMode}\n` +
          `FINALDELAY ${state.shutdownDelaySeconds}\n`;
        await writeFile("/etc/nut/upsmon.conf", conf, "utf8");
        await runArgs("systemctl", ["reload-or-restart", "nut-monitor"]);
        return ok();
      } catch {
        return ok("권한 필요: /etc/nut/upsmon.conf 를 직접 적용하지 못했습니다.");
      }
    }
    case "snmp.update": {
      if (a.community !== undefined && !COMMUNITY_RE.test(a.community)) {
        return fail("커뮤니티 문자열이 올바르지 않습니다.");
      }
      const next: SnmpConfig = {
        enabled: a.enabled ?? state.snmp.enabled,
        version: a.version === "v2c" || a.version === "v3" ? a.version : state.snmp.version,
        community: a.community ?? state.snmp.community,
        location: a.location ?? state.snmp.location,
        contact: a.contact ?? state.snmp.contact,
        port: a.port !== undefined ? clamp(Math.round(a.port), 1, 65535) : state.snmp.port,
      };
      state.snmp = next;
      if (USE_MOCK) return ok();
      try {
        await writeFile(SNMP_CONF, buildSnmpConf(next), "utf8");
        const toggleArgs = next.enabled
          ? ["enable", "--now", "snmpd"]
          : ["disable", "--now", "snmpd"];
        const { code, stderr } = await runArgs("systemctl", toggleArgs, { timeoutMs: 15000 });
        if (code !== 0) return ok("권한 필요: " + (stderr.trim() || "snmpd 적용 실패"));
        return ok();
      } catch {
        return ok("권한 필요: " + SNMP_CONF + " 를 직접 적용하지 못했습니다.");
      }
    }
    case "ups.test": {
      if (USE_MOCK) {
        // Flip to battery mode briefly; the next poll naturally reads "online".
        state.testUntil = Date.now() + 4000;
        return ok();
      }
      const list = await runArgs("upsc", ["-l"]);
      const upsName = list.stdout.split("\n").map((l) => l.trim()).filter(Boolean)[0];
      if (!upsName) return fail("UPS를 찾을 수 없습니다.");
      const { code, stderr } = await runArgs("upscmd", [upsName, "test.battery.start.quick"]);
      if (code !== 0) return ok("권한 필요: " + (stderr.trim() || "배터리 테스트 실패"));
      return ok();
    }
    default:
      return fail("unknown action");
  }
}
