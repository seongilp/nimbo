import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BlockVolume, MountAction, MountEntry, MountOverview } from "@/lib/types";
import { hasCommand, runArgs, USE_MOCK } from "./exec";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Directories a new mountpoint may live under. Deliberately narrow: mounting
 * over /etc or / would be a trivial way to break (or hijack) the host, and this
 * API is reachable by any admin session.
 */
export const MOUNT_ROOTS = (process.env.NIMBO_MOUNT_ROOTS ?? "/mnt:/media:/srv")
  .split(":")
  .filter(Boolean)
  .map((r) => path.resolve(r));

/** Local filesystems Nimbo will mount. Anything else must go through the CLI. */
const LOCAL_FSTYPES = [
  "ext2", "ext3", "ext4", "xfs", "btrfs", "f2fs", "jfs",
  "vfat", "exfat", "ntfs", "ntfs3", "ntfs-3g",
  "iso9660", "udf", "hfsplus", "reiserfs",
] as const;

const REMOTE_FSTYPES = ["cifs", "nfs", "nfs4"] as const;

/**
 * Filesystem signatures that mean "this partition belongs to a pool/array" —
 * mounting such a member directly corrupts the pool, so the UI blocks it.
 */
const CLAIMED_BY: Record<string, string> = {
  zfs_member: "ZFS 풀",
  linux_raid_member: "RAID 배열",
  LVM2_member: "LVM 물리 볼륨",
  crypto_LUKS: "LUKS 암호화 볼륨",
  swap: "스왑",
};

/** Marker Nimbo appends to fstab lines it owns, so it only ever removes its own. */
export const FSTAB_MARKER = "# nimbo";

const FSTAB_PATH = process.env.NIMBO_FSTAB_PATH ?? "/etc/fstab";
const CRED_DIR = process.env.NIMBO_CIFS_CRED_DIR ?? "/etc/nimbo/cifs";

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

/** Absolute /dev path (or by-uuid/by-label link). Returns null when unusable. */
export function normalizeDevice(input: string): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.includes("\0") || raw.includes("..")) return null;
  if (!/^\/dev\/[A-Za-z0-9][A-Za-z0-9._:+\-/]*$/.test(raw)) return null;
  return path.resolve(raw);
}

/**
 * A mountpoint must be an absolute path strictly *below* one of
 * {@link MOUNT_ROOTS}. Mounting onto a root itself is refused so /mnt never
 * gets shadowed, and ".."/NUL/"-" are rejected outright.
 */
export function normalizeMountpoint(input: string, roots: string[] = MOUNT_ROOTS): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.includes("\0") || raw.startsWith("-")) return null;
  if (!raw.startsWith("/")) return null;
  const resolved = path.resolve(raw);
  if (resolved.length > 4096) return null;
  const ok = roots.some((root) => resolved !== root && resolved.startsWith(root.endsWith("/") ? root : root + "/"));
  return ok ? resolved : null;
}

/** Normalise a caller-supplied fstype against the allow-list. */
export function normalizeFstype(input: string | undefined | null): string | null {
  if (!input) return null;
  const fs = String(input).trim().toLowerCase();
  const all: readonly string[] = [...LOCAL_FSTYPES, ...REMOTE_FSTYPES];
  return all.includes(fs) ? fs : null;
}

/**
 * Comma-separated mount options. Kept to a conservative character class so a
 * value can never introduce a second option list or escape into argv.
 */
export function normalizeOptions(input: string | undefined | null): string | null {
  if (input == null || input === "") return "";
  const s = String(input).trim();
  if (!s) return "";
  if (s.length > 512) return null;
  return /^[A-Za-z0-9_.,=:+@%/\-]+$/.test(s) ? s : null;
}

/** Hostname or IP literal of a remote server. */
export function normalizeServer(input: string): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || s.length > 255) return null;
  const host = /^[A-Za-z0-9]([A-Za-z0-9.\-]*[A-Za-z0-9])?$/;
  const ipv6 = /^[0-9A-Fa-f:]+$/;
  return host.test(s) || ipv6.test(s) ? s : null;
}

/** Remote export/share path: "/volume1/data" (NFS) or "shared" (SMB). */
export function normalizeRemotePath(input: string, protocol: "cifs" | "nfs"): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().replace(/\\/g, "/");
  if (!s || s.includes("\0") || s.includes("..") || s.length > 1024) return null;
  if (!/^[A-Za-z0-9 ._$~#()\-/]+$/.test(s)) return null;
  if (protocol === "nfs") return s.startsWith("/") ? s.replace(/\/+$/, "") || "/" : null;
  return s.replace(/^\/+/, "").replace(/\/+$/, "") || null;
}

const USERNAME_RE = /^[A-Za-z0-9._@\\-]{1,64}$/;

// ---------------------------------------------------------------------------
// /etc/fstab handling (pure)
// ---------------------------------------------------------------------------

export interface FstabLine {
  raw: string;
  spec: string | null;
  mountpoint: string | null;
  fstype: string | null;
  managed: boolean;
}

/** Parse fstab text into structured lines, preserving comments/blank lines. */
export function parseFstab(text: string): FstabLine[] {
  return text.split("\n").map((raw) => {
    const body = raw.split("#")[0].trim();
    const fields = body.split(/\s+/).filter(Boolean);
    if (fields.length < 3) return { raw, spec: null, mountpoint: null, fstype: null, managed: false };
    return {
      raw,
      spec: fields[0],
      // fstab escapes spaces in the mountpoint as \040.
      mountpoint: fields[1].replace(/\\040/g, " "),
      fstype: fields[2],
      managed: raw.includes(FSTAB_MARKER),
    };
  });
}

/** Build a single fstab line. Spaces are escaped the way mount(8) expects. */
export function buildFstabLine(o: {
  spec: string;
  mountpoint: string;
  fstype: string;
  options: string;
}): string {
  const opts = o.options.trim() || "defaults";
  const target = o.mountpoint.replace(/ /g, "\\040");
  return `${o.spec}\t${target}\t${o.fstype}\t${opts}\t0\t0\t${FSTAB_MARKER}`;
}

/** Replace any existing entry for the same mountpoint, then append the new one. */
export function fstabWithEntry(text: string, mountpoint: string, line: string): string {
  const kept = parseFstab(text)
    .filter((l) => l.mountpoint !== mountpoint)
    .map((l) => l.raw);
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  return [...kept, line, ""].join("\n");
}

/**
 * Remove the entry for a mountpoint. Only Nimbo-managed lines are removable —
 * a hand-written fstab entry is never silently dropped.
 */
export function fstabWithoutEntry(text: string, mountpoint: string): { text: string; removed: number; blocked: number } {
  let removed = 0;
  let blocked = 0;
  const kept: string[] = [];
  for (const line of parseFstab(text)) {
    if (line.mountpoint === mountpoint) {
      if (line.managed) {
        removed++;
        continue;
      }
      blocked++;
    }
    kept.push(line.raw);
  }
  return { text: kept.join("\n"), removed, blocked };
}

// ---------------------------------------------------------------------------
// Reading host state
// ---------------------------------------------------------------------------

interface LsblkVol {
  path?: string;
  name: string;
  type: string;
  size?: number | string;
  fstype?: string | null;
  label?: string | null;
  uuid?: string | null;
  mountpoint?: string | null;
  pkname?: string | null;
  children?: LsblkVol[];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function readFstab(): Promise<string> {
  try {
    return await readFile(FSTAB_PATH, "utf8");
  } catch {
    return "";
  }
}

/** Active mounts, from findmnt (JSON) with a /proc/mounts fallback. */
async function readMounts(): Promise<Array<{ device: string; mountpoint: string; fstype: string; options: string }>> {
  const { stdout, code } = await runArgs("findmnt", ["-J", "-b", "-o", "TARGET,SOURCE,FSTYPE,OPTIONS"]);
  if (code === 0 && stdout.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(stdout) as { filesystems?: unknown[] };
      const out: Array<{ device: string; mountpoint: string; fstype: string; options: string }> = [];
      const walk = (nodes: unknown[]) => {
        for (const n of nodes) {
          const node = n as { target?: string; source?: string; fstype?: string; options?: string; children?: unknown[] };
          if (node.target) {
            out.push({
              device: node.source ?? "",
              mountpoint: node.target,
              fstype: node.fstype ?? "",
              options: node.options ?? "",
            });
          }
          if (Array.isArray(node.children)) walk(node.children);
        }
      };
      walk(parsed.filesystems ?? []);
      return out;
    } catch {
      // fall through to /proc/mounts
    }
  }
  try {
    const text = await readFile("/proc/mounts", "utf8");
    return text
      .split("\n")
      .map((l) => l.split(/\s+/))
      .filter((f) => f.length >= 4)
      .map((f) => ({
        device: f[0],
        mountpoint: f[1].replace(/\\040/g, " "),
        fstype: f[2],
        options: f[3],
      }));
  } catch {
    return [];
  }
}

/** Which filesystem helpers this host can actually use. */
async function detectSupport(): Promise<Record<string, boolean>> {
  const probes: Array<[string, string]> = [
    ["btrfs", "mkfs.btrfs"],
    ["ntfs", "mount.ntfs-3g"],
    ["exfat", "mount.exfat"],
    ["vfat", "mkfs.vfat"],
    ["xfs", "mkfs.xfs"],
    ["ext4", "mkfs.ext4"],
    ["cifs", "mount.cifs"],
    ["nfs", "mount.nfs"],
  ];
  const entries = await Promise.all(
    probes.map(async ([key, cmd]) => [key, await hasCommand(cmd)] as const)
  );
  const support: Record<string, boolean> = Object.fromEntries(entries);
  // ntfs3 is an in-kernel driver, so no helper binary exists for it.
  const fsText = await readFile("/proc/filesystems", "utf8").catch(() => "");
  support.ntfs3 = /\bntfs3\b/.test(fsText);
  support.ntfs = support.ntfs || support.ntfs3;
  return support;
}

function mockOverview(): MountOverview {
  const GiB = 1024 ** 3;
  return {
    volumes: [
      { device: "/dev/sdb1", parentDisk: "/dev/sdb", label: "Backup", uuid: "8f2c-1A9B", fstype: "ntfs", sizeBytes: 2000 * GiB, mountpoint: null, inFstab: false, claimedBy: null },
      { device: "/dev/sdc1", parentDisk: "/dev/sdc", label: "MediaBtrfs", uuid: "b7a1-33cd", fstype: "btrfs", sizeBytes: 4000 * GiB, mountpoint: "/mnt/media", inFstab: true, claimedBy: null },
      { device: "/dev/sdd1", parentDisk: "/dev/sdd", label: "CAM", uuid: "12CE-9F04", fstype: "vfat", sizeBytes: 64 * GiB, mountpoint: null, inFstab: false, claimedBy: null },
      { device: "/dev/sde1", parentDisk: "/dev/sde", label: null, uuid: null, fstype: "zfs_member", sizeBytes: 6000 * GiB, mountpoint: null, inFstab: false, claimedBy: "ZFS 풀" },
    ],
    mounts: [
      { device: "/dev/sdc1", mountpoint: "/mnt/media", fstype: "btrfs", options: "rw,relatime,compress=zstd", persistent: true, remote: false, managed: true },
      { device: "//192.168.0.20/photo", mountpoint: "/mnt/synology-photo", fstype: "cifs", options: "rw,vers=3.0", persistent: true, remote: true, managed: true },
    ],
    support: { btrfs: true, ntfs: true, ntfs3: true, exfat: true, vfat: true, xfs: true, ext4: true, cifs: true, nfs: true },
    mountRoots: MOUNT_ROOTS,
    isMock: true,
  };
}

export async function getMountOverview(): Promise<MountOverview> {
  if (USE_MOCK) return mockOverview();

  const { stdout, code } = await runArgs("lsblk", [
    "-J", "-b", "-o", "PATH,NAME,TYPE,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINT,PKNAME",
  ]);
  const volumes: BlockVolume[] = [];
  const fstabText = await readFstab();
  const fstab = parseFstab(fstabText);
  const fstabSpecs = new Set(fstab.map((l) => l.spec).filter(Boolean) as string[]);
  const fstabMounts = new Map(fstab.filter((l) => l.mountpoint).map((l) => [l.mountpoint as string, l]));

  if (code === 0 && stdout.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(stdout) as { blockdevices?: LsblkVol[] };
      const walk = (node: LsblkVol, parent: string | null) => {
        const device = node.path ?? "/dev/" + node.name;
        if (node.type === "part" || node.type === "lvm" || node.type === "crypt" || node.type === "md") {
          const fstype = node.fstype ?? null;
          const uuid = node.uuid ?? null;
          const label = node.label ?? null;
          volumes.push({
            device,
            parentDisk: parent ?? device,
            label,
            uuid,
            fstype,
            sizeBytes: num(node.size),
            mountpoint: node.mountpoint || null,
            inFstab:
              fstabSpecs.has(device) ||
              (uuid ? fstabSpecs.has(`UUID=${uuid}`) : false) ||
              (label ? fstabSpecs.has(`LABEL=${label}`) : false),
            claimedBy: fstype ? CLAIMED_BY[fstype] ?? null : null,
          });
        }
        for (const child of node.children ?? []) {
          walk(child, node.type === "disk" ? device : parent ?? device);
        }
      };
      for (const disk of parsed.blockdevices ?? []) walk(disk, null);
    } catch {
      // leave volumes empty — the UI shows the "no removable volumes" state
    }
  }

  const active = await readMounts();
  const mounts: MountEntry[] = active
    // Hide the kernel's pseudo filesystems; they are noise here and can't be managed.
    .filter((m) => !/^(proc|sysfs|devtmpfs|devpts|tmpfs|cgroup2?|securityfs|pstore|bpf|debugfs|tracefs|mqueue|hugetlbfs|configfs|fusectl|autofs|binfmt_misc|ramfs|efivarfs|nsfs|overlay|squashfs)$/.test(m.fstype))
    .map((m) => {
      const entry = fstabMounts.get(m.mountpoint);
      return {
        device: m.device,
        mountpoint: m.mountpoint,
        fstype: m.fstype,
        options: m.options,
        persistent: Boolean(entry),
        remote: (REMOTE_FSTYPES as readonly string[]).includes(m.fstype),
        managed: Boolean(entry?.managed),
      };
    });

  // fstab entries that are configured but not currently mounted still matter —
  // show them so a failed boot mount is visible instead of silently missing.
  const mountedTargets = new Set(mounts.map((m) => m.mountpoint));
  for (const line of fstab) {
    if (!line.mountpoint || !line.spec || !line.fstype) continue;
    if (mountedTargets.has(line.mountpoint) || line.mountpoint === "none" || line.fstype === "swap") continue;
    mounts.push({
      device: line.spec,
      mountpoint: line.mountpoint,
      fstype: line.fstype,
      options: "(not mounted)",
      persistent: true,
      remote: (REMOTE_FSTYPES as readonly string[]).includes(line.fstype),
      managed: line.managed,
    });
  }

  return { volumes, mounts, support: await detectSupport(), mountRoots: MOUNT_ROOTS, isMock: false };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

type Result = { ok: boolean; error?: string };

function fail(error: string): Result {
  return { ok: false, error };
}

/** Rewrite /etc/fstab through `tee` so it works both as root and under sudo. */
async function writeFstab(text: string): Promise<Result> {
  const backup = await runArgs("cp", ["-f", FSTAB_PATH, FSTAB_PATH + ".nimbo.bak"]);
  if (backup.code !== 0) return fail("fstab 백업에 실패했습니다.");
  const { code, stderr } = await runArgs("tee", [FSTAB_PATH], { input: text, timeoutMs: 10_000 });
  return code === 0 ? { ok: true } : fail(stderr.trim() || "fstab을 저장할 수 없습니다.");
}

/**
 * Pick the fstype to hand `mount -t`. NTFS resolves to the in-kernel ntfs3 when
 * available and falls back to the ntfs-3g FUSE helper, which is what most
 * distributions actually ship.
 */
export function resolveMountFstype(fstype: string, support: Record<string, boolean>): string {
  if (fstype === "ntfs" || fstype === "ntfs3" || fstype === "ntfs-3g") {
    if (support.ntfs3) return "ntfs3";
    return support.ntfs ? "ntfs-3g" : "ntfs";
  }
  return fstype;
}

/** Default options per filesystem — mainly so FAT/NTFS are usable by non-root. */
export function defaultOptionsFor(fstype: string, readOnly: boolean): string {
  const base: string[] = [readOnly ? "ro" : "rw"];
  if (fstype === "vfat" || fstype === "exfat" || fstype.startsWith("ntfs")) {
    base.push("uid=0", "gid=0", "umask=002");
  }
  base.push("nofail");
  return base.join(",");
}

async function ensureDir(target: string): Promise<Result> {
  const { code, stderr } = await runArgs("mkdir", ["-p", "--", target]);
  return code === 0 ? { ok: true } : fail(stderr.trim() || "마운트 지점을 만들 수 없습니다.");
}

async function doMountLocal(a: Extract<MountAction, { kind: "mount" }>): Promise<Result> {
  const device = normalizeDevice(a.device ?? "");
  if (!device) return fail("장치 경로가 올바르지 않습니다.");
  const mountpoint = normalizeMountpoint(a.mountpoint ?? "");
  if (!mountpoint) return fail(`마운트 지점은 ${MOUNT_ROOTS.join(", ")} 아래여야 합니다.`);

  const overview = await getMountOverview();
  const volume = overview.volumes.find((v) => v.device === device);
  if (!volume) return fail("해당 장치를 찾을 수 없습니다.");
  if (volume.claimedBy) return fail(`${volume.claimedBy}에 속한 볼륨은 직접 마운트할 수 없습니다.`);
  if (volume.mountpoint) return fail(`이미 ${volume.mountpoint}에 마운트되어 있습니다.`);
  if (overview.mounts.some((m) => m.mountpoint === mountpoint && m.options !== "(not mounted)")) {
    return fail("해당 경로에 이미 다른 볼륨이 마운트되어 있습니다.");
  }

  const requested = normalizeFstype(a.fstype) ?? normalizeFstype(volume.fstype);
  if (!requested) return fail("지원하지 않는 파일시스템입니다.");
  const fstype = resolveMountFstype(requested, overview.support);
  if (fstype === "ntfs" && !overview.support.ntfs) {
    return fail("NTFS 지원이 없습니다. ntfs-3g 패키지를 설치하세요.");
  }
  if (fstype === "exfat" && !overview.support.exfat) {
    return fail("exFAT 지원이 없습니다. exfatprogs 패키지를 설치하세요.");
  }

  const custom = normalizeOptions(a.options);
  if (custom === null) return fail("마운트 옵션이 올바르지 않습니다.");
  const options = custom || defaultOptionsFor(fstype, Boolean(a.readOnly));

  const dir = await ensureDir(mountpoint);
  if (!dir.ok) return dir;

  const { code, stderr } = await runArgs(
    "mount",
    ["-t", fstype, "-o", options, "--", device, mountpoint],
    { timeoutMs: 60_000 }
  );
  if (code !== 0) return fail(stderr.trim() || "마운트에 실패했습니다.");

  if (a.persist) {
    // Prefer UUID= in fstab: kernel device names (/dev/sdb1) are not stable
    // across reboots, so a /dev-based entry can mount the wrong disk.
    const spec = volume.uuid ? `UUID=${volume.uuid}` : device;
    const line = buildFstabLine({ spec, mountpoint, fstype, options });
    const written = await writeFstab(fstabWithEntry(await readFstab(), mountpoint, line));
    if (!written.ok) return fail(`마운트는 됐지만 fstab 저장에 실패했습니다: ${written.error}`);
  }
  return { ok: true };
}

/** Nimbo-managed credential file path for a CIFS mount. */
export function credentialPath(mountpoint: string): string {
  const slug = mountpoint.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mount";
  return path.join(CRED_DIR, `${slug}.cred`);
}

async function writeCredentials(file: string, username: string, password: string, domain: string): Promise<Result> {
  const body =
    `username=${username}\n` +
    `password=${password}\n` +
    (domain ? `domain=${domain}\n` : "");
  // Create with 0600 up front so the password is never briefly world-readable.
  const created = await runArgs("install", ["-D", "-m", "600", "/dev/null", file]);
  if (created.code !== 0) return fail("자격 증명 파일을 만들 수 없습니다.");
  const { code } = await runArgs("tee", [file], { input: body });
  return code === 0 ? { ok: true } : fail("자격 증명 파일을 저장할 수 없습니다.");
}

async function doMountRemote(a: Extract<MountAction, { kind: "remote.mount" }>): Promise<Result> {
  const protocol = a.protocol === "nfs" ? "nfs" : a.protocol === "cifs" ? "cifs" : null;
  if (!protocol) return fail("프로토콜은 cifs 또는 nfs여야 합니다.");
  const server = normalizeServer(a.server ?? "");
  if (!server) return fail("서버 주소가 올바르지 않습니다.");
  const remotePath = normalizeRemotePath(a.remotePath ?? "", protocol);
  if (!remotePath) {
    return fail(protocol === "nfs" ? "내보내기 경로는 /로 시작해야 합니다." : "공유 이름이 올바르지 않습니다.");
  }
  const mountpoint = normalizeMountpoint(a.mountpoint ?? "");
  if (!mountpoint) return fail(`마운트 지점은 ${MOUNT_ROOTS.join(", ")} 아래여야 합니다.`);

  const support = await detectSupport();
  if (protocol === "cifs" && !support.cifs) return fail("mount.cifs가 없습니다. cifs-utils를 설치하세요.");
  if (protocol === "nfs" && !support.nfs) return fail("mount.nfs가 없습니다. nfs-common을 설치하세요.");

  const custom = normalizeOptions(a.options);
  if (custom === null) return fail("마운트 옵션이 올바르지 않습니다.");

  const source = protocol === "cifs" ? `//${server}/${remotePath}` : `${server}:${remotePath}`;
  const opts: string[] = [a.readOnly ? "ro" : "rw", "nofail"];

  if (protocol === "cifs") {
    const username = (a.username ?? "").trim();
    if (username) {
      if (!USERNAME_RE.test(username)) return fail("사용자 이름이 올바르지 않습니다.");
      const domain = (a.domain ?? "").trim();
      if (domain && !USERNAME_RE.test(domain)) return fail("도메인이 올바르지 않습니다.");
      const password = a.password ?? "";
      if (password.includes("\n") || password.length > 256) return fail("비밀번호가 올바르지 않습니다.");
      // The password goes into a 0600 credentials file, never into argv (visible
      // in `ps`) and never into /etc/fstab (world-readable).
      const credFile = credentialPath(mountpoint);
      const written = await writeCredentials(credFile, username, password, domain);
      if (!written.ok) return written;
      opts.push(`credentials=${credFile}`);
    } else {
      opts.push("guest");
    }
    opts.push("uid=0", "gid=0", "file_mode=0664", "dir_mode=0775");
  }
  if (custom) opts.push(custom);

  const dir = await ensureDir(mountpoint);
  if (!dir.ok) return dir;

  const options = opts.join(",");
  const { code, stderr } = await runArgs(
    "mount",
    ["-t", protocol, "-o", options, "--", source, mountpoint],
    { timeoutMs: 60_000 }
  );
  if (code !== 0) return fail(stderr.trim() || "원격 마운트에 실패했습니다.");

  if (a.persist) {
    const line = buildFstabLine({ spec: source, mountpoint, fstype: protocol, options });
    const written = await writeFstab(fstabWithEntry(await readFstab(), mountpoint, line));
    if (!written.ok) return fail(`마운트는 됐지만 fstab 저장에 실패했습니다: ${written.error}`);
  }
  return { ok: true };
}

async function doUnmount(a: Extract<MountAction, { kind: "unmount" }>): Promise<Result> {
  const mountpoint = normalizeMountpoint(a.mountpoint ?? "");
  if (!mountpoint) return fail("이 마운트 지점은 관리 대상이 아닙니다.");

  const active = await readMounts();
  if (!active.some((m) => m.mountpoint === mountpoint)) return fail("마운트되어 있지 않습니다.");

  // -l (lazy) detaches a busy mount; only offered explicitly because the
  // filesystem stays live until the last user closes it.
  const args = a.force ? ["-l", "--", mountpoint] : ["--", mountpoint];
  const { code, stderr } = await runArgs("umount", args, { timeoutMs: 60_000 });
  if (code !== 0) {
    return fail(/busy/i.test(stderr) ? "사용 중이라 언마운트할 수 없습니다. (강제 옵션을 사용하세요)" : stderr.trim() || "언마운트에 실패했습니다.");
  }
  if (a.removeFstab) return doFstabRemove(mountpoint);
  return { ok: true };
}

async function doFstabRemove(mountpoint: string): Promise<Result> {
  const text = await readFstab();
  const { text: next, removed, blocked } = fstabWithoutEntry(text, mountpoint);
  if (removed === 0) {
    return blocked > 0
      ? fail("Nimbo가 만들지 않은 fstab 항목은 삭제할 수 없습니다.")
      : fail("fstab에 해당 항목이 없습니다.");
  }
  return writeFstab(next.endsWith("\n") ? next : next + "\n");
}

export async function runMountAction(action: MountAction): Promise<Result> {
  if (!action || typeof action !== "object" || !("kind" in action)) return fail("작업 종류가 필요합니다.");
  if (USE_MOCK) {
    // Validate in mock mode too, so the UI's error paths are exercised locally.
    switch (action.kind) {
      case "mount":
        return normalizeDevice(action.device ?? "") && normalizeMountpoint(action.mountpoint ?? "")
          ? { ok: true }
          : fail("장치 또는 마운트 지점이 올바르지 않습니다.");
      case "remote.mount":
        return normalizeServer(action.server ?? "") && normalizeMountpoint(action.mountpoint ?? "")
          ? { ok: true }
          : fail("서버 주소 또는 마운트 지점이 올바르지 않습니다.");
      case "unmount":
      case "fstab.remove":
        return normalizeMountpoint(action.mountpoint ?? "") ? { ok: true } : fail("마운트 지점이 올바르지 않습니다.");
      default:
        return fail("알 수 없는 작업입니다.");
    }
  }

  switch (action.kind) {
    case "mount":
      return doMountLocal(action);
    case "remote.mount":
      return doMountRemote(action);
    case "unmount":
      return doUnmount(action);
    case "fstab.remove": {
      const mountpoint = normalizeMountpoint(action.mountpoint ?? "");
      if (!mountpoint) return fail("이 마운트 지점은 관리 대상이 아닙니다.");
      return doFstabRemove(mountpoint);
    }
    default:
      return fail("알 수 없는 작업입니다.");
  }
}
