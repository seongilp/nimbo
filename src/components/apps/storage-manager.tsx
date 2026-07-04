"use client";

import { CheckCircle2, HardDrive, Cpu as Chip, AlertTriangle, XCircle, Thermometer, Database } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes } from "@/lib/format";
import type { DiskInfo, PartitionInfo, ZfsOverview } from "@/lib/types";

// Guard against NaN / Infinity reaching the formatter.
function fmt(bytes: number): string {
  return formatBytes(Number.isFinite(bytes) ? bytes : 0);
}

// A "real" filesystem is mounted at a non-empty path and is not swap.
function isRealMount(mp: PartitionInfo["mountpoint"]): mp is string {
  return typeof mp === "string" && mp.trim() !== "" && mp !== "[SWAP]";
}

// Summarize ONLY real mounted filesystems, deduped by mountpoint. This skips
// unmounted / ZFS-member partitions (mountpoint null) and never sums raw disk
// sizes, so the figure stays in a sane GB/TB range (never PB).
function summarizeMounted(disks: DiskInfo[] | null | undefined) {
  const byMount = new Map<string, { total: number; used: number }>();
  for (const disk of disks ?? []) {
    for (const part of disk.partitions) {
      if (!isRealMount(part.mountpoint) || byMount.has(part.mountpoint)) continue;
      byMount.set(part.mountpoint, {
        total: Number.isFinite(part.totalBytes) ? part.totalBytes : 0,
        used: Number.isFinite(part.usedBytes) ? part.usedBytes : 0,
      });
    }
  }
  let total = 0;
  let used = 0;
  for (const v of byMount.values()) {
    total += v.total;
    used += v.used;
  }
  return { total, used };
}

// Total usable storage = OS filesystems (from lsblk, mounted) + ZFS pools (from
// zpool). ZFS pools live on separate disks from the OS, so there's no double
// count; zpool SIZE/ALLOC already account for redundancy (mirror/raidz), so they
// are the right "usable" figures. Matches the dashboard's storage summary — the
// old Storage Manager summary counted ONLY mounted OS filesystems, so it hid the
// pools entirely (e.g. showed 772 GB when 12+ TB of pools existed).
function summarizeStorage(disks: DiskInfo[] | null | undefined, zfs: ZfsOverview | null | undefined) {
  const os = summarizeMounted(disks);
  let total = os.total;
  let used = os.used;
  for (const pool of zfs?.pools ?? []) {
    if (Number.isFinite(pool.sizeBytes)) total += pool.sizeBytes;
    if (Number.isFinite(pool.allocBytes)) used += pool.allocBytes;
  }
  return { total, used };
}

// Pool/array member partitions (ZFS/MD-RAID/LVM) expose NO filesystem usage to
// lsblk, so `fsused` is empty and the code falls back to "0% used / full free".
// That reads as "empty disk" when the space is actually claimed by the pool —
// misleading. For these, show the space as claimed by the pool instead; the
// real data usage lives in the ZFS app (per pool), not per raw member.
const POOL_MEMBER_LABEL: Record<string, string> = {
  zfs_member: "In use by ZFS pool",
  linux_raid_member: "In use by RAID array",
  LVM2_member: "LVM physical volume",
};
function poolMemberLabel(fs: string | null | undefined): string | null {
  return fs ? POOL_MEMBER_LABEL[fs] ?? null : null;
}

const SMART_BADGE = {
  passed: { label: "Healthy", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
  warning: { label: "Warning", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400", Icon: AlertTriangle },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-600 dark:text-red-400", Icon: XCircle },
  unknown: { label: "Unknown", className: "bg-muted text-muted-foreground", Icon: AlertTriangle },
} as const;

const TYPE_LABEL: Record<DiskInfo["type"], string> = {
  hdd: "HDD",
  ssd: "SSD",
  nvme: "NVMe",
  unknown: "Disk",
};

function usageColor(pct: number): string {
  if (pct >= 90) return "var(--chart-5)";
  if (pct >= 75) return "var(--chart-3)";
  return "var(--chart-1)";
}

function DiskCard({ disk }: { disk: DiskInfo }) {
  const smart = SMART_BADGE[disk.smartStatus];
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {disk.type === "nvme" ? <Chip className="size-5" /> : <HardDrive className="size-5" />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{disk.device}</span>
              <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[disk.type]}</Badge>
              {disk.zfsPool && (
                <>
                  <Badge variant="outline" className="border-sky-500/40 text-[10px] text-sky-400">ZFS</Badge>
                  <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                    <Database className="size-3" />
                    {disk.zfsPool}
                  </Badge>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{disk.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {disk.temperatureC != null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Thermometer className="size-3.5" />
              {disk.temperatureC}°C
            </span>
          )}
          <Badge className={`gap-1 border-0 font-medium ${smart.className}`}>
            <smart.Icon className="size-3.5" />
            {smart.label}
          </Badge>
          <span className="text-sm font-medium tabular-nums">{formatBytes(disk.sizeBytes)}</span>
        </div>
      </div>

      <div className="divide-y">
        {disk.partitions.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No mounted partitions.</p>
        )}
        {disk.partitions.map((part) => {
          const memberLabel = poolMemberLabel(part.filesystem);
          return (
            <div key={part.device} className="px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{part.device}</span>
                  <Badge variant="secondary" className="text-[10px] font-normal">{part.filesystem}</Badge>
                  {part.mountpoint && (
                    <span className="text-xs text-muted-foreground">→ {part.mountpoint}</span>
                  )}
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {memberLabel
                    ? formatBytes(part.totalBytes)
                    : `${formatBytes(part.usedBytes)} / ${formatBytes(part.totalBytes)}`}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={memberLabel ? "h-full rounded-full bg-muted-foreground/25" : "h-full rounded-full transition-all"}
                  style={memberLabel ? { width: "100%" } : { width: `${part.usePercent}%`, backgroundColor: usageColor(part.usePercent) }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                {memberLabel ? (
                  <span>{memberLabel}</span>
                ) : (
                  <>
                    <span>{part.usePercent}% used</span>
                    <span>{formatBytes(part.availBytes)} free</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function StorageManager() {
  const { data: disks, loading } = usePoll<DiskInfo[]>("/api/storage", 5000);
  // ZFS pools (admin-gated) so the summary reflects real usable capacity, not
  // just the OS disk. Non-admins get null here and fall back to the OS total.
  const { data: zfs } = usePoll<ZfsOverview>("/api/zfs", 5000);

  // Total = mounted OS filesystems (/, /home, …) PLUS ZFS pool capacity. Raw
  // disk sizes and ZFS member partitions are excluded, so it never shows the
  // doubled/raw figure.
  const { total: totalBytes, used: usedBytes } = summarizeStorage(disks, zfs);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="grid grid-cols-3 gap-3 p-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total capacity</p>
          <p className="text-xl font-semibold">{fmt(totalBytes)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Used</p>
          <p className="text-xl font-semibold">{fmt(usedBytes)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Drives</p>
          <p className="text-xl font-semibold">{disks?.length ?? 0}</p>
        </Card>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 px-4 pb-4">
          {loading && !disks
            ? Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
            : disks?.map((disk) => <DiskCard key={disk.device} disk={disk} />)}
        </div>
      </ScrollArea>
    </div>
  );
}
