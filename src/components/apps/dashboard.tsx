"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Box,
  Cog,
  Cpu,
  Database,
  HardDrive,
  KeyRound,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
  ServerCrash,
  ShieldCheck,
  Thermometer,
} from "lucide-react";

import { RadialGauge } from "@/components/charts/radial-gauge";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBitsPerSec, formatBytes, formatRelative, formatUptime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  BackupOverview,
  ContainerInfo,
  DiskInfo,
  MemoryStat,
  PartitionInfo,
  SecurityOverview,
  SystemAdminOverview,
  SystemOverview,
  ZfsOverview,
} from "@/lib/types";

const MAX_HISTORY = 40;

// Guard against NaN / Infinity reaching the byte formatter.
function fmt(bytes: number): string {
  return formatBytes(Number.isFinite(bytes) ? bytes : 0);
}

// A "real" filesystem is mounted at a non-empty path and is not swap.
function isRealMount(mp: PartitionInfo["mountpoint"]): mp is string {
  return typeof mp === "string" && mp.trim() !== "" && mp !== "[SWAP]";
}

// Summarize ONLY real mounted filesystems, deduped by mountpoint. Skips
// unmounted / ZFS-member partitions and never sums raw disk sizes, so the
// figure stays in a sane GB/TB range (never PB).
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

// Total usable storage = OS filesystems (from lsblk) + ZFS pools (from zpool).
// ZFS pools live on separate disks from the OS LVM, so there is no double-count.
// zpool SIZE/ALLOC already account for redundancy (mirror/raidz), so they are
// the right "usable" figures for a summary.
function summarizeStorage(
  disks: DiskInfo[] | null | undefined,
  zfs: ZfsOverview | null | undefined,
) {
  const os = summarizeMounted(disks);
  let total = os.total;
  let used = os.used;
  for (const pool of zfs?.pools ?? []) {
    if (Number.isFinite(pool.sizeBytes)) total += pool.sizeBytes;
    if (Number.isFinite(pool.allocBytes)) used += pool.allocBytes;
  }
  return { total, used };
}

// DSM-style memory breakdown: 앱 사용 / 버퍼·캐시 / 여유.
const MEM_APP_COLOR = "var(--chart-2)";
const MEM_CACHE_COLOR = "#f59e0b"; // amber — reclaimable

function MemoryBreakdown({ memory }: { memory: MemoryStat }) {
  const total = memory.totalBytes > 0 ? memory.totalBytes : 1;
  const app = memory.appUsedBytes ?? memory.usedBytes;
  const cache = memory.buffCacheBytes ?? 0;
  const free = memory.freeBytes ?? Math.max(0, total - app - cache);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full" style={{ width: pct(app), backgroundColor: MEM_APP_COLOR }} />
        <div className="h-full" style={{ width: pct(cache), backgroundColor: MEM_CACHE_COLOR }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ backgroundColor: MEM_APP_COLOR }} />
          앱 사용 {fmt(app)}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ backgroundColor: MEM_CACHE_COLOR }} />
          버퍼·캐시 {fmt(cache)}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-muted-foreground/40" />
          여유 {fmt(free)}
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground">버퍼·캐시는 필요 시 회수되는 메모리입니다.</p>
    </div>
  );
}

function useHistory(value: number | undefined): number[] {
  const [history, setHistory] = useState<number[]>([]);
  const last = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (value === undefined || value === last.current) return;
    last.current = value;
    setHistory((h) => [...h, value].slice(-MAX_HISTORY));
  }, [value]);
  return history;
}

// ---- shared widget chrome -------------------------------------------------

function WidgetTitle({
  icon: Icon,
  label,
  accent = "text-muted-foreground",
  children,
}: {
  icon: typeof Cpu;
  label: string;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className={cn("size-4", accent)} />
        {label}
      </div>
      {children}
    </div>
  );
}

function StatusRow({
  icon: Icon,
  label,
  ok,
  value,
  muted,
}: {
  icon: typeof Cpu;
  label: string;
  ok: boolean | null;
  value: string;
  muted?: boolean;
}) {
  const tone = muted
    ? "text-muted-foreground"
    : ok
      ? "text-emerald-500"
      : "text-red-500";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2">
        <Icon className={cn("size-4", tone)} />
        <span className="text-muted-foreground">{label}</span>
      </span>
      <span className={cn("font-medium tabular-nums", tone)}>{value}</span>
    </div>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}

const ZFS_HEALTH_TONE: Record<string, string> = {
  ONLINE: "text-emerald-500",
  DEGRADED: "text-amber-500",
  FAULTED: "text-red-500",
  OFFLINE: "text-muted-foreground",
  UNAVAIL: "text-red-500",
  REMOVED: "text-amber-500",
};

const SMART_RANK: Record<DiskInfo["smartStatus"], number> = {
  failed: 3,
  warning: 2,
  unknown: 1,
  passed: 0,
};

const SMART_LABEL: Record<DiskInfo["smartStatus"], string> = {
  passed: "정상",
  warning: "주의",
  failed: "실패",
  unknown: "알수없음",
};

// ---------------------------------------------------------------------------

export function Dashboard() {
  const {
    data: overview,
    error: overviewError,
    refresh: refreshOverview,
  } = usePoll<SystemOverview>("/api/overview", 3000);
  const { data: disks } = usePoll<DiskInfo[]>("/api/storage", 5000);
  const { data: zfs } = usePoll<ZfsOverview>("/api/zfs", 5000);
  const { data: containers } = usePoll<ContainerInfo[]>("/api/docker", 5000);
  const { data: backup } = usePoll<BackupOverview>("/api/backup", 5000);
  const { data: admin } = usePoll<SystemAdminOverview>("/api/system", 5000);
  const { data: security } = usePoll<SecurityOverview>("/api/security", 5000);

  const cpuHistory = useHistory(overview?.cpu.usagePercent);
  const memPercent = overview
    ? (overview.memory.usedBytes / overview.memory.totalBytes) * 100
    : 0;
  const netHistory = useHistory(overview?.network.rxBytesPerSec);

  // storage aggregation — real mounted filesystems (OS disks) PLUS ZFS pools.
  // lsblk can't see ZFS mountpoints, so the pools (the bulk of a NAS) must be
  // added from the zpool data; otherwise the widget only shows the OS disk.
  const storage = summarizeStorage(disks, zfs);
  const storagePercent = storage.total > 0 ? (storage.used / storage.total) * 100 : 0;
  const worstSmart =
    (disks ?? []).reduce<DiskInfo["smartStatus"]>((worst, d) => {
      return SMART_RANK[d.smartStatus] > SMART_RANK[worst] ? d.smartStatus : worst;
    }, "passed");

  // containers
  const running = (containers ?? []).filter((c) => c.state === "running");
  const topContainers = [...(containers ?? [])]
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, 4);

  // backup
  const jobs = backup?.jobs ?? [];
  const jobSuccess = jobs.filter((j) => j.lastStatus === "success").length;
  const jobFailed = jobs.filter((j) => j.lastStatus === "failed").length;
  const lastRun = jobs.reduce<number | null>((latest, j) => {
    if (j.lastRun == null) return latest;
    return latest == null || j.lastRun > latest ? j.lastRun : latest;
  }, null);

  // security
  const checks = security?.checks ?? [];
  const checksPassed = checks.filter((c) => c.passed).length;

  // services
  const services = admin?.services ?? [];
  const activeServices = services.filter((s) => s.active === "active").length;
  const failedServices = services.filter((s) => s.active === "failed");

  // The overview endpoint is the dashboard's core data source. If it has never
  // loaded and is currently erroring, the widgets can only show "—" forever — so
  // surface a real error state with a retry instead of a perpetual "연결 중…".
  if (!overview && overviewError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ServerCrash className="size-6" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">시스템 정보를 불러오지 못했습니다</p>
          <p className="max-w-xs text-xs text-muted-foreground">{overviewError}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={refreshOverview}>
          <RefreshCw className="size-3.5" /> 다시 시도
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3 xl:grid-cols-4">
          {/* 1. 시스템 */}
          <Card className="p-4">
            <WidgetTitle icon={Server} label="시스템" accent="text-sky-500">
              {overview?.isMock && (
                <Badge variant="secondary" className="text-[10px]">
                  demo
                </Badge>
              )}
            </WidgetTitle>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="truncate text-sm font-semibold text-foreground" title={overview?.hostname}>
                {overview?.hostname ?? "—"}
              </p>
              <p className="truncate" title={overview?.distro}>
                {overview?.distro ?? "—"}
              </p>
              <p>가동 {overview ? formatUptime(overview.uptimeSeconds) : "—"}</p>
              <p>부하 {overview?.loadAvg.map((n) => n.toFixed(2)).join("  ") ?? "—"}</p>
              <p className="flex items-center gap-1">
                <Thermometer className="size-3" />
                {overview?.temperatureC != null ? `${overview.temperatureC}°C` : "n/a"}
              </p>
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t pt-2 text-xs">
              <span
                className={cn(
                  "size-2 rounded-full",
                  overview ? "bg-emerald-500" : "bg-muted-foreground",
                )}
              />
              <span className="text-muted-foreground">
                {overview ? "온라인 · 정상 동작" : "연결 중…"}
              </span>
            </div>
          </Card>

          {/* 2. CPU */}
          <Card className="p-4">
            <WidgetTitle icon={Cpu} label="CPU" accent="text-[color:var(--chart-1)]" />
            <div className="flex items-center gap-3">
              <RadialGauge
                value={overview?.cpu.usagePercent ?? 0}
                size={84}
                stroke={8}
                color="var(--chart-1)"
              />
              <div className="min-w-0 text-xs text-muted-foreground">
                <p className="truncate" title={overview?.cpu.model}>
                  {overview?.cpu.model ?? "—"}
                </p>
                <p>{overview?.cpu.cores ?? "—"} 코어</p>
              </div>
            </div>
            <div className="mt-2">
              <Sparkline data={cpuHistory} max={100} height={32} color="var(--chart-1)" />
            </div>
          </Card>

          {/* 3. 메모리 */}
          <Card className="p-4">
            <WidgetTitle icon={MemoryStick} label="메모리" accent="text-[color:var(--chart-2)]" />
            <div className="flex items-center gap-3">
              <RadialGauge value={memPercent} size={84} stroke={8} color="var(--chart-2)" />
              <div className="min-w-0 text-xs text-muted-foreground">
                <p>
                  {overview ? fmt(overview.memory.usedBytes) : "—"} /{" "}
                  {overview ? fmt(overview.memory.totalBytes) : "—"}
                </p>
                <p>
                  Swap {overview ? fmt(overview.swap.usedBytes) : "—"} /{" "}
                  {overview ? fmt(overview.swap.totalBytes) : "—"}
                </p>
              </div>
            </div>
            {overview && (
              <div className="mt-3 border-t pt-2">
                <MemoryBreakdown memory={overview.memory} />
              </div>
            )}
          </Card>

          {/* 4. 네트워크 */}
          <Card className="p-4">
            <WidgetTitle icon={Network} label="네트워크" accent="text-emerald-500" />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-emerald-500">
                ↓ {overview ? formatBitsPerSec(overview.network.rxBytesPerSec) : "—"}
              </p>
              <p className="text-sm font-semibold text-sky-500">
                ↑ {overview ? formatBitsPerSec(overview.network.txBytesPerSec) : "—"}
              </p>
            </div>
            <div className="mt-2">
              <Sparkline data={netHistory} height={32} color="var(--chart-2)" />
            </div>
          </Card>

          {/* 5. 스토리지 */}
          <Card className="p-4">
            <WidgetTitle icon={HardDrive} label="스토리지" accent="text-violet-500">
              {disks && (
                <Badge variant="secondary" className="text-[10px]">
                  {disks.length}개 디스크
                </Badge>
              )}
            </WidgetTitle>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-sm font-semibold text-foreground">
                  {disks ? fmt(storage.used) : "—"}
                </span>
                <span className="text-muted-foreground">
                  / {disks ? fmt(storage.total) : "—"}
                </span>
              </div>
              <ProgressBar percent={storagePercent} color="var(--chart-4)" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{storagePercent.toFixed(0)}% 사용</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    worstSmart === "passed"
                      ? "text-emerald-500"
                      : worstSmart === "warning"
                        ? "text-amber-500"
                        : worstSmart === "failed"
                          ? "text-red-500"
                          : "text-muted-foreground",
                  )}
                >
                  SMART {disks ? SMART_LABEL[worstSmart] : "—"}
                </Badge>
              </div>
            </div>
          </Card>

          {/* 6. ZFS 풀 */}
          <Card className="p-4">
            <WidgetTitle icon={Database} label="ZFS 풀" accent="text-cyan-500">
              {zfs && (
                <Badge variant="secondary" className="text-[10px]">
                  {zfs.pools.length}개 풀
                </Badge>
              )}
            </WidgetTitle>
            <div className="space-y-2">
              {!zfs && <p className="text-xs text-muted-foreground">—</p>}
              {zfs && zfs.pools.length === 0 && (
                <p className="text-xs text-muted-foreground">풀이 없습니다.</p>
              )}
              {(zfs?.pools ?? []).slice(0, 3).map((pool) => {
                const scanning =
                  pool.scan.state === "scrubbing" || pool.scan.state === "resilvering";
                return (
                  <div key={pool.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            (ZFS_HEALTH_TONE[pool.health] ?? "text-muted-foreground").replace(
                              "text-",
                              "bg-",
                            ),
                          )}
                        />
                        {pool.name}
                      </span>
                      <span className="text-muted-foreground">{pool.capacityPercent}%</span>
                    </div>
                    <ProgressBar
                      percent={pool.capacityPercent}
                      color={
                        pool.health === "ONLINE" ? "var(--chart-1)" : "var(--destructive, #ef4444)"
                      }
                    />
                    {scanning && (
                      <p className="text-[10px] text-sky-500">
                        {pool.scan.state === "scrubbing" ? "스크럽" : "리실버"}{" "}
                        {pool.scan.progressPercent.toFixed(0)}%
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 7. 컨테이너 */}
          <Card className="p-4">
            <WidgetTitle icon={Box} label="컨테이너" accent="text-blue-500">
              {containers && (
                <Badge variant="secondary" className="text-[10px]">
                  {running.length}/{containers.length} 실행
                </Badge>
              )}
            </WidgetTitle>
            <div className="space-y-1.5">
              {!containers && <p className="text-xs text-muted-foreground">—</p>}
              {containers && containers.length === 0 && (
                <p className="text-xs text-muted-foreground">컨테이너가 없습니다.</p>
              )}
              {topContainers.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        c.state === "running" ? "bg-emerald-500" : "bg-muted-foreground",
                      )}
                    />
                    <span className="truncate" title={c.name}>
                      {c.name}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {c.cpuPercent.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* 8. 백업 */}
          <Card className="p-4">
            <WidgetTitle icon={Activity} label="백업" accent="text-amber-500" />
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="text-emerald-500">{jobSuccess} 성공</span>
                <span className="text-muted-foreground">/</span>
                <span className={jobFailed > 0 ? "text-red-500" : "text-muted-foreground"}>
                  {jobFailed} 실패
                </span>
              </div>
              <p className="text-muted-foreground">
                {backup ? `${jobs.length}개 작업` : "—"}
                {lastRun != null && ` · 마지막 ${formatRelative(lastRun)}`}
              </p>
              <div className="flex items-center gap-1.5 border-t pt-1.5">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    backup?.server.enabled ? "bg-emerald-500" : "bg-muted-foreground",
                  )}
                />
                <span className="text-muted-foreground">
                  rsync 서버 {backup ? (backup.server.enabled ? "켜짐" : "꺼짐") : "—"}
                </span>
              </div>
            </div>
          </Card>

          {/* 9. 보안 */}
          <Card className="p-4">
            <WidgetTitle icon={ShieldCheck} label="보안" accent="text-rose-500" />
            <div className="space-y-1.5">
              <StatusRow
                icon={ShieldCheck}
                label="방화벽"
                ok={security?.firewall.enabled ?? null}
                value={security ? (security.firewall.enabled ? "켜짐" : "꺼짐") : "—"}
                muted={!security}
              />
              <StatusRow
                icon={Activity}
                label="보안 점검"
                ok={security ? checksPassed === checks.length : null}
                value={security ? `${checksPassed}/${checks.length} 통과` : "—"}
                muted={!security}
              />
              <StatusRow
                icon={KeyRound}
                label="2단계 인증"
                ok={security?.twoFactor.enabled ?? null}
                value={security ? (security.twoFactor.enabled ? "켜짐" : "꺼짐") : "—"}
                muted={!security}
              />
            </div>
          </Card>

          {/* 10. 서비스 */}
          <Card className="p-4">
            <WidgetTitle icon={Cog} label="서비스" accent="text-teal-500">
              {admin && (
                <Badge variant="secondary" className="text-[10px]">
                  {activeServices}/{services.length} 활성
                </Badge>
              )}
            </WidgetTitle>
            <div className="space-y-1.5 text-xs">
              {!admin && <p className="text-muted-foreground">—</p>}
              {admin && failedServices.length === 0 && (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  모든 서비스 정상
                </p>
              )}
              {failedServices.map((s) => (
                <div key={s.name} className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-1.5 text-red-500">
                    <span className="size-2 shrink-0 rounded-full bg-red-500" />
                    <span className="truncate" title={s.name}>
                      {s.name}
                    </span>
                  </span>
                  <Badge variant="outline" className="text-[10px] text-red-500">
                    실패
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
