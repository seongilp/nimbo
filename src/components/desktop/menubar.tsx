"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun, Cpu, Thermometer, Cloud, Search, LayoutGrid, Copy, Minus, X, LogOut, Star, ImagePlus } from "lucide-react";

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
import { useWidgetStore, type WidgetType } from "@/lib/store/widgets";
import { WALLPAPERS } from "@/lib/wallpapers";

const WIDGET_ADD: { type: WidgetType; label: string }[] = [
  { type: "clock", label: "시계" },
  { type: "system", label: "시스템" },
  { type: "uptime", label: "가동시간" },
  { type: "network", label: "네트워크" },
];
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
  const customImage = useWallpaperStore((s) => s.customImage);
  const setCustomImage = useWallpaperStore((s) => s.setCustomImage);
  const addWidget = useWidgetStore((s) => s.add);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: overview } = usePoll<SystemOverview>("/api/overview", 3000);

  // Read an uploaded image, downscale it (<=1920px, JPEG) to fit localStorage,
  // and set it as the wallpaper. Client-only — works in the demo too.
  function onWallpaperFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1920;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        try {
          setCustomImage(canvas.toDataURL("image/jpeg", 0.85));
        } catch {
          /* ignore */
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

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
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onWallpaperFile} />
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
              {customImage && (
                <button
                  aria-label="배경화면: 내 이미지"
                  title="내 이미지"
                  onClick={(e) => { e.preventDefault(); setWallpaper("custom"); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    "h-9 rounded-md bg-cover bg-center ring-1 transition-all",
                    wallpaperId === "custom" ? "ring-2 ring-primary ring-offset-1 ring-offset-popover" : "ring-white/10 hover:ring-white/40"
                  )}
                  style={{ backgroundImage: `url("${customImage}")` }}
                />
              )}
              <button
                aria-label="배경화면 이미지 업로드"
                title="이미지 업로드"
                onClick={(e) => { e.preventDefault(); fileRef.current?.click(); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex h-9 items-center justify-center rounded-md border border-dashed border-white/20 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <ImagePlus className="size-4" />
              </button>
            </div>
            {customImage && (
              <button
                onClick={(e) => { e.preventDefault(); setCustomImage(null); setWallpaper("default"); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="mx-2 mb-1 text-[11px] text-muted-foreground hover:text-destructive"
              >
                내 이미지 제거
              </button>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              위젯 추가
            </DropdownMenuLabel>
            <div className="flex flex-wrap gap-1.5 px-2 pb-2">
              {WIDGET_ADD.map((w) => (
                <button
                  key={w.type}
                  onClick={(e) => { e.preventDefault(); addWidget(w.type); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="rounded-md border border-white/10 bg-card/60 px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  + {w.label}
                </button>
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
