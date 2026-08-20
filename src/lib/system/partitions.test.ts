import { describe, expect, it } from "vitest";

import {
  buildMkfsArgs,
  confirmMatches,
  diskOfPartition,
  freeRegions,
  isDiskDevice,
  isPartitionDevice,
  normalizeFsLabel,
  partitionNumber,
  sfdiskAppendScript,
} from "./partitions";

describe("partitions — device path validation", () => {
  it("recognises whole disks", () => {
    expect(isDiskDevice("/dev/sda")).toBe(true);
    expect(isDiskDevice("/dev/nvme0n1")).toBe(true);
    expect(isDiskDevice("/dev/sda1")).toBe(false);
    expect(isDiskDevice("/dev/../etc/passwd")).toBe(false);
    expect(isDiskDevice("/dev/sda; wipefs -a /dev/sdb")).toBe(false);
  });

  it("recognises partitions and maps them back to their disk", () => {
    expect(isPartitionDevice("/dev/sda2")).toBe(true);
    expect(isPartitionDevice("/dev/nvme0n1p3")).toBe(true);
    expect(isPartitionDevice("/dev/sda")).toBe(false);
    expect(diskOfPartition("/dev/sda2")).toBe("/dev/sda");
    expect(diskOfPartition("/dev/nvme0n1p3")).toBe("/dev/nvme0n1");
    expect(diskOfPartition("/dev/sda")).toBeNull();
    expect(partitionNumber("/dev/nvme0n1p3")).toBe(3);
  });
});

describe("partitions — label validation", () => {
  it("accepts plain labels and rejects argv-hostile ones", () => {
    expect(normalizeFsLabel("Backup 2026")).toBe("Backup 2026");
    expect(normalizeFsLabel(undefined)).toBeUndefined();
    expect(normalizeFsLabel("")).toBeUndefined();
    expect(normalizeFsLabel("-F")).toBeNull();
    expect(normalizeFsLabel("a;b")).toBeNull();
    expect(normalizeFsLabel("x".repeat(64))).toBeNull();
  });
});

describe("partitions — free space computation", () => {
  const sector = 512;

  it("finds the tail gap after the last partition", () => {
    const gaps = freeRegions([{ startSector: 2048, sizeSectors: 4096 }], 2048, 20_479, sector);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].startSector).toBe(6144);
    expect(gaps[0].sizeSectors).toBe(20_479 - 6144 + 1);
  });

  it("finds a gap between two partitions", () => {
    const gaps = freeRegions(
      [
        { startSector: 2048, sizeSectors: 2048 },
        { startSector: 20_480, sizeSectors: 2048 },
      ],
      2048,
      40_959,
      sector
    );
    expect(gaps.map((g) => g.startSector)).toEqual([4096, 22_528]);
  });

  it("ignores gaps smaller than 1 MiB", () => {
    // 512 sectors * 512 B = 256 KiB — too small to be offered as usable space.
    const gaps = freeRegions(
      [
        { startSector: 2048, sizeSectors: 2048 },
        { startSector: 4608, sizeSectors: 2048 },
      ],
      2048,
      6655,
      sector
    );
    expect(gaps).toHaveLength(0);
  });

  it("reports the whole disk as free when there are no partitions", () => {
    const gaps = freeRegions([], 2048, 1_000_000, sector);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].sizeBytes).toBe((1_000_000 - 2048 + 1) * sector);
  });
});

describe("partitions — sfdisk / mkfs argv", () => {
  it("emits a sized append script, or an open-ended one for the rest of the disk", () => {
    expect(sfdiskAppendScript(512)).toBe(",512M,L\n");
    expect(sfdiskAppendScript(undefined)).toBe(",,L\n");
    expect(sfdiskAppendScript(0)).toBe(",,L\n");
  });

  it("builds the right mkfs invocation per filesystem", () => {
    expect(buildMkfsArgs("ext4", "/dev/sdb1", "data")).toEqual({
      bin: "mkfs.ext4",
      args: ["-F", "-L", "data", "/dev/sdb1"],
    });
    expect(buildMkfsArgs("vfat", "/dev/sdb1")).toEqual({ bin: "mkfs.vfat", args: ["-F", "32", "/dev/sdb1"] });
    expect(buildMkfsArgs("btrfs", "/dev/sdb1", "pool")).toEqual({
      bin: "mkfs.btrfs",
      args: ["-f", "-L", "pool", "/dev/sdb1"],
    });
    expect(buildMkfsArgs("zfs", "/dev/sdb1")).toBeNull();
  });
});

describe("partitions — destructive actions require an exact confirmation", () => {
  // Tested through the pure gate rather than runPartitionAction(): the action
  // path branches on USE_MOCK, so asserting on it would pass on a dev Mac and
  // fail on Linux CI — and a "successful" run there would touch a real disk.
  it("accepts only the exact device path, ignoring surrounding whitespace", () => {
    expect(confirmMatches("/dev/sdb", "/dev/sdb")).toBe(true);
    expect(confirmMatches("/dev/sdb", "  /dev/sdb  ")).toBe(true);
  });

  it("rejects a near-miss, a different disk, and non-string input", () => {
    expect(confirmMatches("/dev/sdb", "yes")).toBe(false);
    expect(confirmMatches("/dev/sdb", "/dev/sdc")).toBe(false);
    expect(confirmMatches("/dev/sdb", "/dev/sdb1")).toBe(false);
    expect(confirmMatches("/dev/sdb", "")).toBe(false);
    expect(confirmMatches("/dev/sdb", undefined)).toBe(false);
    expect(confirmMatches("/dev/sdb", true)).toBe(false);
  });
});
