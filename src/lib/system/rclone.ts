import type {
  CloudJob,
  CloudOverview,
  RcloneRemote,
  RcloneType,
  SyncSchedule,
} from "@/lib/types";
import { hasCommand, run, USE_MOCK } from "./exec";

const GiB = 1024 ** 3;

const SCHED_MS: Record<Exclude<SyncSchedule, "manual">, number> = {
  hourly: 3600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

// rclone remote endpoints look like `remoteName:path`. Allow a safe charset.
const ENDPOINT_RE = /^[A-Za-z0-9@._:\-/]+$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_\- ]*$/;
// Remote names alone (no slashes/colons) — used for `rclone config delete`.
const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_\-]*$/;

const KNOWN_TYPES: RcloneType[] = [
  "s3",
  "drive",
  "dropbox",
  "b2",
  "onedrive",
  "sftp",
  "gcs",
  "mega",
  "webdav",
];

interface State {
  remotes: RcloneRemote[];
  jobs: CloudJob[];
}

const state: State = {
  remotes: [
    { name: "s3-backup", type: "s3", usedBytes: 312 * GiB, totalBytes: null },
    { name: "gdrive", type: "drive", usedBytes: 9.4 * GiB, totalBytes: 15 * GiB },
    { name: "dropbox", type: "dropbox", usedBytes: 1.7 * GiB, totalBytes: 2 * GiB },
    { name: "b2-cold", type: "b2", usedBytes: 1240 * GiB, totalBytes: null },
  ],
  jobs: [
    {
      id: "cjob-1",
      name: "사진 → S3 백업",
      direction: "push",
      remote: "s3-backup:nas/photos",
      localPath: "/volume1/Photos",
      operation: "sync",
      schedule: "daily",
      lastRun: Date.now() - 9 * 3600_000,
      lastStatus: "success",
      lastBytes: 6.1 * GiB,
      lastFiles: 2310,
      nextRun: Date.now() + 15 * 3600_000,
    },
    {
      id: "cjob-2",
      name: "구글 드라이브에서 문서 가져오기",
      direction: "pull",
      remote: "gdrive:Work/Documents",
      localPath: "/volume1/Documents",
      operation: "copy",
      schedule: "hourly",
      lastRun: Date.now() - 18 * 60_000,
      lastStatus: "success",
      lastBytes: 124 * 1024 * 1024,
      lastFiles: 87,
      nextRun: Date.now() + 42 * 60_000,
    },
    {
      id: "cjob-3",
      name: "영상 → 콜드 보관소",
      direction: "push",
      remote: "b2-cold:archive/movies",
      localPath: "/volume1/Movies",
      operation: "sync",
      schedule: "weekly",
      lastRun: Date.now() - 2 * 86_400_000,
      lastStatus: "failed",
      lastBytes: 0,
      lastFiles: 0,
      lastError: "Failed to copy: 403 Forbidden — application key expired",
      nextRun: Date.now() + 5 * 86_400_000,
    },
  ],
};

function nextRunFor(schedule: SyncSchedule): number | null {
  return schedule === "manual" ? null : Date.now() + SCHED_MS[schedule];
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
function parseType(raw: string): RcloneType {
  const t = raw.trim().toLowerCase();
  const match = KNOWN_TYPES.find((k) => k === t);
  return match ?? "webdav";
}

async function loadRealRemotes(): Promise<RcloneRemote[]> {
  // Prefer `--long` which prints `name: type`; fall back to plain names.
  const long = await run("rclone listremotes --long");
  const lines = (long.code === 0 ? long.stdout : "").split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: { name: string; type: RcloneType }[] = [];

  if (lines.length > 0) {
    for (const line of lines) {
      // Format: "name: type"
      const m = line.match(/^(.+?):\s*(\S+)\s*$/);
      if (m) {
        entries.push({ name: m[1].trim(), type: parseType(m[2]) });
      }
    }
  }

  if (entries.length === 0) {
    const plain = await run("rclone listremotes");
    const names = (plain.code === 0 ? plain.stdout : "")
      .split("\n")
      .map((l) => l.trim().replace(/:$/, ""))
      .filter(Boolean);
    for (const name of names) entries.push({ name, type: "webdav" });
  }

  const remotes: RcloneRemote[] = [];
  for (const e of entries) {
    let usedBytes: number | null = null;
    let totalBytes: number | null = null;
    if (REMOTE_NAME_RE.test(e.name)) {
      const about = await run(`rclone about ${e.name}: --json`, { timeoutMs: 15000 });
      if (about.code === 0) {
        try {
          const j = JSON.parse(about.stdout) as { used?: number; total?: number };
          usedBytes = typeof j.used === "number" ? j.used : null;
          totalBytes = typeof j.total === "number" ? j.total : null;
        } catch {
          // best-effort; leave as null
        }
      }
    }
    remotes.push({ name: e.name, type: e.type, usedBytes, totalBytes });
  }
  return remotes;
}

export async function getCloudOverview(): Promise<CloudOverview> {
  startScheduler();
  let rcloneAvailable = true;
  if (!USE_MOCK) {
    rcloneAvailable = await hasCommand("rclone");
    if (rcloneAvailable) {
      state.remotes = await loadRealRemotes();
    }
  }
  return {
    remotes: state.remotes,
    jobs: state.jobs,
    rcloneAvailable,
    isMock: USE_MOCK,
  };
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface CloudAction {
  kind: string;
  id?: string;
  job?: Partial<CloudJob>;
  name?: string;
  type?: RcloneType;
  config?: Record<string, string>;
}

// Single-quote a value for safe shell interpolation.
function shq(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

export async function runCloudAction(a: CloudAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "job.create": {
      const j = a.job ?? {};
      if (!j.name || !NAME_RE.test(j.name)) return fail("invalid name");
      if (!j.remote || !ENDPOINT_RE.test(j.remote)) return fail("invalid remote");
      if (!j.localPath || !ENDPOINT_RE.test(j.localPath)) return fail("invalid local path");
      const schedule = (j.schedule ?? "manual") as SyncSchedule;
      const id = `cjob-${Date.now()}`;
      state.jobs.push({
        id,
        name: j.name,
        direction: j.direction === "pull" ? "pull" : "push",
        remote: j.remote,
        localPath: j.localPath,
        operation: j.operation === "copy" ? "copy" : "sync",
        schedule,
        lastRun: null,
        lastStatus: "idle",
        lastBytes: 0,
        lastFiles: 0,
        nextRun: nextRunFor(schedule),
      });
      return ok();
    }
    case "job.update": {
      const job = state.jobs.find((x) => x.id === a.id);
      if (!job || !a.job) return fail("not found");
      const j = a.job;
      if (j.name && !NAME_RE.test(j.name)) return fail("invalid name");
      if (j.remote && !ENDPOINT_RE.test(j.remote)) return fail("invalid remote");
      if (j.localPath && !ENDPOINT_RE.test(j.localPath)) return fail("invalid local path");
      Object.assign(job, {
        name: j.name ?? job.name,
        direction: j.direction ?? job.direction,
        remote: j.remote ?? job.remote,
        localPath: j.localPath ?? job.localPath,
        operation: j.operation ?? job.operation,
        schedule: j.schedule ?? job.schedule,
      });
      job.nextRun = nextRunFor(job.schedule);
      return ok();
    }
    case "job.delete":
      state.jobs = state.jobs.filter((x) => x.id !== a.id);
      return ok();
    case "job.run": {
      const job = state.jobs.find((x) => x.id === a.id);
      if (!job) return fail("not found");
      return runJob(job);
    }
    case "remote.create": {
      const name = a.name;
      const type = a.type;
      const config = a.config ?? {};
      if (!name || !REMOTE_NAME_RE.test(name)) return fail("invalid remote name");
      if (!type || !KNOWN_TYPES.includes(type)) return fail("invalid type");
      if (state.remotes.some((r) => r.name === name)) return fail("이미 존재하는 원격 이름입니다");
      if (USE_MOCK) {
        const seeded = type === "drive" ? 15 * GiB : type === "dropbox" ? 2 * GiB : null;
        state.remotes.push({ name, type, usedBytes: seeded != null ? 0 : null, totalBytes: seeded });
        return ok();
      }
      // Build `rclone config create <name> <type> key 'value' key 'value' ...`
      const pairs = Object.entries(config).filter(([k, v]) => /^[a-z0-9_]+$/i.test(k) && v !== "" && v != null);
      const argStr = pairs.map(([k, v]) => `${k} ${shq(v)}`).join(" ");
      const { code, stderr } = await run(`rclone config create ${shq(name)} ${type} ${argStr}`, { timeoutMs: 20000 });
      if (code !== 0) return fail(stderr.trim().split("\n").slice(-1)[0] || "config create failed");
      return ok();
    }
    case "remote.delete": {
      if (!a.name || !REMOTE_NAME_RE.test(a.name)) return fail("invalid remote name");
      if (!USE_MOCK) {
        const { code, stderr } = await run(`rclone config delete ${a.name}`, { timeoutMs: 15000 });
        if (code !== 0) return fail(stderr.trim().split("\n").slice(-1)[0] || "config delete failed");
      }
      state.remotes = state.remotes.filter((r) => r.name !== a.name);
      return ok();
    }
    default:
      return fail("unknown action");
  }
}

// --------------------------------------------------------------------------
// Job execution
// --------------------------------------------------------------------------
function parseStats(output: string): { bytes: number; files: number } {
  // `--stats-one-line` emits e.g.
  //   "Transferred:   1.234 GiB / 1.234 GiB, 100%, 12.3 MiB/s, ETA 0s"
  //   "Transferred:   42 / 42, 100%"  (file count line)
  const bytesM = output.match(/Transferred:\s*([\d.]+)\s*(B|KiB|MiB|GiB|TiB)\b/);
  const filesM = output.match(/Transferred:\s*(\d+)\s*\/\s*\d+\s*,/);
  const unitFactor: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  };
  return {
    bytes: bytesM ? Math.round(Number(bytesM[1]) * (unitFactor[bytesM[2]] ?? 1)) : 0,
    files: filesM ? Number(filesM[1]) : 0,
  };
}

async function runJob(job: CloudJob): Promise<{ ok: boolean; error?: string }> {
  job.lastStatus = "running";

  if (USE_MOCK) {
    job.lastRun = Date.now();
    const shouldFail = /cold/.test(job.remote) || job.id === "cjob-3";
    if (shouldFail) {
      job.lastStatus = "failed";
      job.lastError = "Failed to copy: 403 Forbidden — application key expired";
      job.lastBytes = 0;
      job.lastFiles = 0;
    } else {
      job.lastStatus = "success";
      job.lastError = undefined;
      job.lastFiles = 20 + Math.floor((job.localPath.length * 37) % 600);
      job.lastBytes = (0.3 + ((job.name.length * 17) % 70) / 10) * GiB;
    }
    if (job.schedule !== "manual") job.nextRun = nextRunFor(job.schedule);
    return job.lastStatus === "success" ? ok() : fail(job.lastError ?? "failed");
  }

  const src = job.direction === "pull" ? job.remote : job.localPath;
  const dst = job.direction === "pull" ? job.localPath : job.remote;
  if (!ENDPOINT_RE.test(src) || !ENDPOINT_RE.test(dst)) {
    job.lastStatus = "failed";
    job.lastError = "invalid endpoint";
    return fail("invalid endpoint");
  }
  const op = job.operation === "copy" ? "copy" : "sync";
  const { stdout, stderr, code } = await run(
    `rclone ${op} ${src} ${dst} --stats-one-line`,
    { timeoutMs: 30 * 60_000 }
  );
  job.lastRun = Date.now();
  if (code === 0) {
    const { bytes, files } = parseStats(stdout + "\n" + stderr);
    job.lastStatus = "success";
    job.lastBytes = bytes;
    job.lastFiles = files;
    job.lastError = undefined;
  } else {
    job.lastStatus = "failed";
    job.lastError = stderr.trim().split("\n").slice(-1)[0] || "rclone failed";
  }
  if (job.schedule !== "manual") job.nextRun = nextRunFor(job.schedule);
  return code === 0 ? ok() : fail(job.lastError ?? "failed");
}

// --------------------------------------------------------------------------
// Scheduler
// --------------------------------------------------------------------------
let tickerStarted = false;
function startScheduler() {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const job of state.jobs) {
      if (job.schedule === "manual" || job.nextRun == null || job.nextRun > now) continue;
      if (job.lastStatus === "running") continue;
      runJob(job).catch(() => {});
    }
  }, 60_000);
}
