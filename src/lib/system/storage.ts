import type { DiskInfo, DiskTransport, PartitionInfo } from "@/lib/types";
import { runArgs, USE_MOCK } from "./exec";
import { mockDisks } from "./mock";

interface LsblkNode {
  name: string;
  type: string;
  size?: number;
  model?: string | null;
  serial?: string | null;
  wwn?: string | null;
  rev?: string | null;
  hctl?: string | null;
  rota?: boolean;
  tran?: string | null;
  mountpoint?: string | null;
  fstype?: string | null;
  fsavail?: number | null;
  fsused?: number | null;
  fssize?: number | null;
  children?: LsblkNode[];
}

// lsblk -J -b returns SIZE as a JSON number but FSSIZE/FSUSED/FSAVAIL as
// quoted strings on some util-linux versions (e.g. RHEL 9). Coerce everything
// to a real number so downstream arithmetic and Number.isFinite() guards work.
function numOr(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function classify(node: LsblkNode): DiskInfo["type"] {
  if (node.tran === "nvme" || node.name.startsWith("nvme")) return "nvme";
  if (node.rota === false) return "ssd";
  if (node.rota === true) return "hdd";
  return "unknown";
}

// Keep the raw bus type (sata/sas/usb/nvme/iscsi/virtio) — lsblk already fetches
// it as TRAN; the old classify() collapsed it to hdd/ssd/nvme and threw it away.
function transportOf(node: LsblkNode): DiskTransport {
  const t = (node.tran ?? "").toLowerCase();
  if (t === "sata" || t === "ata") return "sata";
  if (t === "sas") return "sas";
  if (t === "usb") return "usb";
  if (t === "iscsi") return "iscsi";
  if (t === "virtio") return "virtio";
  if (t === "nvme" || node.name.startsWith("nvme")) return "nvme";
  return "unknown";
}

// Reduce any partition/device name to its whole-disk kernel name.
//   sdc1 -> sdc,  nvme0n1p1 -> nvme0n1,  nvme0n1 -> nvme0n1,  mmcblk0p1 -> mmcblk0
function kernelDiskOf(dev: string): string {
  const base = dev.split("/").pop() ?? dev;
  if (/^(nvme\d+n\d+|mmcblk\d+|loop\d+)/.test(base)) return base.replace(/p\d+$/, "");
  return base.replace(/\d+$/, "");
}

// Map each kernel disk (/dev/sdX) to the ZFS pool that owns it. `zpool list -PH`
// prints each pool's leaf devices as full by-id paths (-P); we resolve those
// back to kernel disks via the /dev/disk/by-id symlinks. Empty when ZFS isn't
// installed or no pool exists, so non-ZFS hosts get no membership at all.
async function getZfsDiskPools(): Promise<Map<string, string>> {
  const diskPool = new Map<string, string>();
  const list = await runArgs("zpool", ["list", "-v", "-PH"]);
  if (list.code !== 0 || !list.stdout.trim()) return diskPool;

  // by-id link basename (incl. -partN) -> whole-disk kernel name.
  const byId = new Map<string, string>();
  const ls = await runArgs("ls", ["-l", "/dev/disk/by-id"]);
  if (ls.code === 0) {
    for (const line of ls.stdout.split("\n")) {
      const m = line.match(/(\S+)\s+->\s+\.\.\/\.\.\/(\S+)$/);
      if (!m) continue;
      const name = m[1].split("/").pop() ?? m[1];
      byId.set(name, kernelDiskOf(m[2]));
    }
  }

  let pool = "";
  for (const raw of list.stdout.split("\n")) {
    if (!raw.trim()) continue;
    const fields = raw.split("\t");
    const name = (fields.find((f) => f.trim() !== "") ?? "").trim();
    if (!name) continue;
    const indented = /^\s/.test(raw) || fields[0] === ""; // nested vdev/leaf row
    if (!indented) { pool = name; continue; } // un-indented = pool row
    if (!name.startsWith("/dev/")) continue; // vdev group (mirror-0, raidz…)
    const base = name.split("/").pop() ?? name;
    const disk = name.startsWith("/dev/disk/by-")
      ? byId.get(base) ?? byId.get(base.replace(/-part\d+$/, ""))
      : kernelDiskOf(base); // raw /dev/sdX1 leaf
    if (disk && pool) diskPool.set("/dev/" + disk, pool);
  }
  return diskPool;
}

function toPartitions(node: LsblkNode): PartitionInfo[] {
  const parts: PartitionInfo[] = [];
  const walk = (n: LsblkNode) => {
    if (n.type === "part" || n.type === "lvm" || n.type === "crypt") {
      const total = numOr(n.fssize, numOr(n.size, 0));
      const used = numOr(n.fsused, 0);
      const avail = numOr(n.fsavail, Math.max(0, total - used));
      parts.push({
        device: "/dev/" + n.name,
        mountpoint: n.mountpoint ?? null,
        filesystem: n.fstype ?? "—",
        totalBytes: total,
        usedBytes: used,
        availBytes: avail,
        usePercent: total > 0 ? Math.round((used / total) * 100) : 0,
      });
    }
    n.children?.forEach(walk);
  };
  node.children?.forEach(walk);
  return parts;
}

// --------------------------------------------------------------------------
// /dev/disk/by-id and /dev/disk/by-path symlink resolution (kernel name -> links).
// These give a stable identity + a physical slot hint that lsblk alone omits.
// --------------------------------------------------------------------------
interface DiskLinks {
  byId: string | null;
  byPath: string | null;
}

function preferById(current: string | null, candidate: string): string {
  const name = (p: string) => p.split("/").pop() ?? "";
  if (!current) return candidate;
  // Prefer human-readable ata-/nvme-/scsi-/usb- over bare wwn-.
  if (/^wwn-/.test(name(current)) && !/^wwn-/.test(name(candidate))) return candidate;
  return current;
}

async function resolveDiskLinks(): Promise<Map<string, DiskLinks>> {
  const map = new Map<string, DiskLinks>();
  const { stdout, code } = await runArgs("ls", ["-l", "/dev/disk/by-id", "/dev/disk/by-path"]);
  if (code !== 0 || !stdout) return map;
  let section: "id" | "path" | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("/dev/disk/by-id")) { section = "id"; continue; }
    if (line.startsWith("/dev/disk/by-path")) { section = "path"; continue; }
    const m = line.match(/(\S+)\s+->\s+\.\.\/\.\.\/(\S+)$/);
    if (!m || !section) continue;
    const linkName = m[1].split("/").pop() ?? m[1];
    const target = m[2]; // kernel device name
    if (/-part\d+$/.test(linkName)) continue; // skip partition links
    const entry = map.get(target) ?? { byId: null, byPath: null };
    if (section === "id") entry.byId = preferById(entry.byId, "/dev/disk/by-id/" + linkName);
    else if (!entry.byPath) entry.byPath = "/dev/disk/by-path/" + linkName;
    map.set(target, entry);
  }
  return map;
}

// --------------------------------------------------------------------------
// SMART detail via `smartctl -j -a` (JSON), with a text fallback for old
// smartmontools. `-n standby` avoids spinning up a sleeping HDD just to poll it.
// --------------------------------------------------------------------------
interface SmartDetail {
  status: DiskInfo["smartStatus"];
  tempC: number | null;
  firmware: string | null;
  rotationRpm: number | null;
  serial: string | null;
  powerOnHours: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
}

const EMPTY_SMART: SmartDetail = {
  status: "unknown", tempC: null, firmware: null, rotationRpm: null,
  serial: null, powerOnHours: null, reallocatedSectors: null, pendingSectors: null,
};

function clampTemp(t: unknown): number | null {
  return typeof t === "number" && t > 0 && t < 120 ? t : null;
}

// Minimal shape of the fields we read from `smartctl --json` (ATA + NVMe).
interface SmartJson {
  smart_status?: { passed?: boolean };
  temperature?: { current?: number };
  firmware_version?: string;
  rotation_rate?: number;
  serial_number?: string;
  power_on_time?: { hours?: number };
  ata_smart_attributes?: { table?: Array<{ id?: number; raw?: { value?: number } }> };
  nvme_smart_health_information_log?: { temperature?: number; power_on_hours?: number };
}

async function smartDetail(device: string): Promise<SmartDetail> {
  const json = await runArgs("smartctl", ["-j", "-a", "-n", "standby", device], { timeoutMs: 12000 });
  if (json.stdout && json.stdout.trim().startsWith("{")) {
    try {
      const j = JSON.parse(json.stdout) as SmartJson;
      const passed = j.smart_status?.passed;
      let status: DiskInfo["smartStatus"] = passed === true ? "passed" : passed === false ? "failed" : "unknown";

      let reallocated: number | null = null;
      let pending: number | null = null;
      const attrs = j.ata_smart_attributes?.table;
      if (Array.isArray(attrs)) {
        for (const a of attrs) {
          if (a.id === 5) reallocated = a.raw?.value ?? null;
          if (a.id === 197) pending = a.raw?.value ?? null;
        }
      }
      if (status === "passed" && ((reallocated ?? 0) > 0 || (pending ?? 0) > 0)) status = "warning";

      const tempC = clampTemp(j.temperature?.current ?? j.nvme_smart_health_information_log?.temperature);
      return {
        status,
        tempC,
        firmware: j.firmware_version ?? null,
        rotationRpm: typeof j.rotation_rate === "number" ? j.rotation_rate : null,
        serial: j.serial_number ?? null,
        powerOnHours:
          typeof j.power_on_time?.hours === "number"
            ? j.power_on_time.hours
            : typeof j.nvme_smart_health_information_log?.power_on_hours === "number"
              ? j.nvme_smart_health_information_log.power_on_hours
              : null,
        reallocatedSectors: reallocated,
        pendingSectors: pending,
      };
    } catch {
      // fall through to text parse
    }
  }

  // Fallback: text parse (legacy smartmontools / no JSON support).
  const { stdout, code } = await runArgs("smartctl", ["-H", "-A", device], { timeoutMs: 12000 });
  if (code !== 0 || !stdout) return EMPTY_SMART;
  const healthy =
    /SMART overall-health self-assessment test result:\s+PASSED/i.test(stdout) ||
    /SMART Health Status:\s+OK/i.test(stdout);
  const failed =
    /self-assessment test result:\s+FAILED/i.test(stdout) ||
    /SMART Health Status:\s+(FAILED|FAIL)/i.test(stdout) ||
    /\bFAILING_NOW\b/i.test(stdout);
  const tempMatch =
    stdout.match(/Temperature.*?(\d{1,3})\s*(?:Celsius|\(|$)/i) ||
    stdout.match(/Temperature_Celsius.*?(\d{1,3})\s*$/im);
  return {
    ...EMPTY_SMART,
    status: failed ? "failed" : healthy ? "passed" : "warning",
    tempC: clampTemp(tempMatch ? Number(tempMatch[1]) : null),
  };
}

function computeStableId(d: { wwn: string | null; serial: string | null; byId: string | null; model: string; name: string }): string {
  if (d.wwn) return `wwn:${d.wwn}`;
  if (d.serial) return `serial:${d.serial}`;
  if (d.byId) return `byid:${d.byId.split("/").pop()}`;
  return `dev:${d.model}:${d.name}`;
}

export async function getDisks(): Promise<DiskInfo[]> {
  if (USE_MOCK) return mockDisks();
  const { stdout, code } = await runArgs("lsblk", [
    "-J",
    "-b",
    "-o",
    "NAME,TYPE,SIZE,MODEL,SERIAL,WWN,REV,HCTL,ROTA,TRAN,MOUNTPOINT,FSTYPE,FSAVAIL,FSUSED,FSSIZE",
  ]);
  if (code !== 0) return mockDisks();
  let parsed: { blockdevices: LsblkNode[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return mockDisks();
  }

  const links = await resolveDiskLinks();
  const zfsPools = await getZfsDiskPools();
  const disks: DiskInfo[] = [];
  for (const node of parsed.blockdevices ?? []) {
    if (node.type !== "disk") continue;
    const device = "/dev/" + node.name;
    const smart = await smartDetail(device);
    const serial = (node.serial ?? smart.serial) || null;
    const wwn = node.wwn || null;
    const link = links.get(node.name) ?? { byId: null, byPath: null };
    const model = (node.model ?? "Unknown").trim() || "Unknown";
    disks.push({
      device,
      model,
      sizeBytes: numOr(node.size, 0),
      type: classify(node),
      temperatureC: smart.tempC,
      smartStatus: smart.status,
      partitions: toPartitions(node),
      zfsPool: zfsPools.get(device) ?? null,
      stableId: computeStableId({ wwn, serial, byId: link.byId, model, name: node.name }),
      serial,
      wwn,
      byId: link.byId,
      transport: transportOf(node),
      firmware: (node.rev ?? smart.firmware) || null,
      rotationRpm: smart.rotationRpm,
      hctl: node.hctl ?? null,
      byPath: link.byPath,
      powerOnHours: smart.powerOnHours,
      reallocatedSectors: smart.reallocatedSectors,
      pendingSectors: smart.pendingSectors,
    });
  }
  return disks.length ? disks : mockDisks();
}
