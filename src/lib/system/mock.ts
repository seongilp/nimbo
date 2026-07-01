import type {
  ContainerInfo,
  DirListing,
  DiskInfo,
  FileEntry,
  ProcessInfo,
  ShareInfo,
  SystemOverview,
} from "@/lib/types";

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

// Smoothly varying pseudo-random value seeded by time so the dashboards feel alive.
function wave(period: number, offset = 0): number {
  const t = Date.now() / 1000;
  return (Math.sin((t / period) * Math.PI * 2 + offset) + 1) / 2; // 0..1
}

export function mockOverview(): SystemOverview {
  const cpuUsage = 12 + wave(7) * 55 + wave(2.3, 1) * 12;
  const memTotal = 32 * GiB;
  const memUsed = memTotal * (0.42 + wave(23) * 0.18);
  const swapTotal = 8 * GiB;
  return {
    hostname: "nas-server",
    platform: "linux",
    distro: "Debian GNU/Linux 12 (bookworm)",
    kernel: "6.1.0-18-amd64",
    uptimeSeconds: 1_268_400 + Math.floor(Date.now() / 1000) % 100000,
    loadAvg: [
      Number((0.6 + wave(11) * 1.4).toFixed(2)),
      Number((0.8 + wave(31) * 1.1).toFixed(2)),
      Number((0.9 + wave(61) * 0.8).toFixed(2)),
    ],
    cpu: {
      model: "Intel(R) Celeron(R) J4125 @ 2.00GHz",
      cores: 4,
      usagePercent: Number(cpuUsage.toFixed(1)),
    },
    memory: {
      totalBytes: memTotal,
      usedBytes: Math.floor(memUsed),
      freeBytes: Math.floor(memTotal - memUsed),
    },
    swap: {
      totalBytes: swapTotal,
      usedBytes: Math.floor(swapTotal * 0.08),
      freeBytes: Math.floor(swapTotal * 0.92),
    },
    network: {
      rxBytesPerSec: Math.floor((4 + wave(3) * 40) * 1024 * 1024 / 8),
      txBytesPerSec: Math.floor((1 + wave(5, 2) * 12) * 1024 * 1024 / 8),
      interfaces: [
        { name: "eth0", rxBytes: 84_213_993_472, txBytes: 21_334_887_104 },
        { name: "docker0", rxBytes: 1_203_993_472, txBytes: 992_887_104 },
      ],
    },
    temperatureC: Number((44 + wave(17) * 10).toFixed(1)),
    isMock: true,
  };
}

export function mockProcesses(): ProcessInfo[] {
  const base: Omit<ProcessInfo, "cpuPercent" | "memPercent">[] = [
    { pid: 1287, user: "root", command: "/usr/bin/dockerd" },
    { pid: 2043, user: "plex", command: "Plex Media Server" },
    { pid: 991, user: "root", command: "smbd -D" },
    { pid: 3120, user: "root", command: "node /app/server.js" },
    { pid: 415, user: "root", command: "[kworker/u8:2]" },
    { pid: 1840, user: "postgres", command: "postgres: writer process" },
    { pid: 2298, user: "root", command: "qbittorrent-nox" },
    { pid: 770, user: "root", command: "/usr/sbin/sshd -D" },
  ];
  return base
    .map((p, i) => ({
      ...p,
      cpuPercent: Number((wave(3 + i) * (i === 1 ? 60 : 18)).toFixed(1)),
      memPercent: Number((1 + wave(20 + i) * (i === 1 ? 22 : 8)).toFixed(1)),
    }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent);
}

export function mockDisks(): DiskInfo[] {
  // Aligned to the mock ZFS pools (zfs.ts) so the inventory join is visible in
  // the demo: sda/sdb are healthy `tank` members; sdc is the FAULTED mirror
  // member (ata-WDC_WD40EFRX-B) — the star of the fault + replacement demo.
  return [
    {
      device: "/dev/sda",
      model: "WDC WD60EFRX-68L0BN1",
      sizeBytes: 6 * TiB,
      type: "hdd",
      temperatureC: 39,
      smartStatus: "passed",
      partitions: [],
      stableId: "wwn:0x50014ee2b0d60001",
      serial: "WD-WX11D60EFRX001",
      wwn: "0x50014ee2b0d60001",
      byId: "/dev/disk/by-id/ata-WDC_WD60EFRX-001",
      transport: "sata",
      firmware: "82.00A82",
      rotationRpm: 5400,
      hctl: "0:0:0:0",
      byPath: "/dev/disk/by-path/pci-0000:00:17.0-ata-1",
      powerOnHours: 14210,
      reallocatedSectors: 0,
      pendingSectors: 0,
    },
    {
      device: "/dev/sdb",
      model: "WDC WD60EFRX-68L0BN1",
      sizeBytes: 6 * TiB,
      type: "hdd",
      temperatureC: 41,
      smartStatus: "passed",
      partitions: [],
      stableId: "wwn:0x50014ee2b0d60002",
      serial: "WD-WX11D60EFRX002",
      wwn: "0x50014ee2b0d60002",
      byId: "/dev/disk/by-id/ata-WDC_WD60EFRX-002",
      transport: "sata",
      firmware: "82.00A82",
      rotationRpm: 5400,
      hctl: "1:0:0:0",
      byPath: "/dev/disk/by-path/pci-0000:00:17.0-ata-2",
      powerOnHours: 14183,
      reallocatedSectors: 0,
      pendingSectors: 0,
    },
    {
      device: "/dev/sdc",
      model: "WDC WD40EFRX-68N32N0",
      sizeBytes: 4 * TiB,
      type: "hdd",
      temperatureC: 48,
      smartStatus: "failed",
      partitions: [],
      stableId: "wwn:0x50014ee2b0d40b0b",
      serial: "WD-WX41D40EFRXB0B",
      wwn: "0x50014ee2b0d40b0b",
      byId: "/dev/disk/by-id/ata-WDC_WD40EFRX-B",
      transport: "sata",
      firmware: "82.00A82",
      rotationRpm: 5400,
      hctl: "2:0:0:0",
      byPath: "/dev/disk/by-path/pci-0000:00:17.0-ata-3",
      powerOnHours: 38914,
      reallocatedSectors: 120,
      pendingSectors: 8,
    },
    {
      device: "/dev/nvme0n1",
      model: "Samsung SSD 980 250GB",
      sizeBytes: 250 * GiB,
      type: "nvme",
      temperatureC: 46,
      smartStatus: "warning",
      partitions: [
        {
          device: "/dev/nvme0n1p1",
          mountpoint: "/",
          filesystem: "ext4",
          totalBytes: 250 * GiB,
          usedBytes: 88 * GiB,
          availBytes: 162 * GiB,
          usePercent: 35,
        },
      ],
      stableId: "wwn:eui.0025385991b0aa11",
      serial: "S6P1NF0R901234",
      wwn: "eui.0025385991b0aa11",
      byId: "/dev/disk/by-id/nvme-Samsung_SSD_980_250GB_S6P1NF0R901234",
      transport: "nvme",
      firmware: "1B4QFXO7",
      rotationRpm: 0,
      hctl: null,
      byPath: "/dev/disk/by-path/pci-0000:02:00.0-nvme-1",
      powerOnHours: 8231,
      reallocatedSectors: null,
      pendingSectors: null,
    },
  ];
}

interface MockNode {
  type: "file" | "directory";
  size?: number;
  modified?: number;
  children?: Record<string, MockNode>;
}

const now = Date.now();
const day = 86_400_000;

const MOCK_FS: MockNode = {
  type: "directory",
  children: {
    volume1: {
      type: "directory",
      children: {
        Movies: {
          type: "directory",
          children: {
            "Dune.Part.Two.2024.2160p.mkv": { type: "file", size: 28 * GiB, modified: now - 12 * day },
            "Interstellar.2014.1080p.mkv": { type: "file", size: 9.4 * GiB, modified: now - 220 * day },
            "Oppenheimer.2023.2160p.mkv": { type: "file", size: 31 * GiB, modified: now - 40 * day },
          },
        },
        Photos: {
          type: "directory",
          children: {
            "2024-Japan": { type: "directory", children: { "IMG_0421.jpg": { type: "file", size: 4_200_000 } } },
            "2023-Family": { type: "directory", children: {} },
          },
        },
        Backups: {
          type: "directory",
          children: {
            "laptop-2026-06-26.tar.zst": { type: "file", size: 142 * GiB, modified: now - 1 * day },
            "photos-archive.tar.zst": { type: "file", size: 88 * GiB, modified: now - 7 * day },
          },
        },
        Documents: {
          type: "directory",
          children: {
            "taxes-2025.pdf": { type: "file", size: 2_400_000, modified: now - 90 * day },
            "resume.docx": { type: "file", size: 84_000, modified: now - 5 * day },
            "notes.md": { type: "file", size: 12_400, modified: now - 1 * day },
          },
        },
      },
    },
    volume2: {
      type: "directory",
      children: {
        Downloads: {
          type: "directory",
          children: {
            "ubuntu-24.04.iso": { type: "file", size: 5.7 * GiB, modified: now - 3 * day },
          },
        },
        Media: { type: "directory", children: {} },
      },
    },
  },
};

function resolve(path: string): MockNode | null {
  const parts = path.split("/").filter(Boolean);
  let node: MockNode = MOCK_FS;
  for (const part of parts) {
    if (node.type !== "directory" || !node.children?.[part]) return null;
    node = node.children[part];
  }
  return node;
}

export function mockListing(path: string): DirListing {
  const clean = "/" + path.split("/").filter(Boolean).join("/");
  const node = resolve(clean) ?? MOCK_FS;
  const entries: FileEntry[] = Object.entries(node.children ?? {}).map(([name, child]) => ({
    name,
    path: (clean === "/" ? "" : clean) + "/" + name,
    type: child.type,
    sizeBytes: child.size ?? 0,
    modified: child.modified ?? now - 30 * day,
    permissions: child.type === "directory" ? "drwxr-xr-x" : "-rw-r--r--",
    owner: "admin",
  }));
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const parent = clean === "/" ? null : "/" + clean.split("/").filter(Boolean).slice(0, -1).join("/");
  return { path: clean, parent, entries, isMock: true };
}

export function mockShares(): ShareInfo[] {
  return [
    { name: "Movies", path: "/volume1/Movies", protocol: "smb", readOnly: false, guestOk: false, enabled: true },
    { name: "Photos", path: "/volume1/Photos", protocol: "smb", readOnly: false, guestOk: false, enabled: true },
    { name: "Backups", path: "/volume1/Backups", protocol: "smb", readOnly: true, guestOk: false, enabled: true },
    { name: "Public", path: "/volume2/Media", protocol: "smb", readOnly: false, guestOk: true, enabled: true },
    { name: "nfs-media", path: "/volume2/Media", protocol: "nfs", readOnly: false, guestOk: false, enabled: false },
  ];
}

export function mockContainers(): ContainerInfo[] {
  const defs: Omit<ContainerInfo, "cpuPercent" | "memUsageBytes">[] = [
    { id: "a1b2c3d4e5f6", name: "plex", image: "plexinc/pms-docker:latest", state: "running", status: "Up 8 days", ports: ["32400:32400"], memLimitBytes: 4 * GiB, createdAt: now - 60 * day },
    { id: "b2c3d4e5f6a7", name: "qbittorrent", image: "linuxserver/qbittorrent:latest", state: "running", status: "Up 8 days", ports: ["8080:8080", "6881:6881"], memLimitBytes: 2 * GiB, createdAt: now - 60 * day },
    { id: "c3d4e5f6a7b8", name: "postgres", image: "postgres:16-alpine", state: "running", status: "Up 12 days (healthy)", ports: ["5432:5432"], memLimitBytes: 2 * GiB, createdAt: now - 90 * day },
    { id: "d4e5f6a7b8c9", name: "nginx-proxy", image: "nginxproxy/nginx-proxy:latest", state: "running", status: "Up 12 days", ports: ["80:80", "443:443"], memLimitBytes: 512 * 1024 * 1024, createdAt: now - 90 * day },
    { id: "e5f6a7b8c9d0", name: "watchtower", image: "containrrr/watchtower:latest", state: "exited", status: "Exited (0) 3 hours ago", ports: [], memLimitBytes: 256 * 1024 * 1024, createdAt: now - 30 * day },
    { id: "f6a7b8c9d0e1", name: "homeassistant", image: "ghcr.io/home-assistant/home-assistant:stable", state: "running", status: "Up 2 days", ports: ["8123:8123"], memLimitBytes: 1 * GiB, createdAt: now - 14 * day },
  ];
  return defs.map((c, i) => ({
    ...c,
    cpuPercent: c.state === "running" ? Number((wave(4 + i) * (c.name === "plex" ? 40 : 12)).toFixed(1)) : 0,
    memUsageBytes: c.state === "running" ? Math.floor(c.memLimitBytes * (0.2 + wave(10 + i) * 0.5)) : 0,
  }));
}
