"use client";

import { useState } from "react";

import { APPS } from "./app-registry";
import { useWindowStore } from "@/lib/store/windows";
import { useFavoritesStore } from "@/lib/store/favorites";
import { cn } from "@/lib/utils";

export function Dock() {
  const { windows, open, taskbarClick } = useWindowStore();
  const favoriteIds = useFavoritesStore((s) => s.ids);
  const [hovered, setHovered] = useState<string | null>(null);

  const openIds = new Set(windows.map((w) => w.appId));

  // Dock = favorites (in registry order) + any running app that isn't a
  // favorite, so an open window is always one click away from the dock.
  const favoriteSet = new Set(favoriteIds);
  const favoriteApps = APPS.filter((a) => favoriteSet.has(a.id));
  const runningExtras = APPS.filter((a) => !favoriteSet.has(a.id) && openIds.has(a.id));
  const dockApps = favoriteApps;

  function activate(appId: string) {
    const existing = windows.find((w) => w.appId === appId);
    const app = APPS.find((a) => a.id === appId)!;
    if (existing) {
      taskbarClick(existing.id);
    } else {
      open(appId, { title: app.name, width: app.width, height: app.height });
    }
  }

  const renderIcon = (app: (typeof APPS)[number]) => {
    const isOpen = openIds.has(app.id);
    const isHovered = hovered === app.id;
    return (
      <div key={app.id} className="relative flex flex-col items-center">
        {/* Tooltip */}
        <div
          className={cn(
            "absolute -top-9 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-all",
            isHovered ? "scale-100 opacity-100" : "scale-90 opacity-0"
          )}
        >
          {app.name}
        </div>

        <button
          onMouseEnter={() => setHovered(app.id)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => activate(app.id)}
          className={cn(
            "animate-dock-pop shadow-icon flex shrink-0 items-center justify-center rounded-[28%] text-white ring-1 ring-white/10 transition-all duration-200 ease-out",
            app.color,
            isHovered ? "size-14 -translate-y-2" : "size-12"
          )}
          style={{ transformOrigin: "bottom center" }}
        >
          <app.icon className={cn("transition-all", isHovered ? "size-7" : "size-6")} />
        </button>

        {/* Running indicator */}
        <span
          className={cn(
            "mt-1 size-1 rounded-full transition-colors",
            isOpen ? "bg-foreground/70" : "bg-transparent"
          )}
        />
      </div>
    );
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[9998] flex justify-center">
      <div className="glass shadow-dock no-scrollbar pointer-events-auto flex max-w-[94vw] items-end gap-1.5 overflow-x-auto rounded-[22px] border border-black/5 px-3 py-2.5 dark:border-white/10">
        {dockApps.map(renderIcon)}
        {runningExtras.length > 0 && (
          <div className="mx-1 mb-2 h-9 w-px shrink-0 self-center bg-foreground/15" />
        )}
        {runningExtras.map(renderIcon)}
      </div>
    </div>
  );
}
