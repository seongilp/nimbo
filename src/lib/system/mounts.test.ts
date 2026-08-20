import { describe, expect, it } from "vitest";

import {
  buildFstabLine,
  credentialPath,
  defaultOptionsFor,
  FSTAB_MARKER,
  fstabWithEntry,
  fstabWithoutEntry,
  normalizeDevice,
  normalizeFstype,
  normalizeMountpoint,
  normalizeOptions,
  normalizeRemotePath,
  normalizeServer,
  parseFstab,
  resolveMountFstype,
} from "./mounts";

const ROOTS = ["/mnt", "/media", "/srv"];

describe("mounts — device validation", () => {
  it("accepts /dev paths including by-uuid links", () => {
    expect(normalizeDevice("/dev/sdb1")).toBe("/dev/sdb1");
    expect(normalizeDevice("/dev/disk/by-uuid/8f2c-1A9B")).toBe("/dev/disk/by-uuid/8f2c-1A9B");
  });

  it("rejects anything outside /dev and any traversal", () => {
    expect(normalizeDevice("/etc/passwd")).toBeNull();
    expect(normalizeDevice("/dev/../etc/shadow")).toBeNull();
    expect(normalizeDevice("/dev/sdb1; rm -rf /")).toBeNull();
    expect(normalizeDevice("")).toBeNull();
  });
});

describe("mounts — mountpoint policy", () => {
  it("accepts a path strictly below an allowed root", () => {
    expect(normalizeMountpoint("/mnt/backup", ROOTS)).toBe("/mnt/backup");
    expect(normalizeMountpoint("/srv/nas/photos", ROOTS)).toBe("/srv/nas/photos");
  });

  it("refuses the roots themselves and everything outside them", () => {
    expect(normalizeMountpoint("/mnt", ROOTS)).toBeNull();
    expect(normalizeMountpoint("/", ROOTS)).toBeNull();
    expect(normalizeMountpoint("/etc", ROOTS)).toBeNull();
    expect(normalizeMountpoint("/mnt/../etc", ROOTS)).toBeNull();
    // A sibling directory that merely shares the root's prefix is not inside it.
    expect(normalizeMountpoint("/mntfoo/bar", ROOTS)).toBeNull();
  });
});

describe("mounts — filesystem and option validation", () => {
  it("allows known filesystems only", () => {
    expect(normalizeFstype("btrfs")).toBe("btrfs");
    expect(normalizeFstype("NTFS")).toBe("ntfs");
    expect(normalizeFstype("zfs_member")).toBeNull();
    expect(normalizeFstype(null)).toBeNull();
  });

  it("rejects option strings with whitespace or shell characters", () => {
    expect(normalizeOptions("rw,noatime,uid=1000")).toBe("rw,noatime,uid=1000");
    expect(normalizeOptions("")).toBe("");
    expect(normalizeOptions("rw noatime")).toBeNull();
    expect(normalizeOptions("rw,$(id)")).toBeNull();
  });

  it("prefers the in-kernel ntfs3 driver and falls back to ntfs-3g", () => {
    expect(resolveMountFstype("ntfs", { ntfs3: true, ntfs: true })).toBe("ntfs3");
    expect(resolveMountFstype("ntfs", { ntfs3: false, ntfs: true })).toBe("ntfs-3g");
    expect(resolveMountFstype("btrfs", { ntfs3: true })).toBe("btrfs");
  });

  it("adds ownership options for filesystems with no unix permissions", () => {
    expect(defaultOptionsFor("vfat", false)).toContain("umask=002");
    expect(defaultOptionsFor("ext4", true).startsWith("ro")).toBe(true);
    expect(defaultOptionsFor("ext4", false)).not.toContain("umask");
  });
});

describe("mounts — remote target validation", () => {
  it("accepts hostnames and IPs, rejects injection attempts", () => {
    expect(normalizeServer("192.168.0.20")).toBe("192.168.0.20");
    expect(normalizeServer("synology.local")).toBe("synology.local");
    expect(normalizeServer("host,other=1")).toBeNull();
    expect(normalizeServer("host name")).toBeNull();
  });

  it("normalises SMB share names and NFS export paths differently", () => {
    expect(normalizeRemotePath("/photo/", "cifs")).toBe("photo");
    expect(normalizeRemotePath("\\\\photo", "cifs")).toBe("photo");
    expect(normalizeRemotePath("/volume1/photo/", "nfs")).toBe("/volume1/photo");
    // NFS exports must be absolute; SMB shares must not traverse.
    expect(normalizeRemotePath("volume1", "nfs")).toBeNull();
    expect(normalizeRemotePath("../etc", "cifs")).toBeNull();
  });

  it("derives a per-mount credential file under the managed directory", () => {
    expect(credentialPath("/mnt/synology-photo")).toMatch(/mnt-synology-photo\.cred$/);
  });
});

describe("mounts — /etc/fstab editing", () => {
  const fstab = [
    "# /etc/fstab",
    "UUID=aaaa-bbbb\t/\text4\tdefaults\t0\t1",
    "UUID=cccc-dddd\t/mnt/media\tbtrfs\trw,nofail\t0\t0\t" + FSTAB_MARKER,
    "//10.0.0.5/share\t/mnt/legacy\tcifs\tguest\t0\t0",
    "",
  ].join("\n");

  it("parses spec/mountpoint/fstype and flags Nimbo-managed lines", () => {
    const lines = parseFstab(fstab).filter((l) => l.mountpoint);
    expect(lines.map((l) => l.mountpoint)).toEqual(["/", "/mnt/media", "/mnt/legacy"]);
    expect(lines[1].managed).toBe(true);
    expect(lines[2].managed).toBe(false);
  });

  it("builds a line with the marker and escaped spaces", () => {
    const line = buildFstabLine({ spec: "UUID=1", mountpoint: "/mnt/my disk", fstype: "ext4", options: "" });
    expect(line).toContain("/mnt/my\\040disk");
    expect(line).toContain("defaults");
    expect(line.endsWith(FSTAB_MARKER)).toBe(true);
  });

  it("replaces an existing entry for the same mountpoint instead of duplicating it", () => {
    const line = buildFstabLine({ spec: "UUID=new", mountpoint: "/mnt/media", fstype: "btrfs", options: "rw" });
    const next = fstabWithEntry(fstab, "/mnt/media", line);
    const targets = parseFstab(next).filter((l) => l.mountpoint === "/mnt/media");
    expect(targets).toHaveLength(1);
    expect(targets[0].spec).toBe("UUID=new");
  });

  it("removes only Nimbo-managed entries and refuses hand-written ones", () => {
    const managed = fstabWithoutEntry(fstab, "/mnt/media");
    expect(managed.removed).toBe(1);
    expect(parseFstab(managed.text).some((l) => l.mountpoint === "/mnt/media")).toBe(false);

    const foreign = fstabWithoutEntry(fstab, "/mnt/legacy");
    expect(foreign.removed).toBe(0);
    expect(foreign.blocked).toBe(1);
    expect(parseFstab(foreign.text).some((l) => l.mountpoint === "/mnt/legacy")).toBe(true);
  });

  it("never touches the root filesystem entry", () => {
    const next = fstabWithoutEntry(fstab, "/");
    expect(next.removed).toBe(0);
    expect(parseFstab(next.text).some((l) => l.mountpoint === "/")).toBe(true);
  });
});
