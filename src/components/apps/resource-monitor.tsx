"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Cpu, MemoryStick, Network, Thermometer } from "lucide-react";

import { RadialGauge } from "@/components/charts/radial-gauge";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBitsPerSec, formatBytes, formatUptime } from "@/lib/format";
import type { MemoryStat, ProcessInfo, SystemOverview } from "@/lib/types";

const MAX_HISTORY = 40;

// Guard against NaN / Infinity reaching the byte formatter.
function fmt(bytes: number): string {
  return formatBytes(Number.isFinite(bytes) ? bytes : 0);
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

export function ResourceMonitor() {
  const { data: overview } = usePoll<SystemOverview>("/api/overview", 2000);
  const { data: processes } = usePoll<ProcessInfo[]>("/api/processes", 3000);

  const cpuHistory = useHistory(overview?.cpu.usagePercent);
  const memPercent = overview ? (overview.memory.usedBytes / overview.memory.totalBytes) * 100 : 0;
  const memHistory = useHistory(Number(memPercent.toFixed(1)));
  const netHistory = useHistory(overview?.network.rxBytesPerSec);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        <Card className="flex items-center gap-3 p-4">
          <RadialGauge
            value={overview?.cpu.usagePercent ?? 0}
            size={92}
            stroke={9}
            color="var(--chart-1)"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Cpu className="size-4 text-muted-foreground" /> CPU
            </div>
            <p className="truncate text-xs text-muted-foreground" title={overview?.cpu.model}>
              {overview?.cpu.model ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground">{overview?.cpu.cores ?? 0} cores</p>
          </div>
        </Card>

        <Card className="flex items-center gap-3 p-4">
          <RadialGauge value={memPercent} size={92} stroke={9} color="var(--chart-2)" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <MemoryStick className="size-4 text-muted-foreground" /> Memory
            </div>
            <p className="text-xs text-muted-foreground">
              {overview ? fmt(overview.memory.usedBytes) : "—"} /{" "}
              {overview ? fmt(overview.memory.totalBytes) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Swap {overview ? fmt(overview.swap.usedBytes) : "—"}
            </p>
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Network className="size-4 text-muted-foreground" /> Network
            </div>
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-emerald-500">
              ↓ {overview ? formatBitsPerSec(overview.network.rxBytesPerSec) : "—"}
            </p>
            <p className="text-sm font-semibold text-sky-500">
              ↑ {overview ? formatBitsPerSec(overview.network.txBytesPerSec) : "—"}
            </p>
          </div>
          <Sparkline data={netHistory} height={28} color="var(--chart-2)" />
        </Card>

        <Card className="flex flex-col justify-between p-4">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Activity className="size-4 text-muted-foreground" /> System
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Load: {overview?.loadAvg.join("  ") ?? "—"}</p>
            <p>Uptime: {overview ? formatUptime(overview.uptimeSeconds) : "—"}</p>
            <p className="flex items-center gap-1">
              <Thermometer className="size-3" />
              {overview?.temperatureC != null ? `${overview.temperatureC}°C` : "n/a"}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 px-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">CPU usage</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {overview?.cpu.usagePercent.toFixed(0)}%
            </span>
          </div>
          <Sparkline data={cpuHistory} max={100} height={56} color="var(--chart-1)" />
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Memory usage</span>
            <span className="text-xs tabular-nums text-muted-foreground">{memPercent.toFixed(0)}%</span>
          </div>
          <Sparkline data={memHistory} max={100} height={56} color="var(--chart-2)" />
          {overview && (
            <div className="mt-3 border-t pt-3">
              <MemoryBreakdown memory={overview.memory} />
            </div>
          )}
        </Card>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Processes</span>
          <span className="text-xs text-muted-foreground">Top by CPU</span>
        </div>
        <Card className="min-h-0 flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">PID</th>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Command</th>
                  <th className="px-4 py-2 text-right font-medium">CPU%</th>
                  <th className="px-4 py-2 text-right font-medium">MEM%</th>
                </tr>
              </thead>
              <tbody>
                {(processes ?? []).map((p) => (
                  <tr key={p.pid} className="border-b border-border/50 last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-1.5 tabular-nums text-muted-foreground">{p.pid}</td>
                    <td className="px-4 py-1.5">
                      <Badge variant="secondary" className="font-normal">{p.user}</Badge>
                    </td>
                    <td className="max-w-0 truncate px-4 py-1.5 font-mono text-xs" title={p.command}>
                      {p.command}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{p.cpuPercent.toFixed(1)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">
                      {p.memPercent.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
