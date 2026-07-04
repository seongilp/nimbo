import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import type {
  ArcStats,
  ScanStatus,
  ScheduleInterval,
  SnapshotSchedule,
  Vdev,
  VdevType,
  ZfsDataset,
  ZfsDevice,
  ZfsOverview,
  ZfsSnapshot,
  ZpoolInfo,
} from "@/lib/types";
import { hasCommand, run, runArgs, USE_MOCK } from "./exec";
import { emitEvent } from "./notify";

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]*$/;
const SNAP_RE = /^[A-Za-z0-9][A-Za-z0-9_.:\-/]*@[A-Za-z0-9][A-Za-z0-9_.:\-]*$/;

function wave(period: number, offset = 0): number {
  const t = Date.now() / 1000;
  return (Math.sin((t / period) * Math.PI * 2 + offset) + 1) / 2;
}

// --------------------------------------------------------------------------
// Mutable mock model — persists within the dev server process so create /
// destroy / scrub actions are reflected in subsequent reads.
// --------------------------------------------------------------------------
interface MockState {
  scrub: Record<string, { startedAt: number; resilver: boolean } | undefined>;
  datasets: ZfsDataset[];
  snapshots: ZfsSnapshot[];
  devices: ZfsDevice[];
  schedules: SnapshotSchedule[];
  pools: ZpoolInfo[];
}

const INTERVAL_MS: Record<ScheduleInterval, number> = {
  hourly: 3600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

function seedDevices(): ZfsDevice[] {
  const GB = GiB;
  return [
    { path: "/dev/disk/by-id/ata-WDC_WD60EFRX-FREE1", name: "sdg", sizeBytes: 6 * TiB, model: "WDC WD60EFRX", inUse: false },
    { path: "/dev/disk/by-id/ata-WDC_WD60EFRX-FREE2", name: "sdh", sizeBytes: 6 * TiB, model: "WDC WD60EFRX", inUse: false },
    { path: "/dev/disk/by-id/ata-ST8000VN004-FREE1", name: "sdi", sizeBytes: 8 * TiB, model: "Seagate IronWolf 8TB", inUse: false },
    { path: "/dev/disk/by-id/ata-ST8000VN004-FREE2", name: "sdj", sizeBytes: 8 * TiB, model: "Seagate IronWolf 8TB", inUse: false },
    { path: "/dev/disk/by-id/nvme-Samsung_990_PRO-FREE", name: "nvme1n1", sizeBytes: 1 * TiB, model: "Samsung 990 PRO 1TB", inUse: false },
    { path: "/dev/disk/by-id/ata-CT500MX500-SPARE", name: "sdk", sizeBytes: 500 * GB, model: "Crucial MX500 500GB", inUse: false },
  ];
}

function seedSchedules(): SnapshotSchedule[] {
  const now = Date.now();
  return [
    { id: "sch-1", dataset: "tank/photos", interval: "daily", keep: 7, recursive: false, enabled: true, lastRun: now - 9 * 3600_000, nextRun: now + 15 * 3600_000 },
    { id: "sch-2", dataset: "tank/media", interval: "hourly", keep: 24, recursive: false, enabled: true, lastRun: now - 40 * 60_000, nextRun: now + 20 * 60_000 },
    { id: "sch-3", dataset: "tank/backups", interval: "weekly", keep: 4, recursive: true, enabled: false, lastRun: now - 5 * 86_400_000, nextRun: now + 2 * 86_400_000 },
  ];
}

function seedDatasets(): ZfsDataset[] {
  const ds = (
    name: string,
    used: number,
    refer: number,
    over: Partial<ZfsDataset> = {}
  ): ZfsDataset => ({
    name,
    type: "filesystem",
    usedBytes: used,
    availBytes: 9.2 * TiB,
    referBytes: refer,
    mountpoint: "/" + name,
    compression: "lz4",
    compressRatio: 1.3 + wave(40) * 0.6,
    dedup: "off",
    recordsize: "128K",
    quotaBytes: null,
    reservationBytes: null,
    atime: false,
    readonly: false,
    encrypted: false,
    snapshotCount: 0,
    ...over,
  });
  return [
    ds("tank", 4.9 * TiB, 192 * 1024),
    ds("tank/media", 2.7 * TiB, 2.7 * TiB, { recordsize: "1M", snapshotCount: 3 }),
    ds("tank/photos", 880 * GiB, 880 * GiB, { snapshotCount: 5 }),
    ds("tank/backups", 1.1 * TiB, 1.1 * TiB, { compression: "zstd-3", compressRatio: 2.1, quotaBytes: 2 * TiB, snapshotCount: 2 }),
    ds("tank/vm", 220 * GiB, 4 * GiB, { type: "volume", recordsize: "16K", mountpoint: "-" }),
    ds("tank/encrypted", 64 * GiB, 64 * GiB, { encrypted: true, snapshotCount: 1 }),
    ds("backup", 1.2 * TiB, 96 * 1024, { availBytes: 2.6 * TiB }),
    ds("backup/archive", 1.2 * TiB, 1.2 * TiB, { compression: "zstd-9", compressRatio: 2.8, availBytes: 2.6 * TiB, readonly: true }),
  ];
}

function seedSnapshots(): ZfsSnapshot[] {
  const now = Date.now();
  const day = 86_400_000;
  const make = (dataset: string, snap: string, used: number, refer: number, age: number): ZfsSnapshot => ({
    name: `${dataset}@${snap}`,
    dataset,
    snap,
    usedBytes: used,
    referBytes: refer,
    creation: now - age,
  });
  return [
    make("tank/media", "auto-2026-06-27-0000", 1.2 * GiB, 2.7 * TiB, 0.4 * day),
    make("tank/media", "auto-2026-06-26-0000", 3.4 * GiB, 2.69 * TiB, 1 * day),
    make("tank/media", "before-cleanup", 12 * GiB, 2.6 * TiB, 6 * day),
    make("tank/photos", "auto-2026-06-27-0000", 240 * 1024 * 1024, 880 * GiB, 0.4 * day),
    make("tank/photos", "auto-2026-06-20-0000", 4.1 * GiB, 870 * GiB, 7 * day),
    make("tank/backups", "weekly-2026-06-22", 88 * GiB, 1.0 * TiB, 5 * day),
    make("tank/encrypted", "init", 12 * GiB, 64 * GiB, 30 * day),
  ];
}

// Demo arrays are seeded ONLY in mock/dev mode. On a real host pools/datasets/
// snapshots/devices come from the real readers, and snapshot schedules are an
// app-managed store that starts empty and fills as the user creates them.
const mock: MockState = {
  scrub: {},
  datasets: USE_MOCK ? seedDatasets() : [],
  snapshots: USE_MOCK ? seedSnapshots() : [],
  devices: USE_MOCK ? seedDevices() : [],
  schedules: USE_MOCK ? seedSchedules() : [],
  pools: USE_MOCK ? seedPools() : [],
};

function mockPoolsRead(): ZpoolInfo[] {
  // Recompute live scan + derived capacity at read time.
  return mock.pools.map((p) => {
    const capacityPercent = p.sizeBytes > 0 ? Math.round((p.allocBytes / p.sizeBytes) * 100) : 0;
    return { ...p, capacityPercent, freeBytes: p.sizeBytes - p.allocBytes, scan: mockScan(p.name) };
  });
}

// --- Snapshot scheduler ----------------------------------------------------
// A background ticker evaluates schedules and takes snapshots when due, then
// prunes to the keep count. In mock mode it mutates the in-memory model; on a
// real host it shells out to `zfs`. Started once per server process.
function snapName(interval: ScheduleInterval): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `auto-${interval}-${stamp}`;
}

async function runSchedule(s: SnapshotSchedule): Promise<void> {
  const name = snapName(s.interval);
  await runZfsAction({ kind: "snapshot.create", name: s.dataset, target: name, recursive: s.recursive });
  // Prune oldest auto snapshots of the same interval beyond keep count.
  const prefix = `auto-${s.interval}-`;
  if (USE_MOCK) {
    const matching = mock.snapshots
      .filter((sn) => sn.dataset === s.dataset && sn.snap.startsWith(prefix))
      .sort((a, b) => b.creation - a.creation);
    for (const old of matching.slice(s.keep)) {
      mock.snapshots = mock.snapshots.filter((x) => x.name !== old.name);
    }
  } else {
    const { stdout } = await runArgs("zfs", ["list", "-t", "snapshot", "-Hp", "-o", "name,creation", "-s", "creation"]);
    const names = stdout
      .split("\n")
      .map((l) => l.split("\t")[0])
      .filter((n) => n?.startsWith(`${s.dataset}@${prefix}`));
    for (const old of names.slice(0, Math.max(0, names.length - s.keep))) {
      await runArgs("zfs", ["destroy", old]);
    }
  }
}

// Snapshot schedules persist across restarts (real mode) so a reboot does not
// silently drop the user's snapshot policy.
// Path derived from a runtime env var, so the file tracer can't resolve it
// statically and emits a benign "whole project traced" build warning. The
// bundle stays clean regardless — next.config.ts `outputFileTracingExcludes`
// strips src/deploy/docs from the standalone output.
const SCHED_FILE =
  process.env.NIMBO_ZFS_SCHED_FILE ??
  nodePath.join(nodePath.dirname(process.env.NIMBO_AUTH_FILE ?? "/etc/nimbo/users.json"), "zfs-schedules.json");

let schedulesLoaded = USE_MOCK; // mock seeds in-memory; real mode hydrates from disk
async function ensureSchedulesLoaded(): Promise<void> {
  if (schedulesLoaded) return;
  schedulesLoaded = true;
  try {
    const arr = JSON.parse(await readFile(SCHED_FILE, "utf8"));
    if (Array.isArray(arr)) mock.schedules = arr as SnapshotSchedule[];
  } catch {
    // no persisted schedules yet
  }
}
async function persistSchedules(): Promise<void> {
  if (USE_MOCK) return;
  try {
    await mkdir(nodePath.dirname(SCHED_FILE), { recursive: true });
    await writeFile(SCHED_FILE, JSON.stringify(mock.schedules, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

let tickerStarted = false;
function startScheduler() {
  if (tickerStarted) return;
  tickerStarted = true;
  setInterval(async () => {
    const now = Date.now();
    let changed = false;
    for (const s of mock.schedules) {
      if (!s.enabled || s.nextRun > now) continue;
      try {
        await runSchedule(s);
      } catch {
        /* ignore scheduler errors */
      }
      s.lastRun = now;
      s.nextRun = now + INTERVAL_MS[s.interval];
      changed = true;
    }
    if (changed) void persistSchedules();
  }, 30_000);
}

function vdevDisk(name: string, state: Vdev["state"] = "ONLINE"): Vdev {
  return { name, type: "disk", state, readErrors: 0, writeErrors: 0, cksumErrors: 0 };
}

function mockScan(pool: string): ScanStatus {
  const s = mock.scrub[pool];
  if (!s) return { state: "none", progressPercent: 0, repairedBytes: 0, errors: 0, speedBytesPerSec: 0, finishedAt: Date.now() - 4 * 86_400_000 };
  const elapsed = (Date.now() - s.startedAt) / 1000;
  const duration = 90; // seconds to complete in demo
  const pct = Math.min(100, (elapsed / duration) * 100);
  if (pct >= 100) {
    mock.scrub[pool] = undefined;
    void emitEvent("scrub.finished", "info", `스크럽 완료: ${pool}`, `${pool} 풀 스크럽이 오류 없이 완료되었습니다.`);
    return { state: "finished", progressPercent: 100, repairedBytes: 0, errors: 0, speedBytesPerSec: 0, finishedAt: Date.now() };
  }
  return {
    state: s.resilver ? "resilvering" : "scrubbing",
    progressPercent: Number(pct.toFixed(1)),
    repairedBytes: 0,
    errors: 0,
    speedBytesPerSec: (380 + wave(5) * 240) * 1024 * 1024,
    finishedAt: null,
  };
}

function noScan(): ScanStatus {
  return {
    state: "none",
    progressPercent: 0,
    repairedBytes: 0,
    errors: 0,
    speedBytesPerSec: 0,
    finishedAt: Date.now() - 4 * 86_400_000,
  };
}

function seedPools(): ZpoolInfo[] {
  return [
    {
      name: "tank",
      health: "ONLINE",
      sizeBytes: 21.8 * TiB,
      allocBytes: 9.9 * TiB,
      freeBytes: 11.9 * TiB,
      capacityPercent: 45,
      fragPercent: 8,
      dedupRatio: 1.0,
      readErrors: 0,
      writeErrors: 0,
      cksumErrors: 0,
      autotrim: true,
      scan: noScan(),
      vdevs: [
        {
          name: "raidz2-0",
          type: "raidz2",
          state: "ONLINE",
          readErrors: 0,
          writeErrors: 0,
          cksumErrors: 0,
          children: [
            vdevDisk("ata-WDC_WD60EFRX-001"),
            vdevDisk("ata-WDC_WD60EFRX-002"),
            vdevDisk("ata-WDC_WD60EFRX-003"),
            vdevDisk("ata-WDC_WD60EFRX-004"),
            vdevDisk("ata-WDC_WD60EFRX-005"),
            vdevDisk("ata-WDC_WD60EFRX-006"),
          ],
        },
        {
          name: "logs",
          type: "log",
          state: "ONLINE",
          readErrors: 0,
          writeErrors: 0,
          cksumErrors: 0,
          children: [vdevDisk("nvme-INTEL_OPTANE-slog")],
        },
        {
          name: "cache",
          type: "cache",
          state: "ONLINE",
          readErrors: 0,
          writeErrors: 0,
          cksumErrors: 0,
          children: [vdevDisk("nvme-Samsung_980-l2arc")],
        },
      ],
    },
    {
      name: "backup",
      health: "DEGRADED",
      sizeBytes: 3.6 * TiB,
      allocBytes: 1.2 * TiB,
      freeBytes: 2.4 * TiB,
      capacityPercent: 33,
      fragPercent: 14,
      dedupRatio: 1.0,
      readErrors: 0,
      writeErrors: 0,
      cksumErrors: 2,
      autotrim: false,
      scan: noScan(),
      vdevs: [
        {
          name: "mirror-0",
          type: "mirror",
          state: "DEGRADED",
          readErrors: 0,
          writeErrors: 0,
          cksumErrors: 2,
          children: [
            vdevDisk("ata-WDC_WD40EFRX-A"),
            vdevDisk("ata-WDC_WD40EFRX-B", "FAULTED"),
          ],
        },
      ],
    },
  ];
}

function mockArc(): ArcStats {
  const size = (10 + wave(30) * 6) * GiB;
  const hits = 184_000_000 + Math.floor(wave(3) * 50000);
  const misses = 6_200_000 + Math.floor(wave(7) * 8000);
  return {
    sizeBytes: size,
    targetBytes: 16 * GiB,
    maxBytes: 16 * GiB,
    hits,
    misses,
    hitRatio: (hits / (hits + misses)) * 100,
    mfuBytes: size * 0.62,
    mruBytes: size * 0.38,
    l2SizeBytes: 210 * GiB,
  };
}

// --------------------------------------------------------------------------
// Read API
// --------------------------------------------------------------------------
export async function getZfsOverview(): Promise<ZfsOverview> {
  await ensureSchedulesLoaded();
  startScheduler();
  if (USE_MOCK) {
    return {
      available: true,
      pools: mockPoolsRead(),
      datasets: mock.datasets,
      snapshots: [...mock.snapshots].sort((a, b) => b.creation - a.creation),
      arc: mockArc(),
      availableDevices: mock.devices,
      schedules: mock.schedules,
      isMock: true,
    };
  }

  if (!(await hasCommand("zpool"))) {
    return {
      available: false,
      pools: [],
      datasets: [],
      snapshots: [],
      arc: null,
      availableDevices: [],
      schedules: mock.schedules,
      isMock: false,
    };
  }

  const [pools, datasets, snapshots, arc, availableDevices] = await Promise.all([
    readPools(),
    readDatasets(),
    readSnapshots(),
    readArc(),
    getAvailableDevices(),
  ]);
  return {
    available: true,
    pools,
    datasets,
    snapshots,
    arc,
    availableDevices,
    schedules: mock.schedules,
    isMock: false,
  };
}

async function getAvailableDevices(): Promise<ZfsDevice[]> {
  // Disks with no partitions/filesystem and not already claimed by a pool.
  const { stdout, code } = await runArgs("lsblk", [
    "-J", "-b", "-o", "NAME,TYPE,SIZE,MODEL,FSTYPE,MOUNTPOINT",
  ]);
  if (code !== 0) return [];
  let parsed: { blockdevices: { name: string; type: string; size?: number; model?: string | null; fstype?: string | null; children?: unknown[] }[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const devices: ZfsDevice[] = [];
  for (const d of parsed.blockdevices ?? []) {
    if (d.type !== "disk") continue;
    if (d.children?.length || d.fstype) continue; // already in use
    devices.push({
      path: "/dev/" + d.name,
      name: d.name,
      sizeBytes: d.size ?? 0,
      model: (d.model ?? "Unknown").trim() || "Unknown",
      inUse: false,
    });
  }
  return devices;
}

async function readPools(): Promise<ZpoolInfo[]> {
  const { stdout, code } = await runArgs("zpool", [
    "list", "-Hp", "-o", "name,size,alloc,free,cap,frag,dedup,health,autotrim",
  ]);
  if (code !== 0) return [];
  const pools: ZpoolInfo[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [name, size, alloc, free, cap, frag, dedup, health, autotrim] = line.split("\t");
    const status = await readPoolStatus(name);
    pools.push({
      name,
      health: (health as ZpoolInfo["health"]) ?? "ONLINE",
      sizeBytes: Number(size) || 0,
      allocBytes: Number(alloc) || 0,
      freeBytes: Number(free) || 0,
      capacityPercent: Number(String(cap).replace("%", "")) || 0,
      fragPercent: Number(String(frag).replace("%", "")) || 0,
      dedupRatio: Number(String(dedup).replace("x", "")) || 1,
      autotrim: autotrim === "on",
      ...status,
    });
  }
  return pools;
}

async function readPoolStatus(
  name: string
): Promise<Pick<ZpoolInfo, "vdevs" | "scan" | "readErrors" | "writeErrors" | "cksumErrors">> {
  const empty = {
    vdevs: [] as Vdev[],
    scan: { state: "none", progressPercent: 0, repairedBytes: 0, errors: 0, speedBytesPerSec: 0, finishedAt: null } as ScanStatus,
    readErrors: 0,
    writeErrors: 0,
    cksumErrors: 0,
  };
  if (!NAME_RE.test(name)) return empty;
  const { stdout, code } = await runArgs("zpool", ["status", name]);
  if (code !== 0) return empty;

  const vdevs: Vdev[] = [];
  let current: Vdev | null = null;
  let scanState: ScanStatus["state"] = "none";
  let progress = 0;
  let rootErrors = { r: 0, w: 0, c: 0 };
  const lines = stdout.split("\n");
  let inConfig = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim().startsWith("scan:")) {
      if (/scrub in progress/.test(line)) scanState = "scrubbing";
      else if (/resilver in progress/.test(line)) scanState = "resilvering";
      else if (/scrub repaired/.test(line)) scanState = "finished";
    }
    const pm = line.match(/(\d+\.?\d*)%\s+done/);
    if (pm) progress = Number(pm[1]);
    if (/^\s*NAME\s+STATE\s+READ\s+WRITE\s+CKSUM/.test(line)) {
      inConfig = true;
      continue;
    }
    if (!inConfig) continue;
    if (!line.trim()) {
      inConfig = false;
      continue;
    }
    const m = line.match(/^(\s*)(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (!m) continue;
    const indent = m[1].length;
    const node = m[2];
    const state = m[3] as Vdev["state"];
    const r = Number(m[4]);
    const w = Number(m[5]);
    const c = Number(m[6]);
    if (node === name) {
      rootErrors = { r, w, c };
      continue;
    }
    const type: Vdev["type"] = /^mirror/.test(node)
      ? "mirror"
      : /^raidz3/.test(node)
        ? "raidz3"
        : /^raidz2/.test(node)
          ? "raidz2"
          : /^raidz/.test(node)
            ? "raidz1"
            : node === "logs"
              ? "log"
              : node === "cache"
                ? "cache"
                : node === "spares"
                  ? "spare"
                  : "disk";
    const vdev: Vdev = { name: node, type, state, readErrors: r, writeErrors: w, cksumErrors: c };
    if (indent <= 4 || type !== "disk") {
      vdev.children = [];
      vdevs.push(vdev);
      current = vdev;
    } else if (current) {
      current.children!.push(vdev);
    } else {
      vdevs.push(vdev);
    }
  }
  return {
    vdevs,
    scan: {
      state: scanState,
      progressPercent: progress,
      repairedBytes: 0,
      errors: 0,
      speedBytesPerSec: 0,
      finishedAt: scanState === "finished" ? Date.now() : null,
    },
    readErrors: rootErrors.r,
    writeErrors: rootErrors.w,
    cksumErrors: rootErrors.c,
  };
}

async function readDatasets(): Promise<ZfsDataset[]> {
  const props =
    "name,type,used,avail,refer,mountpoint,compression,compressratio,dedup,recordsize,quota,reservation,atime,readonly,encryption";
  const { stdout, code } = await runArgs("zfs", ["list", "-Hp", "-o", props]);
  if (code !== 0) return [];
  const snapCounts = await snapshotCounts();
  const out: ZfsDataset[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const c = line.split("\t");
    const name = c[0];
    out.push({
      name,
      type: c[1] === "volume" ? "volume" : "filesystem",
      usedBytes: Number(c[2]) || 0,
      availBytes: Number(c[3]) || 0,
      referBytes: Number(c[4]) || 0,
      mountpoint: c[5] ?? "-",
      compression: c[6] ?? "off",
      compressRatio: Number(String(c[7]).replace("x", "")) || 1,
      dedup: c[8] ?? "off",
      recordsize: c[9] ?? "-",
      quotaBytes: Number(c[10]) > 0 ? Number(c[10]) : null,
      reservationBytes: Number(c[11]) > 0 ? Number(c[11]) : null,
      atime: c[12] === "on",
      readonly: c[13] === "on",
      encrypted: (c[14] ?? "off") !== "off",
      snapshotCount: snapCounts[name] ?? 0,
    });
  }
  return out;
}

async function snapshotCounts(): Promise<Record<string, number>> {
  const { stdout, code } = await runArgs("zfs", ["list", "-t", "snapshot", "-Hp", "-o", "name"]);
  const counts: Record<string, number> = {};
  if (code !== 0) return counts;
  for (const line of stdout.split("\n").filter(Boolean)) {
    const ds = line.split("@")[0];
    counts[ds] = (counts[ds] ?? 0) + 1;
  }
  return counts;
}

async function readSnapshots(): Promise<ZfsSnapshot[]> {
  const { stdout, code } = await runArgs("zfs", ["list", "-t", "snapshot", "-Hp", "-o", "name,used,refer,creation"]);
  if (code !== 0) return [];
  const out: ZfsSnapshot[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [name, used, refer, creation] = line.split("\t");
    const [dataset, snap] = name.split("@");
    out.push({
      name,
      dataset,
      snap: snap ?? "",
      usedBytes: Number(used) || 0,
      referBytes: Number(refer) || 0,
      creation: (Number(creation) || 0) * 1000,
    });
  }
  return out.sort((a, b) => b.creation - a.creation);
}

async function readArc(): Promise<ArcStats | null> {
  try {
    const data = await readFile("/proc/spl/kstat/zfs/arcstats", "utf8");
    const map: Record<string, number> = {};
    for (const line of data.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 3) map[parts[0]] = Number(parts[2]);
    }
    const hits = map.hits ?? 0;
    const misses = map.misses ?? 0;
    return {
      sizeBytes: map.size ?? 0,
      targetBytes: map.c ?? 0,
      maxBytes: map.c_max ?? 0,
      hits,
      misses,
      hitRatio: hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0,
      mfuBytes: map.mfu_size ?? 0,
      mruBytes: map.mru_size ?? 0,
      l2SizeBytes: map.l2_size ?? null,
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Mutating actions
// --------------------------------------------------------------------------
export interface ZfsAction {
  kind: string;
  name?: string;
  target?: string;
  prop?: string;
  value?: string;
  recursive?: boolean;
  stop?: boolean;
  // pool create / device ops
  poolType?: string; // mirror | raidz1 | raidz2 | raidz3 | stripe
  vdevRole?: string; // log | cache | spare
  devices?: string[];
  oldDevice?: string;
  newDevice?: string;
  device?: string;
  // encryption
  passphrase?: string;
  // replication
  source?: string;
  remoteHost?: string;
  incremental?: string;
  // schedules
  id?: string;
  interval?: ScheduleInterval;
  keep?: number;
  enabled?: boolean;
}

const DEV_RE = /^\/dev\/[A-Za-z0-9._\-/]+$/;
// A pool member reference: /dev path, short kernel name (sdb), by-id path, or
// GUID. Must start alphanumeric so it can never be read as a CLI flag.
const MEMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-/]*$/;
const POOL_TYPES = new Set(["mirror", "raidz1", "raidz2", "raidz3", "stripe"]);
// Must start alphanumeric so a remote host can never be read by `ssh` as a flag.
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._@\-]*$/;

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

export async function runZfsAction(a: ZfsAction): Promise<{ ok: boolean; error?: string }> {
  const name = a.name ?? "";
  const isPoolName = NAME_RE.test(name);
  const isSnap = SNAP_RE.test(name);
  const isDsName = NAME_RE.test(name);

  // Schedules are an in-app construct executed by the ticker — same in both modes.
  if (a.kind.startsWith("schedule.")) return scheduleAction(a);

  // Mock: mutate in-memory model so the UI reflects changes.
  if (USE_MOCK) return mockAction(a);

  switch (a.kind) {
    case "pool.scrub":
      if (!isPoolName) return fail("invalid pool");
      return execArgs("zpool", ["scrub", ...(a.stop ? ["-s"] : []), name]);
    case "pool.trim":
      if (!isPoolName) return fail("invalid pool");
      return execArgs("zpool", ["trim", name]);
    case "pool.clear":
      if (!isPoolName) return fail("invalid pool");
      return execArgs("zpool", ["clear", name]);
    case "pool.export":
      if (!isPoolName) return fail("invalid pool");
      return execArgs("zpool", ["export", name]);
    case "dataset.create":
      if (!isDsName) return fail("invalid dataset name");
      return execArgs("zfs", ["create", name]);
    case "dataset.destroy":
      if (!isDsName) return fail("invalid dataset name");
      return execArgs("zfs", ["destroy", ...(a.recursive ? ["-r"] : []), name]);
    case "dataset.setprop":
      if (!isDsName || !a.prop || a.value === undefined) return fail("invalid args");
      if (!/^[a-z0-9:_.]+$/i.test(a.prop) || !/^[A-Za-z0-9:_.\-/]+$/.test(a.value))
        return fail("invalid property");
      return execArgs("zfs", ["set", `${a.prop}=${a.value}`, name]);
    case "snapshot.create": {
      const target = a.target ?? "";
      if (!isDsName || !/^[A-Za-z0-9][A-Za-z0-9_.:\-]*$/.test(target)) return fail("invalid args");
      return execArgs("zfs", ["snapshot", ...(a.recursive ? ["-r"] : []), `${name}@${target}`]);
    }
    case "snapshot.destroy":
      if (!isSnap) return fail("invalid snapshot");
      return execArgs("zfs", ["destroy", name]);
    case "snapshot.rollback":
      if (!isSnap) return fail("invalid snapshot");
      return execArgs("zfs", ["rollback", "-r", name]);
    case "snapshot.clone": {
      const target = a.target ?? "";
      if (!isSnap || !NAME_RE.test(target)) return fail("invalid args");
      return execArgs("zfs", ["clone", name, target]);
    }

    // ---- pool lifecycle ----
    case "pool.create": {
      const type = a.poolType ?? "stripe";
      const devs = a.devices ?? [];
      if (!isPoolName || !POOL_TYPES.has(type) || devs.length === 0) return fail("invalid args");
      if (!devs.every((d) => DEV_RE.test(d))) return fail("invalid device path");
      const vdevArgs = type === "stripe" ? devs : [type, ...devs];
      return execArgs("zpool", ["create", name, ...vdevArgs]);
    }
    case "pool.destroy":
      if (!isPoolName) return fail("invalid pool");
      return execArgs("zpool", ["destroy", name]);
    case "pool.addvdev": {
      const role = a.vdevRole ?? "";
      const devs = a.devices ?? [];
      if (!isPoolName || !["log", "cache", "spare"].includes(role) || devs.length === 0) return fail("invalid args");
      if (!devs.every((d) => DEV_RE.test(d))) return fail("invalid device path");
      return execArgs("zpool", ["add", name, role, ...devs]);
    }

    // ---- device ops ----
    case "device.replace":
      if (!isPoolName || !a.oldDevice || !a.newDevice) return fail("invalid args");
      if (!MEMBER_RE.test(a.oldDevice) || !DEV_RE.test(a.newDevice)) return fail("invalid device");
      return execArgs("zpool", ["replace", name, a.oldDevice, a.newDevice]);
    case "device.attach":
      if (!isPoolName || !a.oldDevice || !a.newDevice) return fail("invalid args");
      if (!MEMBER_RE.test(a.oldDevice) || !DEV_RE.test(a.newDevice)) return fail("invalid device");
      return execArgs("zpool", ["attach", name, a.oldDevice, a.newDevice]);
    case "device.detach":
      if (!isPoolName || !a.device || !MEMBER_RE.test(a.device)) return fail("invalid args");
      return execArgs("zpool", ["detach", name, a.device]);
    case "device.offline":
      if (!isPoolName || !a.device || !MEMBER_RE.test(a.device)) return fail("invalid args");
      return execArgs("zpool", ["offline", name, a.device]);
    case "device.online":
      if (!isPoolName || !a.device || !MEMBER_RE.test(a.device)) return fail("invalid args");
      return execArgs("zpool", ["online", name, a.device]);

    // ---- encryption ----
    case "dataset.loadkey":
      if (!isDsName) return fail("invalid dataset");
      // Pass the passphrase via stdin (never on the command line / through a shell).
      if (a.passphrase) return execArgs("zfs", ["load-key", name], { input: a.passphrase });
      return execArgs("zfs", ["load-key", name]);
    case "dataset.unloadkey":
      if (!isDsName) return fail("invalid dataset");
      return execArgs("zfs", ["unload-key", name]);

    // ---- replication (send/receive) ----
    case "replication.run": {
      const src = a.source ?? "";
      const dst = a.target ?? "";
      if (!SNAP_RE.test(src) || !NAME_RE.test(dst)) return fail("invalid args");
      const sendFlags = a.incremental && SNAP_RE.test(a.incremental) ? `-i ${a.incremental}` : "-R";
      const recv = a.remoteHost && HOST_RE.test(a.remoteHost)
        ? `ssh ${a.remoteHost} zfs receive -F ${dst}`
        : `zfs receive -F ${dst}`;
      return exec(`zfs send ${sendFlags} ${src} | ${recv}`);
    }

    // ---- schedules (managed in-app, executed by the ticker) ----
    case "schedule.create":
    case "schedule.delete":
    case "schedule.toggle":
    case "schedule.runNow":
      return scheduleAction(a);

    default:
      return fail("unknown action");
  }
}

async function scheduleAction(a: ZfsAction): Promise<{ ok: boolean; error?: string }> {
  await ensureSchedulesLoaded();
  switch (a.kind) {
    case "schedule.create": {
      if (!a.name || !NAME_RE.test(a.name) || !a.interval || !INTERVAL_MS[a.interval]) return fail("invalid args");
      const id = `sch-${Date.now()}`;
      mock.schedules = [
        ...mock.schedules,
        {
          id,
          dataset: a.name,
          interval: a.interval,
          keep: Math.max(1, Math.min(365, a.keep ?? 7)),
          recursive: !!a.recursive,
          enabled: true,
          lastRun: null,
          nextRun: Date.now() + INTERVAL_MS[a.interval],
        },
      ];
      await persistSchedules();
      return ok();
    }
    case "schedule.delete":
      mock.schedules = mock.schedules.filter((s) => s.id !== a.id);
      await persistSchedules();
      return ok();
    case "schedule.toggle": {
      const s = mock.schedules.find((x) => x.id === a.id);
      if (!s) return fail("not found");
      const enabled = a.enabled ?? !s.enabled;
      mock.schedules = mock.schedules.map((x) => (x.id === a.id ? { ...x, enabled } : x));
      await persistSchedules();
      return ok();
    }
    case "schedule.runNow": {
      const s = mock.schedules.find((x) => x.id === a.id);
      if (!s) return fail("not found");
      await runSchedule(s);
      const now = Date.now();
      mock.schedules = mock.schedules.map((x) =>
        x.id === a.id ? { ...x, lastRun: now, nextRun: now + INTERVAL_MS[x.interval] } : x
      );
      await persistSchedules();
      return ok();
    }
    default:
      return fail("unknown action");
  }
}

// Shell path — used ONLY for the replication pipeline (zfs send | … receive),
// whose every interpolated part is strictly regex-validated above.
async function exec(cmd: string): Promise<{ ok: boolean; error?: string }> {
  const { code, stderr } = await run(cmd, { timeoutMs: 30000 });
  return code === 0 ? ok() : fail(stderr.trim() || "command failed — needs root/sudoers");
}

// No-shell path — the default for every privileged ZFS action. `file`/`args`
// reach the kernel verbatim, so user-supplied names/devices cannot be reparsed
// as shell syntax. `input`, when set, is fed to the child's stdin.
async function execArgs(
  file: string,
  args: string[],
  opts: { input?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  const { code, stderr } = await runArgs(file, args, { timeoutMs: 30000, input: opts.input });
  return code === 0 ? ok() : fail(stderr.trim() || "command failed — needs root/sudoers");
}

function mockAction(a: ZfsAction): { ok: boolean; error?: string } {
  const name = a.name ?? "";
  switch (a.kind) {
    case "pool.scrub":
      if (a.stop) mock.scrub[name] = undefined;
      else mock.scrub[name] = { startedAt: Date.now(), resilver: false };
      return ok();
    case "pool.trim":
    case "pool.clear":
    case "pool.export":
      return ok();
    case "dataset.create": {
      if (mock.datasets.some((d) => d.name === name)) return fail("dataset exists");
      mock.datasets.push({
        name,
        type: "filesystem",
        usedBytes: 192 * 1024,
        availBytes: 9.2 * TiB,
        referBytes: 192 * 1024,
        mountpoint: "/" + name,
        compression: "lz4",
        compressRatio: 1,
        dedup: "off",
        recordsize: "128K",
        quotaBytes: null,
        reservationBytes: null,
        atime: false,
        readonly: false,
        encrypted: false,
        snapshotCount: 0,
      });
      return ok();
    }
    case "dataset.destroy":
      mock.datasets = mock.datasets.filter((d) =>
        a.recursive ? d.name !== name && !d.name.startsWith(name + "/") : d.name !== name
      );
      mock.snapshots = mock.snapshots.filter((s) => s.dataset !== name);
      return ok();
    case "dataset.setprop": {
      const d = mock.datasets.find((x) => x.name === name);
      if (!d || !a.prop) return fail("not found");
      const v = a.value ?? "";
      if (a.prop === "compression") d.compression = v;
      else if (a.prop === "dedup") d.dedup = v;
      else if (a.prop === "atime") d.atime = v === "on";
      else if (a.prop === "readonly") d.readonly = v === "on";
      else if (a.prop === "recordsize") d.recordsize = v;
      else if (a.prop === "quota") d.quotaBytes = v === "none" ? null : parseSize(v);
      return ok();
    }
    case "snapshot.create": {
      const snapName = `${name}@${a.target}`;
      if (mock.snapshots.some((s) => s.name === snapName)) return fail("snapshot exists");
      const ds = mock.datasets.find((d) => d.name === name);
      mock.snapshots.unshift({
        name: snapName,
        dataset: name,
        snap: a.target ?? "snap",
        usedBytes: 0,
        referBytes: ds?.referBytes ?? 0,
        creation: Date.now(),
      });
      if (ds) ds.snapshotCount += 1;
      return ok();
    }
    case "snapshot.destroy": {
      const snap = mock.snapshots.find((s) => s.name === name);
      mock.snapshots = mock.snapshots.filter((s) => s.name !== name);
      if (snap) {
        const ds = mock.datasets.find((d) => d.name === snap.dataset);
        if (ds && ds.snapshotCount > 0) ds.snapshotCount -= 1;
      }
      return ok();
    }
    case "snapshot.rollback":
      return ok();
    case "snapshot.clone": {
      const target = a.target ?? "";
      if (mock.datasets.some((d) => d.name === target)) return fail("target exists");
      const src = mock.snapshots.find((s) => s.name === name);
      mock.datasets.push({
        name: target,
        type: "filesystem",
        usedBytes: 0,
        availBytes: 9.2 * TiB,
        referBytes: src?.referBytes ?? 0,
        mountpoint: "/" + target,
        compression: "lz4",
        compressRatio: 1,
        dedup: "off",
        recordsize: "128K",
        quotaBytes: null,
        reservationBytes: null,
        atime: false,
        readonly: false,
        encrypted: false,
        snapshotCount: 0,
      });
      return ok();
    }

    case "pool.create": {
      const devs = a.devices ?? [];
      const ptype = a.poolType ?? "stripe";
      const vtype: VdevType = ptype === "stripe" ? "disk" : (ptype as VdevType);
      if (mock.pools.some((p) => p.name === name)) return fail("pool exists");
      if (!devs.length) return fail("no devices");
      const used = mock.devices.filter((d) => devs.includes(d.path));
      const totalRaw = used.reduce((s, d) => s + d.sizeBytes, 0);
      // usable capacity estimate by redundancy level
      const usable =
        ptype === "mirror"
          ? Math.min(...used.map((d) => d.sizeBytes))
          : ptype === "raidz1"
            ? totalRaw * (1 - 1 / devs.length)
            : ptype === "raidz2"
              ? totalRaw * (1 - 2 / devs.length)
              : ptype === "raidz3"
                ? totalRaw * (1 - 3 / devs.length)
                : totalRaw;
      mock.pools.push({
        name,
        health: "ONLINE",
        sizeBytes: usable,
        allocBytes: 0,
        freeBytes: usable,
        capacityPercent: 0,
        fragPercent: 0,
        dedupRatio: 1,
        readErrors: 0,
        writeErrors: 0,
        cksumErrors: 0,
        autotrim: false,
        scan: noScan(),
        vdevs: [
          {
            name: `${vtype}-0`,
            type: vtype,
            state: "ONLINE",
            readErrors: 0,
            writeErrors: 0,
            cksumErrors: 0,
            children: used.map((d) => vdevDisk(d.name)),
          },
        ],
      });
      // a root dataset accompanies a new pool
      mock.datasets.push({
        name,
        type: "filesystem",
        usedBytes: 192 * 1024,
        availBytes: usable,
        referBytes: 192 * 1024,
        mountpoint: "/" + name,
        compression: "lz4",
        compressRatio: 1,
        dedup: "off",
        recordsize: "128K",
        quotaBytes: null,
        reservationBytes: null,
        atime: false,
        readonly: false,
        encrypted: false,
        snapshotCount: 0,
      });
      mock.devices = mock.devices.filter((d) => !devs.includes(d.path));
      return ok();
    }
    case "pool.destroy":
      mock.pools = mock.pools.filter((p) => p.name !== name);
      mock.datasets = mock.datasets.filter((d) => d.name !== name && !d.name.startsWith(name + "/"));
      mock.snapshots = mock.snapshots.filter((s) => !s.dataset.startsWith(name));
      return ok();
    case "pool.addvdev": {
      const pool = mock.pools.find((p) => p.name === name);
      const role = (a.vdevRole ?? "cache") as VdevType;
      const devs = a.devices ?? [];
      if (!pool) return fail("pool not found");
      const used = mock.devices.filter((d) => devs.includes(d.path));
      pool.vdevs.push({
        name: role === "log" ? "logs" : role === "cache" ? "cache" : "spares",
        type: role,
        state: "ONLINE",
        readErrors: 0,
        writeErrors: 0,
        cksumErrors: 0,
        children: used.map((d) => vdevDisk(d.name)),
      });
      mock.devices = mock.devices.filter((d) => !devs.includes(d.path));
      return ok();
    }

    case "device.replace": {
      const pool = mock.pools.find((p) => p.name === name);
      if (!pool) return fail("pool not found");
      const newDev = mock.devices.find((d) => d.path === a.newDevice);
      let replaced = false;
      const fix = (v: Vdev) => {
        if (v.children) v.children = v.children.map(fix);
        if (v.type === "disk" && (v.name === a.oldDevice || v.state !== "ONLINE") && !replaced) {
          replaced = true;
          return vdevDisk(newDev?.name ?? a.newDevice ?? v.name);
        }
        return v;
      };
      pool.vdevs = pool.vdevs.map(fix);
      // restore health
      pool.vdevs.forEach((v) => {
        v.state = "ONLINE";
        v.cksumErrors = 0;
        v.children?.forEach((c) => (c.state = "ONLINE"));
      });
      pool.health = "ONLINE";
      pool.cksumErrors = 0;
      if (a.newDevice) mock.devices = mock.devices.filter((d) => d.path !== a.newDevice);
      return ok();
    }
    case "device.attach": {
      const pool = mock.pools.find((p) => p.name === name);
      const newDev = mock.devices.find((d) => d.path === a.newDevice);
      if (!pool || !newDev) return fail("invalid args");
      const grp = pool.vdevs.find((v) => v.children?.some((c) => c.name === a.oldDevice));
      if (grp) {
        if (grp.type === "disk") grp.type = "mirror";
        grp.children!.push(vdevDisk(newDev.name));
      }
      mock.devices = mock.devices.filter((d) => d.path !== a.newDevice);
      return ok();
    }
    case "device.detach":
    case "device.offline":
    case "device.online": {
      const pool = mock.pools.find((p) => p.name === name);
      if (!pool) return fail("pool not found");
      if (a.kind === "device.detach") {
        pool.vdevs.forEach((v) => {
          if (v.children) v.children = v.children.filter((c) => c.name !== a.device);
        });
      }
      return ok();
    }

    case "dataset.loadkey": {
      const d = mock.datasets.find((x) => x.name === name);
      if (d) d.encrypted = true;
      return ok();
    }
    case "dataset.unloadkey":
      return ok();

    case "replication.run": {
      const dst = a.target ?? "";
      if (mock.datasets.some((d) => d.name === dst)) return ok(); // already exists, incremental
      const src = mock.snapshots.find((s) => s.name === a.source);
      mock.datasets.push({
        name: dst,
        type: "filesystem",
        usedBytes: src?.referBytes ?? 0,
        availBytes: 9.2 * TiB,
        referBytes: src?.referBytes ?? 0,
        mountpoint: "/" + dst,
        compression: "lz4",
        compressRatio: 1.3,
        dedup: "off",
        recordsize: "128K",
        quotaBytes: null,
        reservationBytes: null,
        atime: false,
        readonly: true,
        encrypted: false,
        snapshotCount: 1,
      });
      return ok();
    }

    default:
      return fail("unknown action");
  }
}

function parseSize(text: string): number {
  const m = text.trim().match(/([\d.]+)\s*([KMGTP]?)/i);
  if (!m) return 0;
  const f: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 };
  return Math.floor(Number(m[1]) * (f[m[2].toUpperCase()] ?? 1));
}
