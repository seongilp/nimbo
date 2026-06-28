"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Cpu, Thermometer, Cloud, Search, LayoutGrid, Copy, Minus, X } from "lucide-react";

import { APP_MAP } from "./app-registry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePoll } from "@/lib/hooks/use-poll";
import { useTheme } from "@/lib/hooks/use-theme";
import { useWindowStore } from "@/lib/store/windows";
import type { SystemOverview } from "@/lib/types";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="w-32" />;
  return (
    <span className="text-xs font-medium tabular-nums">
      {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
      {"  "}
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export function MenuBar() {
  const { theme, toggle } = useTheme();
  const { focusedId, windows, togglePalette, tile, cascade, minimizeAll, closeAll } = useWindowStore();
  const { data: overview } = usePoll<SystemOverview>("/api/overview", 3000);

  const focused = windows.find((w) => w.id === focusedId && !w.minimized);
  const focusedApp = focused ? APP_MAP[focused.appId] : null;

  return (
    <div className="glass-bar no-select absolute inset-x-0 top-0 z-[9999] flex h-[30px] items-center justify-between border-b border-border/50 px-3 text-foreground/90">
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] font-semibold outline-none hover:bg-foreground/5">
            <Cloud className="size-4 fill-primary/20 text-primary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{overview?.hostname ?? "nas-server"}</span>
                <span className="text-xs font-normal text-muted-foreground">{overview?.distro ?? "Linux"}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs text-muted-foreground" disabled>
              Kernel {overview?.kernel ?? "—"}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">Shut Down…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-[13px] font-semibold">
          {focusedApp ? focusedApp.name : "Nimbo"}
        </span>

        {windows.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-md px-1.5 py-0.5 text-[13px] outline-none hover:bg-foreground/5">
              창
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onClick={() => tile({ width: window.innerWidth, height: window.innerHeight })}>
                <LayoutGrid className="size-4" /> 바둑판 배열
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => cascade({ width: window.innerWidth, height: window.innerHeight })}>
                <Copy className="size-4" /> 계단식 배열
              </DropdownMenuItem>
              <DropdownMenuItem onClick={minimizeAll}>
                <Minus className="size-4" /> 모두 최소화
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={closeAll}>
                <X className="size-4" /> 모두 닫기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-center gap-3">
        {overview && (
          <div className="hidden items-center gap-3 text-[11px] text-foreground/70 sm:flex">
            <span className="flex items-center gap-1">
              <Cpu className="size-3" />
              {overview.cpu.usagePercent.toFixed(0)}%
            </span>
            {overview.temperatureC != null && (
              <span className="flex items-center gap-1">
                <Thermometer className="size-3" />
                {overview.temperatureC}°C
              </span>
            )}
            {overview.isMock && <span className="rounded bg-foreground/10 px-1.5 py-px text-[10px]">demo</span>}
          </div>
        )}
        <button
          onClick={togglePalette}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-foreground/70 hover:bg-foreground/5"
          aria-label="Open command palette"
        >
          <Search className="size-3" />
          <kbd className="font-mono text-[10px]">⌘K</kbd>
        </button>
        <button
          onClick={toggle}
          className="flex size-5 items-center justify-center rounded-md hover:bg-foreground/5"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
        <Clock />
      </div>
    </div>
  );
}
