"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Cpu, Thermometer, Cloud, Search, LayoutGrid, Copy, Minus, X, LogOut, Star } from "lucide-react";

import { APP_MAP, APPS } from "./app-registry";
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
import { useFavoritesStore } from "@/lib/store/favorites";
import { useWallpaperStore } from "@/lib/store/wallpaper";
import { WALLPAPERS } from "@/lib/wallpapers";
import { cn } from "@/lib/utils";
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
  const { focusedId, windows, open, taskbarClick, togglePalette, tile, cascade, minimizeAll, closeAll } = useWindowStore();
  const favoriteIds = useFavoritesStore((s) => s.ids);
  const toggleFavorite = useFavoritesStore((s) => s.toggle);
  const wallpaperId = useWallpaperStore((s) => s.id);
  const setWallpaper = useWallpaperStore((s) => s.setWallpaper);
  const { data: overview } = usePoll<SystemOverview>("/api/overview", 3000);

  function activate(appId: string) {
    const existing = windows.find((w) => w.appId === appId);
    const app = APP_MAP[appId];
    if (existing) taskbarClick(existing.id);
    else open(appId, { title: app.name, width: app.width, height: app.height });
  }
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => j.ok && setUser(j.user)).catch(() => {});
  }, []);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const focused = windows.find((w) => w.id === focusedId && !w.minimized);
  const focusedApp = focused ? APP_MAP[focused.appId] : null;

  return (
    <div className="glass-bar no-select absolute inset-x-0 top-0 z-[9999] flex h-10 items-center justify-between border-b border-border/50 px-4 text-foreground/90">
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Nimbo 메뉴"
            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-semibold outline-none hover:bg-foreground/5"
          >
            <Cloud className="size-5 fill-primary/20 text-primary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[82vh] w-72 overflow-y-auto text-sm">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{overview?.hostname ?? "nas-server"}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {overview?.distro ?? "Linux"}
                  {user ? ` · ${user}` : ""}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              앱
            </DropdownMenuLabel>
            {APPS.map((app) => {
              const fav = favoriteIds.includes(app.id);
              return (
                <div key={app.id} className="flex items-center gap-0.5 pr-1">
                  <DropdownMenuItem className="flex-1 py-1.5" onClick={() => activate(app.id)}>
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-[26%] text-white ring-1 ring-white/10",
                        app.color
                      )}
                    >
                      <app.icon className="size-3.5" />
                    </span>
                    <span className="truncate">{app.name}</span>
                  </DropdownMenuItem>
                  <button
                    aria-label={fav ? `${app.name} 즐겨찾기 해제` : `${app.name} 즐겨찾기`}
                    title={fav ? "Dock에서 제거" : "Dock에 추가"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleFavorite(app.id);
                    }}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-foreground/10"
                  >
                    <Star
                      className={cn(
                        "size-4 transition-colors",
                        fav ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50"
                      )}
                    />
                  </button>
                </div>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              배경화면
            </DropdownMenuLabel>
            <div className="grid grid-cols-4 gap-1.5 px-2 pb-2">
              {WALLPAPERS.map((w) => (
                <button
                  key={w.id}
                  aria-label={`배경화면: ${w.label}`}
                  title={w.label}
                  onClick={(e) => {
                    e.preventDefault();
                    setWallpaper(w.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    "h-9 rounded-md ring-1 transition-all",
                    wallpaperId === w.id
                      ? "ring-2 ring-primary ring-offset-1 ring-offset-popover"
                      : "ring-white/10 hover:ring-white/40"
                  )}
                  style={{ background: w.swatch }}
                />
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut className="size-4" /> 로그아웃
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="text-sm font-semibold">
          {focusedApp ? focusedApp.name : "Nimbo"}
        </span>

        {windows.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-md px-1.5 py-0.5 text-sm outline-none hover:bg-foreground/5">
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
          <div className="hidden items-center gap-3 text-xs text-foreground/70 sm:flex">
            <span className="flex items-center gap-1">
              <Cpu className="size-3.5" />
              {overview.cpu.usagePercent.toFixed(0)}%
            </span>
            {overview.temperatureC != null && (
              <span className="flex items-center gap-1">
                <Thermometer className="size-3.5" />
                {overview.temperatureC}°C
              </span>
            )}
            {overview.isMock && <span className="rounded bg-foreground/10 px-1.5 py-px text-[11px]">demo</span>}
          </div>
        )}
        <button
          onClick={togglePalette}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-foreground/70 hover:bg-foreground/5"
          aria-label="명령 팔레트 열기"
        >
          <Search className="size-3.5" />
          <kbd className="font-mono text-[11px]">⌘K</kbd>
        </button>
        <button
          onClick={toggle}
          className="flex size-6 items-center justify-center rounded-md hover:bg-foreground/5"
          aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <Clock />
      </div>
    </div>
  );
}
