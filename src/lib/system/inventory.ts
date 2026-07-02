import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DiskFault,
  DiskHistoryEntry,
  DiskHistoryOverview,
  DiskInfo,
  DiskInventoryItem,
  DiskInventoryOverview,
  DiskLocation,
  DiskZfsRef,
  Vdev,
  ZpoolInfo,
} from "@/lib/types";
import { USE_MOCK } from "./exec";
import { getDisks } from "./storage";
import { getZfsOverview } from "./zfs";

const STATE_DIR = path.dirname(process.env.NIMBO_AUTH_FILE ?? "/etc/nimbo/users.json");
const INVENTORY_FILE = process.env.NIMBO_INVENTORY_FILE ?? path.join(STATE_DIR, "disk-inventory.json");
const SNAPSHOT_FILE = process.env.NIMBO_DISK_SNAPSHOT_FILE ?? path.join(STATE_DIR, "disk-snapshot.json");
const HISTORY_FILE = process.env.NIMBO_DISK_HISTORY_FILE ?? path.join(STATE_DIR, "disk-history.jsonl");
const MAX_HISTORY = 500;

// ==========================================================================
// L1 — location metadata (user-assigned, keyed by stableId)
// ==========================================================================
type LocationMap = Record<string, DiskLocation>;
let locCache: LocationMap | null = null;

function mockLocations(): LocationMap {
  return {
    "wwn:0x50014ee2b0d60001": { label: "Bay 1", bay: "1", note: "tank raidz2" },
    "wwn:0x50014ee2b0d60002": { label: "Bay 2", bay: "2", note: "tank raidz2" },
    "wwn:0x50014ee2b0d40b0b": { label: "Bay 5", bay: "5", note: "backup mirror — 교체 필요" },
  };
}

async function loadLocations(): Promise<LocationMap> {
  if (locCache) return locCache;
  if (USE_MOCK) return (locCache = mockLocations());
  try {
    locCache = JSON.parse(await readFile(INVENTORY_FILE, "utf8")) as LocationMap;
  } catch {
    locCache = {};
  }
  return locCache;
}

async function saveLocations(map: LocationMap): Promise<void> {
  locCache = map;
  if (USE_MOCK) return;
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(INVENTORY_FILE, JSON.stringify(map, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

export async function setDiskLocation(stableId: string, loc: Partial<DiskLocation>): Promise<{ ok: boolean; error?: string }> {
  if (!stableId) return { ok: false, error: "stableId가 필요합니다" };
  const map: LocationMap = { ...(await loadLocations()) };
  const cur = map[stableId] ?? { label: "", bay: "", note: "" };
  const next: DiskLocation = {
    label: (loc.label ?? cur.label).slice(0, 60),
    bay: (loc.bay ?? cur.bay).slice(0, 20),
    note: (loc.note ?? cur.note).slice(0, 200),
  };
  if (!next.label && !next.bay && !next.note) delete map[stableId];
  else map[stableId] = next;
  await saveLocations(map);
  return { ok: true };
}

/** Snapshot of the user-assigned location metadata (for export/backup). */
export async function getDiskLocations(): Promise<LocationMap> {
  return { ...(await loadLocations()) };
}

/**
 * Import location metadata (label/bay/note, keyed by stableId) from a prior
 * export. Accepts either a bare LocationMap or a full export object with a
 * `locations` field. `merge` keeps existing entries; `replace` starts fresh.
 * Only the editable location fields are applied — identity/health/ZFS is always
 * live-detected, never imported.
 */
export async function importDiskLocations(
  input: unknown,
  mode: "merge" | "replace" = "merge",
): Promise<{ ok: boolean; applied: number; skipped: number; error?: string }> {
  const raw =
    input && typeof input === "object" && "locations" in (input as Record<string, unknown>)
      ? (input as { locations: unknown }).locations
      : input;
  if (!raw || typeof raw !== "object") return { ok: false, applied: 0, skipped: 0, error: "잘못된 형식입니다 (JSON 객체가 아닙니다)" };

  const clean: LocationMap = {};
  let skipped = 0;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || typeof v !== "object" || v === null) {
      skipped++;
      continue;
    }
    const o = v as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.slice(0, 60) : "";
    const bay = typeof o.bay === "string" ? o.bay.slice(0, 20) : "";
    const note = typeof o.note === "string" ? o.note.slice(0, 200) : "";
    if (!label && !bay && !note) {
      skipped++;
      continue;
    }
    clean[id] = { label, bay, note };
  }

  const applied = Object.keys(clean).length;
  if (!applied) return { ok: false, applied: 0, skipped, error: "가져올 위치 정보가 없습니다" };

  const base = mode === "replace" ? {} : { ...(await loadLocations()) };
  await saveLocations({ ...base, ...clean });
  return { ok: true, applied, skipped };
}

// ==========================================================================
// physical disk <-> ZFS vdev member join
// ==========================================================================
interface ZfsMember {
  pool: string;
  vdev: string;
  member: string;
  role: Vdev["type"];
  state: Vdev["state"];
  readErrors: number;
  writeErrors: number;
  cksumErrors: number;
}

function collectZfsMembers(pools: ZpoolInfo[]): ZfsMember[] {
  const out: ZfsMember[] = [];
  const leaf = (v: Vdev, pool: string, vdev: string, role: Vdev["type"]) => {
    if (v.children?.length) {
      for (const c of v.children) leaf(c, pool, v.name, v.type);
      return;
    }
    out.push({
      pool,
      vdev,
      member: v.name,
      role,
      state: v.state,
      readErrors: v.readErrors,
      writeErrors: v.writeErrors,
      cksumErrors: v.cksumErrors,
    });
  };
  for (const pool of pools) {
    for (const v of pool.vdevs) {
      if (v.children?.length) for (const c of v.children) leaf(c, pool.name, v.name, v.type);
      else leaf(v, pool.name, pool.name, "disk");
    }
  }
  return out;
}

function matchMember(disk: DiskInfo, members: ZfsMember[]): ZfsMember | null {
  const byIdBase = disk.byId?.split("/").pop();
  const devBase = disk.device.split("/").pop();
  const wwnHex = disk.wwn?.replace(/^0x/i, "").toLowerCase();
  for (const m of members) {
    const mem = m.member;
    const memBase = mem.split("/").pop() ?? mem;
    if (byIdBase && memBase === byIdBase) return m;
    if (disk.serial && mem.includes(disk.serial)) return m;
    if (devBase && (mem === devBase || memBase === devBase)) return m;
    if (wwnHex && mem.toLowerCase().includes(wwnHex)) return m;
  }
  return null;
}

const RANK: Record<DiskFault, number> = { ok: 0, warning: 1, critical: 2 };

function computeFault(disk: DiskInfo, zfs: DiskZfsRef | null): { fault: DiskFault; reasons: string[] } {
  const reasons: string[] = [];
  let fault: DiskFault = "ok";
  const bump = (f: DiskFault) => { if (RANK[f] > RANK[fault]) fault = f; };

  if (disk.smartStatus === "failed") { bump("critical"); reasons.push("SMART 실패"); }
  else if (disk.smartStatus === "warning") { bump("warning"); reasons.push("SMART 경고"); }
  if ((disk.reallocatedSectors ?? 0) > 0) { bump("warning"); reasons.push(`재할당 섹터 ${disk.reallocatedSectors}개`); }
  if ((disk.pendingSectors ?? 0) > 0) { bump("warning"); reasons.push(`대기 섹터 ${disk.pendingSectors}개`); }
  if (disk.temperatureC != null && disk.temperatureC >= 55) { bump("warning"); reasons.push(`고온 ${disk.temperatureC}°C`); }

  if (zfs) {
    if (["FAULTED", "UNAVAIL", "REMOVED"].includes(zfs.state)) { bump("critical"); reasons.push(`ZFS ${zfs.state}`); }
    else if (["DEGRADED", "OFFLINE"].includes(zfs.state)) { bump("warning"); reasons.push(`ZFS ${zfs.state}`); }
    const errs = zfs.readErrors + zfs.writeErrors + zfs.cksumErrors;
    if (errs > 0) { bump("warning"); reasons.push(`ZFS 에러 ${errs}건`); }
  }
  return { fault, reasons };
}

export async function getInventory(): Promise<DiskInventoryOverview> {
  const [disks, zfs, locations] = await Promise.all([
    getDisks(),
    getZfsOverview().catch(() => null),
    loadLocations(),
  ]);
  const members = zfs ? collectZfsMembers(zfs.pools) : [];
  const items: DiskInventoryItem[] = disks.map((disk) => {
    const m = matchMember(disk, members);
    const zref: DiskZfsRef | null = m
      ? {
          pool: m.pool, vdev: m.vdev, member: m.member, role: m.role, state: m.state,
          readErrors: m.readErrors, writeErrors: m.writeErrors, cksumErrors: m.cksumErrors,
        }
      : null;
    const { fault, reasons } = computeFault(disk, zref);
    return { disk, zfs: zref, location: locations[disk.stableId] ?? null, fault, faultReasons: reasons };
  });

  // L2: record any boot-to-boot / poll-to-poll changes (fire-and-forget).
  void recordInventorySnapshot(items);

  return { disks: items, isMock: USE_MOCK };
}

// ==========================================================================
// L2 — boot-to-boot change history
// ==========================================================================
interface SnapEntry {
  stableId: string;
  model: string;
  device: string;
  byPath: string | null;
  smart: string;
  zfsState: string | null;
}

let bootIdCache: string | null = null;
async function getBootId(): Promise<string> {
  if (bootIdCache) return bootIdCache;
  try {
    bootIdCache = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  } catch {
    bootIdCache = "unknown";
  }
  return bootIdCache;
}

async function readSnapshot(): Promise<Record<string, SnapEntry>> {
  try {
    return JSON.parse(await readFile(SNAPSHOT_FILE, "utf8")) as Record<string, SnapEntry>;
  } catch {
    return {};
  }
}

async function recordInventorySnapshot(items: DiskInventoryItem[]): Promise<void> {
  if (USE_MOCK) return;
  try {
    const prev = await readSnapshot();
    const isFirst = Object.keys(prev).length === 0;
    const cur: Record<string, SnapEntry> = {};
    const bootId = await getBootId();
    const now = Date.now();
    let ctr = 0;
    const changes: DiskHistoryEntry[] = [];
    const mk = (kind: DiskHistoryEntry["kind"], stableId: string, model: string, detail: string): DiskHistoryEntry =>
      ({ id: `dh-${now}-${ctr++}`, ts: now, bootId, kind, stableId, model, detail });

    for (const it of items) {
      const d = it.disk;
      const e: SnapEntry = {
        stableId: d.stableId, model: d.model, device: d.device,
        byPath: d.byPath, smart: d.smartStatus, zfsState: it.zfs?.state ?? null,
      };
      cur[d.stableId] = e;
      if (isFirst) continue; // seed only, don't log every existing disk as "added"
      const p = prev[d.stableId];
      if (!p) { changes.push(mk("added", d.stableId, d.model, `추가됨 (${d.device})`)); continue; }
      if (p.device !== e.device || p.byPath !== e.byPath)
        changes.push(mk("moved", d.stableId, d.model, `위치 이동 ${p.device} → ${e.device}`));
      if (p.smart !== e.smart) changes.push(mk("smart", d.stableId, d.model, `SMART ${p.smart} → ${e.smart}`));
      if ((p.zfsState ?? "") !== (e.zfsState ?? ""))
        changes.push(mk("zfs", d.stableId, d.model, `ZFS ${p.zfsState ?? "-"} → ${e.zfsState ?? "-"}`));
    }
    if (!isFirst) {
      for (const sid of Object.keys(prev)) {
        if (!cur[sid]) changes.push(mk("removed", sid, prev[sid].model, `제거됨 (${prev[sid].device})`));
      }
    }

    await mkdir(STATE_DIR, { recursive: true });
    if (changes.length) await appendFile(HISTORY_FILE, changes.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
    if (isFirst || changes.length) await writeFile(SNAPSHOT_FILE, JSON.stringify(cur, null, 2), "utf8");
  } catch {
    // best-effort — history is non-critical
  }
}

function mockHistory(): DiskHistoryEntry[] {
  const now = Date.now();
  const H = 3600_000;
  return [
    { id: "dh-1", ts: now - 2 * 60_000, bootId: "boot-b", kind: "zfs", stableId: "wwn:0x50014ee2b0d40b0b", model: "WDC WD40EFRX-68N32N0", detail: "ZFS ONLINE → FAULTED" },
    { id: "dh-2", ts: now - 3 * 60_000, bootId: "boot-b", kind: "smart", stableId: "wwn:0x50014ee2b0d40b0b", model: "WDC WD40EFRX-68N32N0", detail: "SMART passed → failed" },
    { id: "dh-3", ts: now - 26 * H, bootId: "boot-a", kind: "moved", stableId: "wwn:0x50014ee2b0d60002", model: "WDC WD60EFRX-68L0BN1", detail: "위치 이동 /dev/sdc → /dev/sdb" },
    { id: "dh-4", ts: now - 27 * H, bootId: "boot-a", kind: "added", stableId: "wwn:eui.0025385991b0aa11", model: "Samsung SSD 980 250GB", detail: "추가됨 (/dev/nvme0n1)" },
  ];
}

export async function getDiskHistory(): Promise<DiskHistoryOverview> {
  if (USE_MOCK) return { entries: mockHistory(), isMock: true };
  try {
    const raw = await readFile(HISTORY_FILE, "utf8");
    const entries = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as DiskHistoryEntry; } catch { return null; } })
      .filter((e): e is DiskHistoryEntry => e !== null)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_HISTORY);
    return { entries, isMock: false };
  } catch {
    return { entries: [], isMock: false };
  }
}

export async function clearDiskHistory(): Promise<{ ok: boolean; error?: string }> {
  if (!USE_MOCK) {
    try {
      await mkdir(STATE_DIR, { recursive: true });
      await writeFile(HISTORY_FILE, "", "utf8");
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: true };
}
