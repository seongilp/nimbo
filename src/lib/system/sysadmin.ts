import type {
  CronJob,
  LogEntry,
  ServiceUnit,
  SystemAdminOverview,
} from "@/lib/types";
import { runArgs, USE_MOCK } from "./exec";

const MiB = 1024 * 1024;

// Safe charset for systemd unit names / cron ids — rejects shell metacharacters.
const NAME_RE = /^[A-Za-z0-9@._\-:]+$/;

// --------------------------------------------------------------------------
// Mock state (mutable module-level)
// --------------------------------------------------------------------------
interface State {
  services: ServiceUnit[];
  cron: CronJob[];
  logs: LogEntry[];
}

const now = Date.now();
const min = 60_000;

const state: State = {
  services: [
    { name: "smbd", description: "Samba SMB daemon", active: "active", enabled: true, memoryBytes: 42 * MiB },
    { name: "nfs-server", description: "NFS server and services", active: "active", enabled: true, memoryBytes: 8 * MiB },
    { name: "sshd", description: "OpenSSH server daemon", active: "active", enabled: true, memoryBytes: 11 * MiB },
    { name: "docker", description: "Docker Application Container Engine", active: "active", enabled: true, memoryBytes: 318 * MiB },
    { name: "nginx", description: "A high performance web server and reverse proxy", active: "active", enabled: true, memoryBytes: 27 * MiB },
    { name: "rsync", description: "fast remote file copy daemon", active: "active", enabled: true, memoryBytes: 4 * MiB },
    { name: "zfs-zed", description: "ZFS Event Daemon (zed)", active: "active", enabled: true, memoryBytes: 6 * MiB },
    { name: "cron", description: "Regular background program processing daemon", active: "active", enabled: true, memoryBytes: 3 * MiB },
    { name: "systemd-resolved", description: "Network Name Resolution", active: "active", enabled: true, memoryBytes: 9 * MiB },
    { name: "nut-monitor", description: "Network UPS Tools - power device monitor", active: "failed", enabled: true, memoryBytes: 0 },
  ],
  cron: [
    { id: "cron-1", schedule: "0 3 * * *", command: "/usr/local/bin/zfs-backup.sh", user: "root", enabled: true, comment: "야간 백업" },
    { id: "cron-2", schedule: "*/15 * * * *", command: "/usr/local/bin/healthcheck.sh", user: "root", enabled: true, comment: "상태 점검" },
    { id: "cron-3", schedule: "0 5 * * 0", command: "/usr/local/bin/smart-test.sh --long", user: "root", enabled: false, comment: "주간 SMART 검사 (비활성)" },
    { id: "cron-4", schedule: "@reboot", command: "/usr/local/bin/mount-shares.sh", user: "root", enabled: true, comment: "부팅 시 공유 마운트" },
  ],
  logs: buildMockLogs(),
};

function buildMockLogs(): LogEntry[] {
  // Descending timestamps via offsets from now.
  const raw: Array<[number, string, LogEntry["level"], string]> = [
    [12 * 1000, "sshd", "info", "Accepted publickey for admin from 192.168.1.42 port 51234"],
    [48 * 1000, "smbd", "info", "잠금 해제: //nas/photos (사용자 admin)"],
    [95 * 1000, "docker", "info", "Container nextcloud-app started"],
    [2 * min, "nut-monitor", "error", "UPS ups@localhost is unavailable: 연결 실패"],
    [3 * min, "kernel", "warning", "ata3.00: failed command: READ FPDMA QUEUED"],
    [4 * min, "zed", "warning", "ZFS scrub: tank 풀에서 체크섬 오류 1건 복구됨"],
    [6 * min, "nginx", "info", "192.168.1.10 - GET /api/system 200"],
    [8 * min, "sshd", "warning", "Failed password for invalid user test from 203.0.113.7"],
    [9 * min, "docker", "info", "Pulling image postgres:16 ... done"],
    [11 * min, "smbd", "info", "session setup 완료: 사용자 zihado"],
    [14 * min, "cron", "info", "(root) CMD (/usr/local/bin/healthcheck.sh)"],
    [16 * min, "kernel", "info", "eth0: link up, 1000 Mbps, full duplex"],
    [19 * min, "zed", "info", "ZFS: vdev state changed for tank, GUID 1234567890"],
    [22 * min, "nut-monitor", "error", "Communications lost with UPS ups@localhost"],
    [25 * min, "sshd", "debug", "rexec line 1: Protocol 2"],
    [28 * min, "nginx", "error", "upstream timed out (110: Connection timed out) while reading response"],
    [33 * min, "docker", "warning", "Health check failed for container grafana"],
    [37 * min, "smbd", "info", "공유 백업 폴더에 12개 파일 기록됨"],
    [42 * min, "kernel", "info", "usb 2-1: new high-speed USB device number 4"],
    [48 * min, "cron", "info", "(root) CMD (/usr/local/bin/zfs-backup.sh)"],
    [55 * min, "zed", "info", "ZFS scrub started on pool tank"],
    [63 * min, "sshd", "info", "Received disconnect from 192.168.1.42: 11: disconnected by user"],
    [72 * min, "nginx", "info", "reloaded configuration successfully"],
    [88 * min, "docker", "info", "Container nextcloud-db is healthy"],
    [105 * min, "kernel", "debug", "EXT4-fs (sda1): mounted filesystem with ordered data mode"],
  ];
  return raw.map(([offset, unit, level, message]) => ({ ts: now - offset, unit, level, message }));
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getSystemAdminOverview(): Promise<SystemAdminOverview> {
  if (USE_MOCK) {
    return { services: state.services, cron: state.cron, logs: state.logs, isMock: true };
  }
  const [services, cron, logs] = await Promise.all([
    readServices(),
    readCron(),
    readLogs(),
  ]);
  return { services, cron, logs, isMock: false };
}

// Map every service's enabled state in ONE call. Doing a per-service
// `systemctl is-enabled` (188+ sudo-wrapped spawns) made /api/system take ~13s.
async function readEnabledMap(): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  const { stdout, code } = await runArgs("systemctl", [
    "list-unit-files",
    "--type=service",
    "--no-legend",
    "--no-pager",
    "--plain",
  ]);
  if (code !== 0) return map;
  for (const line of stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const name = parts[0].replace(/\.service$/, "");
    map.set(name, parts[1] === "enabled");
  }
  return map;
}

async function readServices(): Promise<ServiceUnit[]> {
  const [list, enabledMap] = await Promise.all([
    runArgs("systemctl", [
      "list-units",
      "--type=service",
      "--all",
      "--no-legend",
      "--no-pager",
      "--plain",
    ]),
    readEnabledMap(),
  ]);
  const { stdout, code } = list;
  if (code !== 0 || !stdout.trim()) return [];
  const units: ServiceUnit[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Columns: UNIT LOAD ACTIVE SUB DESCRIPTION
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const name = parts[0].replace(/\.service$/, "");
    const activeRaw = parts[2];
    const description = parts.slice(4).join(" ");
    const active: ServiceUnit["active"] =
      activeRaw === "active" || activeRaw === "inactive" || activeRaw === "failed" || activeRaw === "activating"
        ? activeRaw
        : "inactive";
    units.push({ name, description, active, enabled: enabledMap.get(name) ?? false, memoryBytes: 0 });
  }
  return units;
}

async function readCron(): Promise<CronJob[]> {
  const { stdout, code } = await runArgs("crontab", ["-l"]);
  if (code !== 0 || !stdout.trim()) return [];
  const jobs: CronJob[] = [];
  let pendingComment = "";
  let i = 0;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingComment = "";
      continue;
    }
    if (trimmed.startsWith("#")) {
      pendingComment = trimmed.replace(/^#+\s*/, "");
      continue;
    }
    // schedule = first 5 fields, or @keyword + command
    let schedule: string;
    let command: string;
    if (trimmed.startsWith("@")) {
      const sp = trimmed.indexOf(" ");
      schedule = sp === -1 ? trimmed : trimmed.slice(0, sp);
      command = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
    } else {
      const fields = trimmed.split(/\s+/);
      if (fields.length < 6) continue;
      schedule = fields.slice(0, 5).join(" ");
      command = fields.slice(5).join(" ");
    }
    jobs.push({ id: `cron-${i}`, schedule, command, user: "root", enabled: true, comment: pendingComment });
    pendingComment = "";
    i++;
  }
  return jobs;
}

const PRIORITY_LEVEL: Record<string, LogEntry["level"]> = {
  "0": "error", "1": "error", "2": "error", "3": "error",
  "4": "warning", "5": "info", "6": "info", "7": "debug",
};

async function readLogs(): Promise<LogEntry[]> {
  const { stdout, code } = await runArgs("journalctl", [
    "-n",
    "100",
    "-o",
    "short-iso",
    "--no-pager",
  ]);
  if (code !== 0 || !stdout.trim()) return [];
  const entries: LogEntry[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    // Format: 2024-01-01T03:00:00+0000 hostname unit[pid]: message
    const m = trimmed.match(/^(\S+)\s+\S+\s+([^\s:[]+)(?:\[\d+\])?:\s?(.*)$/);
    if (!m) continue;
    const ts = Date.parse(m[1]);
    const unit = m[2];
    const message = m[3];
    const lower = message.toLowerCase();
    const level: LogEntry["level"] = /\b(error|failed|fatal)\b/.test(lower)
      ? "error"
      : /\b(warn|warning)\b/.test(lower)
        ? "warning"
        : /\bdebug\b/.test(lower)
          ? "debug"
          : "info";
    entries.push({ ts: Number.isNaN(ts) ? Date.now() : ts, unit, level, message });
  }
  // Descending by timestamp.
  return entries.sort((a, b) => b.ts - a.ts);
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface SystemAction {
  kind: string;
  name?: string;
  id?: string;
  enabled?: boolean;
  cron?: { schedule?: string; command?: string; user?: string; comment?: string };
}

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

const SERVICE_VERB: Record<string, string> = {
  "service.start": "start",
  "service.stop": "stop",
  "service.restart": "restart",
  "service.enable": "enable",
  "service.disable": "disable",
};

export async function runSystemAction(a: SystemAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "service.start":
    case "service.stop":
    case "service.restart":
    case "service.enable":
    case "service.disable": {
      const name = a.name ?? "";
      if (!NAME_RE.test(name)) return fail("잘못된 서비스 이름");
      const svc = state.services.find((s) => s.name === name);
      const verb = SERVICE_VERB[a.kind];
      if (USE_MOCK) {
        if (!svc) return fail("서비스를 찾을 수 없습니다");
        if (a.kind === "service.start") svc.active = "active";
        else if (a.kind === "service.stop") svc.active = "inactive";
        else if (a.kind === "service.restart") svc.active = "active";
        else if (a.kind === "service.enable") svc.enabled = true;
        else if (a.kind === "service.disable") svc.enabled = false;
        return ok();
      }
      const { code, stderr } = await runArgs("systemctl", [verb, name], { timeoutMs: 20000 });
      return code === 0 ? ok() : fail(stderr.trim() || "root/sudoers 권한이 필요합니다");
    }

    case "cron.create": {
      const c = a.cron ?? {};
      const schedule = (c.schedule ?? "").trim();
      const command = (c.command ?? "").trim();
      if (!schedule) return fail("스케줄을 입력하세요");
      if (!command) return fail("명령을 입력하세요");
      if (USE_MOCK) {
        state.cron.push({
          id: `cron-${Date.now()}`,
          schedule,
          command,
          user: (c.user ?? "root").trim() || "root",
          enabled: true,
          comment: (c.comment ?? "").trim(),
        });
        return ok();
      }
      return fail("크론 편집은 권한이 필요합니다");
    }

    case "cron.delete": {
      if (USE_MOCK) {
        state.cron = state.cron.filter((j) => j.id !== a.id);
        return ok();
      }
      return fail("크론 편집은 권한이 필요합니다");
    }

    case "cron.toggle": {
      if (USE_MOCK) {
        const job = state.cron.find((j) => j.id === a.id);
        if (!job) return fail("작업을 찾을 수 없습니다");
        job.enabled = a.enabled ?? !job.enabled;
        return ok();
      }
      return fail("크론 편집은 권한이 필요합니다");
    }

    default:
      return fail("알 수 없는 작업");
  }
}
