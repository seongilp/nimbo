"use client";

import { memo, useEffect, useRef } from "react";
import { Minus, X, Maximize2 } from "lucide-react";

import { APP_MAP } from "./app-registry";
import { useWindowStore, type WindowState } from "@/lib/store/windows";
import { cn } from "@/lib/utils";

const MIN_W = 400;
const MIN_H = 280;
const TOPBAR_H = 30;

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// App content is isolated from window-position re-renders: it only re-mounts
// when the appId changes, never when the window moves, resizes, or refocuses.
const WindowBody = memo(function WindowBody({ appId }: { appId: string }) {
  const C = APP_MAP[appId]?.component;
  return C ? <C /> : null;
});

export function Window({ win }: { win: WindowState }) {
  const { focus, close, minimize, toggleMaximize, move, resize, focusedId } = useWindowStore();
  const app = APP_MAP[win.appId];
  const rootRef = useRef<HTMLDivElement>(null);
  // Live gesture state. During drag/resize we mutate the DOM style directly
  // (no React state) and only commit to the store on pointer-up — this avoids
  // re-rendering the window (and its app body) on every move, killing flicker.
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number; lastX: number; lastY: number } | null>(null);
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    x: number;
    y: number;
    w: number;
    h: number;
    lastX: number;
    lastY: number;
    lastW: number;
    lastH: number;
  } | null>(null);

  const isFocused = focusedId === win.id;

  // Move keyboard focus to the window when it first opens so screen-reader and
  // keyboard users land inside the dialog (and Escape works immediately).
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape closes the window — but only from the chrome / non-editable content,
  // so typing Escape inside an input or an open menu (which calls preventDefault)
  // never destroys unsaved work.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    const editable =
      t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable;
    if (editable) return;
    e.stopPropagation();
    close(win.id);
  }

  function onHeaderPointerDown(e: React.PointerEvent) {
    if (win.maximized) return;
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    focus(win.id);
    dragRef.current = { startX: e.clientX, startY: e.clientY, winX: win.x, winY: win.y, lastX: win.x, lastY: win.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHeaderPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !rootRef.current) return;
    const nx = d.winX + (e.clientX - d.startX);
    const ny = Math.max(0, d.winY + (e.clientY - d.startY));
    d.lastX = nx;
    d.lastY = ny;
    rootRef.current.style.transform = `translate3d(${nx}px, ${ny}px, 0)`;
  }

  function onHeaderPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d) move(win.id, d.lastX, d.lastY);
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
        lastX: win.x,
        lastY: win.y,
        lastW: win.width,
        lastH: win.height,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
  }

  function onResizeMove(e: React.PointerEvent) {
    const r = resizeRef.current;
    if (!r || !rootRef.current) return;
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
    r.lastX = x; r.lastY = y; r.lastW = w; r.lastH = h;
    const el = rootRef.current.style;
    el.transform = `translate3d(${x}px, ${y}px, 0)`; el.width = `${w}px`; el.height = `${h}px`;
  }

  function onResizeUp(e: React.PointerEvent) {
    const r = resizeRef.current;
    resizeRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (r) resize(win.id, r.lastW, r.lastH, r.lastX, r.lastY);
  }

  const maximize = () =>
    toggleMaximize(win.id, { width: window.innerWidth, height: window.innerHeight });

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={win.title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "animate-win-open shadow-window absolute flex flex-col overflow-hidden border border-black/5 bg-card outline-none dark:border-white/10",
        win.maximized ? "rounded-2xl" : "rounded-2xl"
      )}
      style={{
        // Position via transform so each window is its own GPU compositor
        // layer — dragging one window won't repaint the others (no flicker).
        left: 0,
        top: 0,
        transform: `translate3d(${win.x}px, ${win.y}px, 0)`,
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
            aria-label="닫기"
          >
            <X className="size-2 text-black/50 opacity-0 group-hover/title:opacity-100" strokeWidth={3} />
          </button>
          <button
            onClick={() => minimize(win.id)}
            className={cn(
              "flex size-3 items-center justify-center rounded-full bg-[#FEBC2E] transition-colors",
              !isFocused && "bg-muted-foreground/30"
            )}
            aria-label="최소화"
          >
            <Minus className="size-2 text-black/50 opacity-0 group-hover/title:opacity-100" strokeWidth={3} />
          </button>
          <button
            onClick={maximize}
            className={cn(
              "flex size-3 items-center justify-center rounded-full bg-[#28C840] transition-colors",
              !isFocused && "bg-muted-foreground/30"
            )}
            aria-label="최대화"
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
      <div className="min-h-0 flex-1 overflow-hidden"><WindowBody appId={win.appId} /></div>

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
