"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownUp, Cpu, X } from "lucide-react";

import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes, formatUptime } from "@/lib/format";
import { useWidgetStore, type WidgetInstance, type WidgetType } from "@/lib/store/widgets";
import type { SystemOverview } from "@/lib/types";

function Gauge({ label, pct, accent }: { label: string; pct: number; accent: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full bg-gradient-to-r ${accent}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

function ClockBody() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Filled in on mount so SSR renders a stable "--:--" (avoids hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="w-40 text-center">
      <div className="text-3xl font-bold tabular-nums">
        {now ? now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "--:--"}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {now ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : ""}
      </div>
    </div>
  );
}

function SystemBody({ ov }: { ov: SystemOverview | null }) {
  const cpu = Math.round(ov?.cpu.usagePercent ?? 0);
  const memPct = ov && ov.memory.totalBytes ? Math.round((ov.memory.usedBytes / ov.memory.totalBytes) * 100) : 0;
  return (
    <div className="w-44 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold"><Cpu className="size-3.5" /> 시스템</div>
      <Gauge label="CPU" pct={cpu} accent="from-sky-400 to-blue-600" />
      <Gauge label="MEM" pct={memPct} accent="from-violet-400 to-purple-600" />
      {ov?.temperatureC != null && <div className="text-[11px] text-muted-foreground">온도 {ov.temperatureC}°C</div>}
    </div>
  );
}

function UptimeBody({ ov }: { ov: SystemOverview | null }) {
  return (
    <div className="w-40 space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold"><Activity className="size-3.5" /> 가동시간</div>
      <div className="text-lg font-semibold">{ov ? formatUptime(ov.uptimeSeconds) : "—"}</div>
      <div className="text-[11px] text-muted-foreground">부하 {ov ? ov.loadAvg.map((l) => l.toFixed(2)).join(" · ") : "—"}</div>
    </div>
  );
}

function NetworkBody({ ov }: { ov: SystemOverview | null }) {
  return (
    <div className="w-40 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold"><ArrowDownUp className="size-3.5" /> 네트워크</div>
      <div className="flex items-center justify-between text-xs"><span className="text-emerald-400">↓ 수신</span><span className="tabular-nums">{ov ? formatBytes(ov.network.rxBytesPerSec) + "/s" : "—"}</span></div>
      <div className="flex items-center justify-between text-xs"><span className="text-sky-400">↑ 송신</span><span className="tabular-nums">{ov ? formatBytes(ov.network.txBytesPerSec) + "/s" : "—"}</span></div>
    </div>
  );
}

function body(type: WidgetType, ov: SystemOverview | null) {
  switch (type) {
    case "clock": return <ClockBody />;
    case "system": return <SystemBody ov={ov} />;
    case "uptime": return <UptimeBody ov={ov} />;
    case "network": return <NetworkBody ov={ov} />;
  }
}

interface DragState { sx: number; sy: number; ox: number; oy: number; nx?: number; ny?: number }

function WidgetShell({ w, onMove, onRemove, children }: {
  w: WidgetInstance;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  function down(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("[data-widget-remove]")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !ref.current) return;
    d.nx = Math.max(0, d.ox + (e.clientX - d.sx));
    d.ny = Math.max(44, d.oy + (e.clientY - d.sy));
    ref.current.style.left = `${d.nx}px`;
    ref.current.style.top = `${d.ny}px`;
  }
  function up(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d && d.nx != null && d.ny != null) onMove(w.id, d.nx, d.ny);
  }

  return (
    <div
      ref={ref}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      style={{ left: w.x, top: w.y }}
      className="group glass shadow-window pointer-events-auto absolute z-[5] cursor-grab rounded-2xl border border-white/10 p-3.5 text-foreground active:cursor-grabbing"
    >
      <button
        data-widget-remove
        onClick={() => onRemove(w.id)}
        aria-label="위젯 제거"
        className="absolute -right-2 -top-2 hidden size-5 items-center justify-center rounded-full bg-foreground text-background shadow-soft group-hover:flex pointer-coarse:flex"
      >
        <X className="size-3" />
      </button>
      {children}
    </div>
  );
}

export function DesktopWidgets() {
  const widgets = useWidgetStore((s) => s.widgets);
  const move = useWidgetStore((s) => s.move);
  const remove = useWidgetStore((s) => s.remove);
  const load = useWidgetStore((s) => s.load);
  useEffect(() => load(), [load]);
  const { data: ov } = usePoll<SystemOverview>("/api/overview", 3000);

  if (!widgets.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {widgets.map((w) => (
        <WidgetShell key={w.id} w={w} onMove={move} onRemove={remove}>
          {body(w.type, ov)}
        </WidgetShell>
      ))}
    </div>
  );
}
