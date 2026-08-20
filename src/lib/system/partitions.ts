import { readFile } from "node:fs/promises";

import type { DiskTable, FreeRegion, PartitionAction, PartitionOverview, PartitionSlot } from "@/lib/types";
import { hasCommand, runArgs, USE_MOCK } from "./exec";

// ---------------------------------------------------------------------------
// Partitioning is the one destructive area of Nimbo: a wrong `sfdisk` wipes a
// disk. Every mutation therefore has to clear three gates —
//   1. the disk is not in use (mounted / pool member / holds the running OS),
//   2. the caller echoed the exact device path back in `confirm`,
//   3. the argv is built from validated, typed values only.
// ---------------------------------------------------------------------------

const MiB = 1024 * 1024;

/** Whole-disk device path, e.g. /dev/sda or /dev/nvme0n1. */
const DISK_RE = /^\/dev\/(?:sd[a-z]{1,2}|vd[a-z]{1,2}|hd[a-z]{1,2}|nvme\d+n\d+|mmcblk\d+)$/;
/** Partition device path, e.g. /dev/sda1 or /dev/nvme0n1p2. */
const PART_RE = /^\/dev\/(?:sd[a-z]{1,2}\d+|vd[a-z]{1,2}\d+|hd[a-z]{1,2}\d+|nvme\d+n\d+p\d+|mmcblk\d+p\d+)$/;

// A leading "-" would be read as a flag if the label ever moved position in an
// argv, so labels must start with an alphanumeric.
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,31}$/;

/** Filesystems Nimbo can create, with the exact mkfs invocation for each. */
const MKFS: Record<string, { bin: string; args: string[]; labelFlag: string | null }> = {
  ext4: { bin: "mkfs.ext4", args: ["-F"], labelFlag: "-L" },
  ext3: { bin: "mkfs.ext3", args: ["-F"], labelFlag: "-L" },
  xfs: { bin: "mkfs.xfs", args: ["-f"], labelFlag: "-L" },
  btrfs: { bin: "mkfs.btrfs", args: ["-f"], labelFlag: "-L" },
  f2fs: { bin: "mkfs.f2fs", args: ["-f"], labelFlag: "-l" },
  vfat: { bin: "mkfs.vfat", args: ["-F", "32"], labelFlag: "-n" },
  exfat: { bin: "mkfs.exfat", args: [], labelFlag: "-n" },
  ntfs: { bin: "mkfs.ntfs", args: ["-f", "-Q"], labelFlag: "-L" },
};

/** Filesystem signatures that mean the partition belongs to something bigger. */
const IN_USE_FSTYPE: Record<string, string> = {
  zfs_member: "ZFS 풀 구성원",
  linux_raid_member: "RAID 배열 구성원",
  LVM2_member: "LVM 물리 볼륨",
  crypto_LUKS: "LUKS 암호화 볼륨",
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isDiskDevice(input: unknown): input is string {
  return typeof input === "string" && DISK_RE.test(input.trim());
}

export function isPartitionDevice(input: unknown): input is string {
  return typeof input === "string" && PART_RE.test(input.trim());
}

/** /dev/sda3 -> /dev/sda ; /dev/nvme0n1p2 -> /dev/nvme0n1 */
export function diskOfPartition(part: string): string | null {
  const m = part.match(/^(\/dev\/(?:nvme\d+n\d+|mmcblk\d+))p\d+$/) ?? part.match(/^(\/dev\/(?:sd|vd|hd)[a-z]{1,2})\d+$/);
  return m ? m[1] : null;
}

/** The partition number at the end of a partition device path. */
export function partitionNumber(part: string): number | null {
  const m = part.match(/(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 && n <= 128 ? n : null;
}

/**
 * The confirmation gate for every destructive action: the caller must echo the
 * exact device path back. Pure so it can be unit-tested without going anywhere
 * near a real disk.
 */
export function confirmMatches(expected: string, confirm: unknown): boolean {
  return typeof confirm === "string" && confirm.trim() === expected;
}

export function normalizeFsLabel(input: unknown): string | null | undefined {
  if (input == null || input === "") return undefined; // absent = no label
  if (typeof input !== "string") return null;
  const s = input.trim();
  return LABEL_RE.test(s) ? s : null;
}

/**
 * Gaps between partitions that are large enough to hold a new one (>= 1 MiB).
 * Sectors are inclusive of `firstLba`..`lastLba`, matching sfdisk's own model.
 */
export function freeRegions(
  partitions: Array<{ startSector: number; sizeSectors: number }>,
  firstLba: number,
  lastLba: number,
  sectorSize: number
): FreeRegion[] {
  const minSectors = Math.max(1, Math.floor(MiB / Math.max(1, sectorSize)));
  const sorted = [...partitions].sort((a, b) => a.startSector - b.startSector);
  const gaps: FreeRegion[] = [];
  let cursor = firstLba;
  for (const p of sorted) {
    if (p.startSector > cursor) {
      const size = p.startSector - cursor;
      if (size >= minSectors) gaps.push({ startSector: cursor, sizeSectors: size, sizeBytes: size * sectorSize });
    }
    cursor = Math.max(cursor, p.startSector + p.sizeSectors);
  }
  if (lastLba >= cursor) {
    const size = lastLba - cursor + 1;
    if (size >= minSectors) gaps.push({ startSector: cursor, sizeSectors: size, sizeBytes: size * sectorSize });
  }
  return gaps;
}

/** The one-line sfdisk script that appends a partition. */
export function sfdiskAppendScript(sizeMiB: number | undefined): string {
  // An empty size field means "use all remaining space"; "L" is the generic
  // Linux filesystem type on both GPT and MBR layouts.
  return sizeMiB && sizeMiB > 0 ? `,${Math.floor(sizeMiB)}M,L\n` : `,,L\n`;
}

/** Build the mkfs argv for a filesystem, or null when unsupported. */
export function buildMkfsArgs(fstype: string, device: string, label?: string): { bin: string; args: string[] } | null {
  const spec = MKFS[fstype];
  if (!spec) return null;
  const labelArgs = label && spec.labelFlag ? [spec.labelFlag, label] : [];
  return { bin: spec.bin, args: [...spec.args, ...labelArgs, device] };
}

// ---------------------------------------------------------------------------
// Reading host state
// ---------------------------------------------------------------------------

interface SfdiskTable {
  partitiontable?: {
    label?: string;
    device?: string;
    unit?: string;
    firstlba?: number;
    lastlba?: number;
    sectorsize?: number;
    partitions?: Array<{ node?: string; start?: number; size?: number; type?: string; name?: string }>;
  };
}

interface LsblkDisk {
  path?: string;
  name: string;
  type: string;
  size?: number | string;
  model?: string | null;
  fstype?: string | null;
  label?: string | null;
  mountpoint?: string | null;
  children?: LsblkDisk[];
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Kernel disk that carries the running root filesystem, if we can tell. */
async function rootDisk(): Promise<string | null> {
  const { stdout, code } = await runArgs("findmnt", ["-n", "-o", "SOURCE", "--target", "/"]);
  if (code !== 0) return null;
  const source = stdout.trim();
  if (!source.startsWith("/dev/")) return null;
  return diskOfPartition(source) ?? (isDiskDevice(source) ? source : null);
}

async function readSfdisk(device: string): Promise<SfdiskTable["partitiontable"] | null> {
  const { stdout, code } = await runArgs("sfdisk", ["--json", device]);
  if (code !== 0 || !stdout.trim().startsWith("{")) return null;
  try {
    return (JSON.parse(stdout) as SfdiskTable).partitiontable ?? null;
  } catch {
    return null;
  }
}

async function detectMkfsSupport(): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    Object.entries(MKFS).map(async ([fs, spec]) => [fs, await hasCommand(spec.bin)] as const)
  );
  return Object.fromEntries(entries);
}

function mockOverview(): PartitionOverview {
  const GiB = 1024 ** 3;
  const sectorSize = 512;
  const toSectors = (bytes: number) => Math.floor(bytes / sectorSize);
  const parts: PartitionSlot[] = [
    {
      device: "/dev/sdb1", number: 1, startSector: 2048, sizeSectors: toSectors(500 * GiB),
      sizeBytes: 500 * GiB, typeName: "Linux filesystem", fstype: "ext4", label: "data", mountpoint: null,
    },
  ];
  return {
    disks: [
      {
        device: "/dev/sdb",
        model: "WDC WD20EFRX",
        sizeBytes: 2000 * GiB,
        sectorSize,
        label: "gpt",
        partitions: parts,
        free: freeRegions(parts, 2048, toSectors(2000 * GiB) - 34, sectorSize),
        lockedReason: null,
      },
      {
        device: "/dev/sda",
        model: "Samsung SSD 870",
        sizeBytes: 500 * GiB,
        sectorSize,
        label: "gpt",
        partitions: [
          {
            device: "/dev/sda1", number: 1, startSector: 2048, sizeSectors: toSectors(500 * GiB) - 2048,
            sizeBytes: 500 * GiB, typeName: "Linux filesystem", fstype: "ext4", label: null, mountpoint: "/",
          },
        ],
        free: [],
        lockedReason: "시스템 디스크(루트 파일시스템)입니다.",
      },
    ],
    mkfsSupport: { ext4: true, ext3: true, xfs: true, btrfs: true, f2fs: false, vfat: true, exfat: true, ntfs: true },
    toolInstalled: true,
    isMock: true,
  };
}

export async function getPartitionOverview(): Promise<PartitionOverview> {
  if (USE_MOCK) return mockOverview();

  const toolInstalled = await hasCommand("sfdisk");
  const { stdout, code } = await runArgs("lsblk", [
    "-J", "-b", "-o", "PATH,NAME,TYPE,SIZE,MODEL,FSTYPE,LABEL,MOUNTPOINT",
  ]);
  if (code !== 0 || !stdout.trim().startsWith("{")) {
    return { disks: [], mkfsSupport: await detectMkfsSupport(), toolInstalled, isMock: false };
  }

  let parsed: { blockdevices?: LsblkDisk[] };
  try {
    parsed = JSON.parse(stdout) as { blockdevices?: LsblkDisk[] };
  } catch {
    return { disks: [], mkfsSupport: await detectMkfsSupport(), toolInstalled, isMock: false };
  }

  const root = await rootDisk();
  const swaps = await readFile("/proc/swaps", "utf8").catch(() => "");
  const disks: DiskTable[] = [];

  for (const node of parsed.blockdevices ?? []) {
    if (node.type !== "disk") continue;
    const device = node.path ?? "/dev/" + node.name;
    if (!isDiskDevice(device)) continue;

    const table = toolInstalled ? await readSfdisk(device) : null;
    const sectorSize = num(table?.sectorsize, 512) || 512;
    const sizeBytes = num(node.size);

    // Flatten children so LVM/crypt layers still surface their fstype/mountpoint.
    const childByDevice = new Map<string, LsblkDisk>();
    const collect = (n: LsblkDisk) => {
      const dev = n.path ?? "/dev/" + n.name;
      childByDevice.set(dev, n);
      n.children?.forEach(collect);
    };
    node.children?.forEach(collect);

    const partitions: PartitionSlot[] = (table?.partitions ?? []).map((p) => {
      const dev = p.node ?? "";
      const child = childByDevice.get(dev);
      const sizeSectors = num(p.size);
      return {
        device: dev,
        number: partitionNumber(dev) ?? 0,
        startSector: num(p.start),
        sizeSectors,
        sizeBytes: sizeSectors * sectorSize,
        typeName: p.name || p.type || "—",
        fstype: child?.fstype ?? null,
        label: child?.label ?? null,
        mountpoint: child?.mountpoint || null,
      };
    });

    // Why this disk may not be touched — the first reason wins.
    let lockedReason: string | null = null;
    if (root && device === root) lockedReason = "시스템 디스크(루트 파일시스템)입니다.";
    if (!lockedReason) {
      for (const [dev, child] of childByDevice) {
        if (child.mountpoint) {
          lockedReason = `${dev} 가 ${child.mountpoint} 에 마운트되어 있습니다.`;
          break;
        }
        const claimed = child.fstype ? IN_USE_FSTYPE[child.fstype] : null;
        if (claimed) {
          lockedReason = `${dev} 는 ${claimed}입니다.`;
          break;
        }
        if (swaps.includes(dev)) {
          lockedReason = `${dev} 가 스왑으로 사용 중입니다.`;
          break;
        }
      }
    }

    const firstLba = num(table?.firstlba, 2048);
    const lastLba = num(table?.lastlba, Math.floor(sizeBytes / sectorSize) - 1);
    disks.push({
      device,
      model: (node.model ?? "Unknown").trim() || "Unknown",
      sizeBytes,
      sectorSize,
      label: table?.label ?? null,
      partitions,
      free: table ? freeRegions(partitions, firstLba, lastLba, sectorSize) : [],
      lockedReason,
    });
  }

  return { disks, mkfsSupport: await detectMkfsSupport(), toolInstalled, isMock: false };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type Result = { ok: boolean; error?: string };

function fail(error: string): Result {
  return { ok: false, error };
}

/**
 * Resolve the target disk and refuse the operation unless it is idle AND the
 * caller echoed the device path back in `confirm`.
 */
async function gate(disk: string, confirm: unknown): Promise<{ table: DiskTable } | Result> {
  if (!confirmMatches(disk, confirm)) {
    return fail("확인을 위해 장치 경로를 정확히 입력해야 합니다.");
  }
  const overview = await getPartitionOverview();
  const table = overview.disks.find((d) => d.device === disk);
  if (!table) return fail("디스크를 찾을 수 없습니다.");
  if (table.lockedReason) return fail(`이 디스크는 변경할 수 없습니다 — ${table.lockedReason}`);
  return { table };
}

/** Make the kernel re-read the partition table and wait for udev to settle. */
async function refreshTable(disk: string): Promise<void> {
  await runArgs("partprobe", [disk], { timeoutMs: 30_000 });
  await runArgs("udevadm", ["settle", "--timeout=15"], { timeoutMs: 20_000 });
}

async function createTable(a: Extract<PartitionAction, { kind: "table.create" }>): Promise<Result> {
  const device = String(a.device ?? "").trim();
  if (!isDiskDevice(device)) return fail("디스크 경로가 올바르지 않습니다.");
  const label = a.label === "gpt" || a.label === "dos" ? a.label : null;
  if (!label) return fail("파티션 테이블 형식은 gpt 또는 dos여야 합니다.");

  const gated = await gate(device, a.confirm);
  if ("ok" in gated) return gated;

  const wiped = await runArgs("wipefs", ["-a", "--", device], { timeoutMs: 60_000 });
  if (wiped.code !== 0) return fail(wiped.stderr.trim() || "기존 시그니처를 지울 수 없습니다.");

  const { code, stderr } = await runArgs("sfdisk", [device], {
    input: `label: ${label}\n`,
    timeoutMs: 60_000,
  });
  if (code !== 0) return fail(stderr.trim() || "파티션 테이블 생성에 실패했습니다.");
  await refreshTable(device);
  return { ok: true };
}

async function createPartition(a: Extract<PartitionAction, { kind: "partition.create" }>): Promise<Result> {
  const device = String(a.device ?? "").trim();
  if (!isDiskDevice(device)) return fail("디스크 경로가 올바르지 않습니다.");

  const sizeMiB = a.sizeMiB == null ? undefined : Math.floor(Number(a.sizeMiB));
  if (sizeMiB !== undefined && (!Number.isFinite(sizeMiB) || sizeMiB < 1 || sizeMiB > 1024 * 1024 * 64)) {
    return fail("파티션 크기가 올바르지 않습니다.");
  }
  const label = normalizeFsLabel(a.label);
  if (label === null) return fail("레이블이 올바르지 않습니다.");
  const fstype = a.fstype ? String(a.fstype).trim() : "";
  if (fstype && !MKFS[fstype]) return fail("지원하지 않는 파일시스템입니다.");

  const gated = await gate(device, a.confirm);
  if ("ok" in gated) return gated;
  if (!gated.table.label) return fail("먼저 파티션 테이블을 만들어야 합니다.");
  if (gated.table.free.length === 0) return fail("남은 빈 공간이 없습니다.");

  const before = new Set(gated.table.partitions.map((p) => p.device));
  const { code, stderr } = await runArgs("sfdisk", ["--append", device], {
    input: sfdiskAppendScript(sizeMiB),
    timeoutMs: 60_000,
  });
  if (code !== 0) return fail(stderr.trim() || "파티션 생성에 실패했습니다.");
  await refreshTable(device);

  if (!fstype) return { ok: true };

  // Format the partition that just appeared — never one that already existed.
  const after = await getPartitionOverview();
  const created = after.disks
    .find((d) => d.device === device)
    ?.partitions.find((p) => !before.has(p.device));
  if (!created) return fail("파티션은 만들어졌지만 새 파티션을 찾지 못해 포맷하지 않았습니다.");
  return formatDevice(created.device, fstype, label);
}

async function deletePartition(a: Extract<PartitionAction, { kind: "partition.delete" }>): Promise<Result> {
  const device = String(a.device ?? "").trim();
  if (!isDiskDevice(device)) return fail("디스크 경로가 올바르지 않습니다.");
  const number = Math.floor(Number(a.number));
  if (!Number.isInteger(number) || number < 1 || number > 128) return fail("파티션 번호가 올바르지 않습니다.");

  const gated = await gate(device, a.confirm);
  if ("ok" in gated) return gated;
  if (!gated.table.partitions.some((p) => p.number === number)) return fail("해당 파티션이 없습니다.");

  const { code, stderr } = await runArgs("sfdisk", ["--delete", device, String(number)], { timeoutMs: 60_000 });
  if (code !== 0) return fail(stderr.trim() || "파티션 삭제에 실패했습니다.");
  await refreshTable(device);
  return { ok: true };
}

async function formatDevice(partition: string, fstype: string, label?: string): Promise<Result> {
  const built = buildMkfsArgs(fstype, partition, label);
  if (!built) return fail("지원하지 않는 파일시스템입니다.");
  if (!(await hasCommand(built.bin))) return fail(`${built.bin} 이(가) 설치되어 있지 않습니다.`);

  // Clear old signatures first — mkfs otherwise refuses (or leaves a stale
  // superblock that makes blkid report the wrong filesystem).
  const wiped = await runArgs("wipefs", ["-a", "--", partition], { timeoutMs: 60_000 });
  if (wiped.code !== 0) return fail(wiped.stderr.trim() || "기존 시그니처를 지울 수 없습니다.");

  // mkfs on a multi-TB disk is slow; give it a generous ceiling.
  const { code, stderr } = await runArgs(built.bin, built.args, { timeoutMs: 30 * 60_000 });
  if (code !== 0) return fail(stderr.trim() || "포맷에 실패했습니다.");
  await runArgs("udevadm", ["settle", "--timeout=15"], { timeoutMs: 20_000 });
  return { ok: true };
}

async function formatPartition(a: Extract<PartitionAction, { kind: "partition.format" }>): Promise<Result> {
  const partition = String(a.device ?? "").trim();
  if (!isPartitionDevice(partition)) return fail("파티션 경로가 올바르지 않습니다.");
  const disk = diskOfPartition(partition);
  if (!disk) return fail("파티션이 속한 디스크를 찾을 수 없습니다.");
  const label = normalizeFsLabel(a.label);
  if (label === null) return fail("레이블이 올바르지 않습니다.");
  const fstype = String(a.fstype ?? "").trim();
  if (!MKFS[fstype]) return fail("지원하지 않는 파일시스템입니다.");

  // Confirm is checked against the PARTITION here — that is what gets erased.
  if (!confirmMatches(partition, a.confirm)) {
    return fail("확인을 위해 파티션 경로를 정확히 입력해야 합니다.");
  }
  const overview = await getPartitionOverview();
  const table = overview.disks.find((d) => d.device === disk);
  if (!table) return fail("디스크를 찾을 수 없습니다.");
  const slot = table.partitions.find((p) => p.device === partition);
  if (!slot) return fail("해당 파티션이 없습니다.");
  if (slot.mountpoint) return fail(`${slot.mountpoint} 에 마운트되어 있어 포맷할 수 없습니다.`);
  if (table.lockedReason) return fail(`이 디스크는 변경할 수 없습니다 — ${table.lockedReason}`);

  return formatDevice(partition, fstype, label);
}

export async function runPartitionAction(action: PartitionAction): Promise<Result> {
  if (!action || typeof action !== "object" || !("kind" in action)) return fail("작업 종류가 필요합니다.");

  if (USE_MOCK) {
    // Mock mode still enforces the confirm gate so the UI flow is testable.
    if (!confirmMatches(String(action.device ?? ""), action.confirm)) {
      return fail("확인을 위해 장치 경로를 정확히 입력해야 합니다.");
    }
    return { ok: true };
  }

  switch (action.kind) {
    case "table.create":
      return createTable(action);
    case "partition.create":
      return createPartition(action);
    case "partition.delete":
      return deletePartition(action);
    case "partition.format":
      return formatPartition(action);
    default:
      return fail("알 수 없는 작업입니다.");
  }
}
