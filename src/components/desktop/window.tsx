"use client";

import { useRef } from "react";
import { Minus, X, Maximize2 } from "lucide-react";

import { APP_MAP } from "./app-registry";
import { useWindowStore, type WindowState } from "@/lib/store/windows";
import { cn } from "@/lib/utils";

const MIN_W = 400;
const MIN_H = 280;
const TOPBAR_H = 30;

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function Window({ win }: { win: WindowState }) {
  const { focus, close, minimize, toggleMaximize, move, resize, focusedId } = useWindowStore();
  const app = APP_MAP[win.appId];
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const isFocused = focusedId === win.id;

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (win.maximized) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    focus(win.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, winX: win.x, winY: win.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHeaderPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const nx = d.winX + (e.clientX - d.startX);
    const ny = Math.max(0, d.winY + (e.clientY - d.startY));
    move(win.id, nx, ny);
  }

  function onHeaderPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  function startResize(dir: ResizeDir) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      focus(win.id);
      resizeRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        x: win.x,
        y: win.y,
        w: win.width,
        h: win.height,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
  }

  function onResizeMove(e: React.PointerEvent) {
    const r = resizeRef.current;
    if (!r) return;
    const dx = e.clientX - r.startX;
    const dy = e.clientY - r.startY;
    let { x, y, w, h } = r;
    if (r.dir.includes("e")) w = Math.max(MIN_W, r.w + dx);
    if (r.dir.includes("s")) h = Math.max(MIN_H, r.h + dy);
    if (r.dir.includes("w")) {
      w = Math.max(MIN_W, r.w - dx);
      x = r.x + (r.w - w);
    }
    if (r.dir.includes("n")) {
      h = Math.max(MIN_H, r.h - dy);
      y = Math.max(TOPBAR_H, r.y + (r.h - h));
    }
    resize(win.id, w, h, x, y);
  }

  function onResizeUp(e: React.PointerEvent) {
    resizeRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  const Body = app?.component;
  const maximize = () =>
    toggleMaximize(win.id, { width: window.innerWidth, height: window.innerHeight });

  return (
    <div
      className={cn(
        "animate-win-open shadow-window absolute flex flex-col overflow-hidden border border-black/5 bg-card dark:border-white/10",
        win.maximized ? "rounded-2xl" : "rounded-2xl"
      )}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
        display: win.minimized ? "none" : "flex",
      }}
      onPointerDown={() => !isFocused && focus(win.id)}
    >
      {/* Title bar — macOS traffic lights on the left, centered title */}
      <div
        className={cn(
          "no-select group/title relative flex h-11 shrink-0 items-center border-b border-border/60 px-4",
          isFocused ? "bg-card" : "bg-muted/40",
          win.maximized ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        )}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onDoubleClick={maximize}
      >
        <div className="flex items-center gap-2" data-no-drag>
          <button
            onClick={() => close(win.id)}
            className={cn(
              "flex size-3 items-center justify-center rounded-full bg-[#FF5F57] transition-colors",
              !isFocused && "bg-muted-foreground/30"
            )}
            aria-label="Close"
          >
            <X className="size-2 text-black/50 opacity-0 group-hover/title:opacity-100" strokeWidth={3} />
          </button>
          <button
            onClick={() => minimize(win.id)}
            className={cn(
              "flex size-3 items-center justify-center rounded-full bg-[#FEBC2E] transition-colors",
              !isFocused && "bg-muted-foreground/30"
            )}
            aria-label="Minimize"
          >
            <Minus className="size-2 text-black/50 opacity-0 group-hover/title:opacity-100" strokeWidth={3} />
          </button>
          <button
            onClick={maximize}
            className={cn(
              "flex size-3 items-center justify-center rounded-full bg-[#28C840] transition-colors",
              !isFocused && "bg-muted-foreground/30"
            )}
            aria-label="Maximize"
          >
            <Maximize2 className="size-[7px] text-black/50 opacity-0 group-hover/title:opacity-100" strokeWidth={3} />
          </button>
        </div>

        <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center gap-2">
          {app && (
            <span className={cn("flex size-4 items-center justify-center rounded-[5px] text-white", app.color)}>
              <app.icon className="size-2.5" />
            </span>
          )}
          <span className={cn("text-[13px] font-semibold", isFocused ? "text-foreground" : "text-muted-foreground")}>
            {win.title}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">{Body ? <Body /> : null}</div>

      {/* Resize handles */}
      {!win.maximized && (
        <>
          <Handle dir="n" onDown={startResize("n")} onMove={onResizeMove} onUp={onResizeUp} className="left-2 right-2 top-0 h-1 cursor-ns-resize" />
          <Handle dir="s" onDown={startResize("s")} onMove={onResizeMove} onUp={onResizeUp} className="bottom-0 left-2 right-2 h-1 cursor-ns-resize" />
          <Handle dir="e" onDown={startResize("e")} onMove={onResizeMove} onUp={onResizeUp} className="bottom-2 right-0 top-2 w-1 cursor-ew-resize" />
          <Handle dir="w" onDown={startResize("w")} onMove={onResizeMove} onUp={onResizeUp} className="bottom-2 left-0 top-2 w-1 cursor-ew-resize" />
          <Handle dir="ne" onDown={startResize("ne")} onMove={onResizeMove} onUp={onResizeUp} className="right-0 top-0 size-3 cursor-nesw-resize" />
          <Handle dir="nw" onDown={startResize("nw")} onMove={onResizeMove} onUp={onResizeUp} className="left-0 top-0 size-3 cursor-nwse-resize" />
          <Handle dir="se" onDown={startResize("se")} onMove={onResizeMove} onUp={onResizeUp} className="bottom-0 right-0 size-3 cursor-nwse-resize" />
          <Handle dir="sw" onDown={startResize("sw")} onMove={onResizeMove} onUp={onResizeUp} className="bottom-0 left-0 size-3 cursor-nesw-resize" />
        </>
      )}
    </div>
  );
}

function Handle({
  className,
  onDown,
  onMove,
  onUp,
}: {
  dir: ResizeDir;
  className?: string;
  onDown: (e: React.PointerEvent) => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className={cn("absolute z-10 touch-none", className)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  );
}
