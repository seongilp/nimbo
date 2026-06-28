import type { DiskInfo, PartitionInfo } from "@/lib/types";
import { run, USE_MOCK } from "./exec";
import { mockDisks } from "./mock";

interface LsblkNode {
  name: string;
  type: string;
  size?: number;
  model?: string | null;
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

async function smartStatus(device: string): Promise<{ status: DiskInfo["smartStatus"]; tempC: number | null }> {
  const { stdout, code } = await run(`smartctl -H -A ${device} 2>/dev/null`);
  if (code !== 0 || !stdout) return { status: "unknown", tempC: null };
  const healthy = /SMART overall-health self-assessment test result:\s+PASSED/i.test(stdout) ||
    /SMART Health Status:\s+OK/i.test(stdout);
  const failed = /FAILED|FAILING_NOW/i.test(stdout);
  const tempMatch = stdout.match(/Temperature.*?(\d{1,3})\s*(?:Celsius|\(|$)/i) ||
    stdout.match(/Temperature_Celsius.*?(\d{1,3})\s*$/im);
  const tempC = tempMatch ? Number(tempMatch[1]) : null;
  return {
    status: failed ? "failed" : healthy ? "passed" : "warning",
    tempC: tempC && tempC > 0 && tempC < 120 ? tempC : null,
  };
}

export async function getDisks(): Promise<DiskInfo[]> {
  if (USE_MOCK) return mockDisks();
  const { stdout, code } = await run(
    "lsblk -J -b -o NAME,TYPE,SIZE,MODEL,ROTA,TRAN,MOUNTPOINT,FSTYPE,FSAVAIL,FSUSED,FSSIZE"
  );
  if (code !== 0) return mockDisks();
  let parsed: { blockdevices: LsblkNode[] };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return mockDisks();
  }
  const disks: DiskInfo[] = [];
  for (const node of parsed.blockdevices ?? []) {
    if (node.type !== "disk") continue;
    const device = "/dev/" + node.name;
    const smart = await smartStatus(device);
    disks.push({
      device,
      model: (node.model ?? "Unknown").trim() || "Unknown",
      sizeBytes: numOr(node.size, 0),
      type: classify(node),
      temperatureC: smart.tempC,
      smartStatus: smart.status,
      partitions: toPartitions(node),
    });
  }
  return disks.length ? disks : mockDisks();
}
