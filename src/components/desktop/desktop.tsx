"use client";

import { useEffect, useState } from "react";
import { Cloud, Search } from "lucide-react";

import { APPS } from "./app-registry";
import { CommandPalette } from "./command-palette";
import { Dock } from "./dock";
import { MenuBar } from "./menubar";
import { SetupWizard } from "./setup-wizard";
import { Window } from "./window";
import { useAccent } from "@/lib/hooks/use-accent";
import { useWindowStore } from "@/lib/store/windows";
import { cn } from "@/lib/utils";
import type { SetupConfig } from "@/lib/types";

export function Desktop() {
  const windows = useWindowStore((s) => s.windows);
  const openApp = useWindowStore((s) => s.open);
  const togglePalette = useWindowStore((s) => s.togglePalette);
  const hasVisible = windows.some((w) => !w.minimized);
  useAccent(); // apply persisted accent color on load

  // First-run setup gate.
  const [setup, setSetup] = useState<SetupConfig | null>(null);
  const [forceSetup, setForceSetup] = useState(false);
  useEffect(() => {
    setForceSetup(new URLSearchParams(window.location.search).has("setup"));
    fetch("/api/setup", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j.ok && setSetup(j.data))
      .catch(() => setSetup({ setupComplete: true } as SetupConfig));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // ⌘K / Ctrl+K toggles the command palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useWindowStore.getState().togglePalette();
        return;
      }
      // Esc: let open menus/dialogs handle themselves; otherwise minimize the
      // focused window so Esc always dismisses the frontmost panel.
      if (e.key === "Escape") {
        const store = useWindowStore.getState();
        if (store.paletteOpen) return;
        const overlay = document.querySelector(
          '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"]'
        );
        if (overlay) return;
        if (store.focusedId) {
          store.minimize(store.focusedId);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Show the setup wizard on a fresh host (or when previewing via ?setup=1).
  if (setup && (forceSetup || !setup.setupComplete)) {
    return (
      <SetupWizard
        initial={{ ...setup, setupComplete: false }}
        onComplete={() => {
          setForceSetup(false);
          setSetup({ ...setup, setupComplete: true });
        }}
      />
    );
  }

  return (
    <div className="desktop-wallpaper relative h-dvh w-full overflow-hidden">
      <MenuBar />

      {/* Welcome / empty state */}
      {!hasVisible && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 pb-24">
          <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-7 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="shadow-icon flex size-16 items-center justify-center rounded-[26%] bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white ring-1 ring-white/10">
                <Cloud className="size-8 fill-white/25" />
              </div>
              <div>
                <h1 className="text-[26px] font-bold tracking-tight">Nimbo</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  당신만의 클라우드, 당신의 서버에.
                  <br />
                  파일 · 스토리지 · 시스템 · 컨테이너를 한곳에서.
                </p>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-3">
              {APPS.filter((app) => ["dashboard", "zfs", "backup", "monitor"].includes(app.id)).map((app) => (
                <button
                  key={app.id}
                  onClick={() => openApp(app.id, { title: app.name, width: app.width, height: app.height })}
                  className="shadow-soft group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-white/10 bg-card p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-window"
                >
                  <span className={cn("shadow-icon flex size-11 items-center justify-center rounded-[26%] text-white ring-1 ring-white/10", app.color)}>
                    <app.icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{app.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{app.description}</span>
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={togglePalette}
              className="group flex items-center gap-2 rounded-full border border-white/10 bg-card/60 px-4 py-2 text-sm text-muted-foreground shadow-soft transition-colors hover:text-foreground"
            >
              <Search className="size-3.5" />
              <span>빠른 검색 및 명령</span>
              <kbd className="ml-1 rounded border border-white/15 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] tracking-wide">
                ⌘K
              </kbd>
            </button>
          </div>
        </div>
      )}

      {/* Windows */}
      {windows.map((win) => (
        <Window key={win.id} win={win} />
      ))}

      <Dock />
      <CommandPalette />
    </div>
  );
}
