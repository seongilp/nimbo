"use client";

import { create } from "zustand";

export interface WindowState {
  id: string;
  appId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  // saved bounds to restore after un-maximize
  restore?: { x: number; y: number; width: number; height: number };
}

interface OpenOptions {
  title: string;
  width?: number;
  height?: number;
}

interface WindowStore {
  windows: WindowState[];
  focusedId: string | null;
  topZ: number;
  paletteOpen: boolean;
  open: (appId: string, opts: OpenOptions) => void;
  close: (id: string) => void;
  closeAll: () => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string, viewport: { width: number; height: number }) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, width: number, height: number, x?: number, y?: number) => void;
  taskbarClick: (id: string) => void;
  setPalette: (open: boolean) => void;
  togglePalette: () => void;
  tile: (viewport: { width: number; height: number }) => void;
  cascade: (viewport: { width: number; height: number }) => void;
  minimizeAll: () => void;
}

const TOPBAR_H = 40;
const DOCK_RESERVE = 96;

export const useWindowStore = create<WindowStore>((set, get) => ({
  windows: [],
  focusedId: null,
  topZ: 10,
  paletteOpen: false,

  open: (appId, opts) => {
    const existing = get().windows.find((w) => w.appId === appId);
    if (existing) {
      // Single instance: restore + focus.
      get().focus(existing.id);
      if (existing.minimized) {
        set((s) => ({
          windows: s.windows.map((w) =>
            w.id === existing.id ? { ...w, minimized: false } : w
          ),
        }));
      }
      return;
    }
    const z = get().topZ + 1;
    const count = get().windows.length;
    const maxX = typeof window !== "undefined" ? window.innerWidth : 1440;
    const maxY = typeof window !== "undefined" ? window.innerHeight : 900;
    const isMobileVp = maxX < 700;
    // On phones, open every window full-screen (no awkward floating/clipping).
    // On larger screens, size to the app's preference, clamped + cascaded.
    const width = isMobileVp ? maxX : Math.min(opts.width ?? 880, maxX - 16);
    const height = isMobileVp
      ? maxY - TOPBAR_H - DOCK_RESERVE
      : Math.min(opts.height ?? 580, maxY - TOPBAR_H - DOCK_RESERVE - 16);
    const cascade = isMobileVp ? 0 : (count % 5) - 2;
    const baseX = isMobileVp ? 0 : Math.max(8, (maxX - width) / 2 + cascade * 36);
    const baseY = isMobileVp
      ? TOPBAR_H
      : Math.max(TOPBAR_H + 12, (maxY - DOCK_RESERVE - height) / 2 + cascade * 28);
    const win: WindowState = {
      id: `${appId}-${z}`,
      appId,
      title: opts.title,
      x: baseX,
      y: baseY,
      width,
      height,
      minimized: false,
      maximized: false,
      zIndex: z,
    };
    set((s) => ({ windows: [...s.windows, win], focusedId: win.id, topZ: z }));
  },

  close: (id) =>
    set((s) => ({
      windows: s.windows.filter((w) => w.id !== id),
      focusedId: s.focusedId === id ? null : s.focusedId,
    })),

  closeAll: () => set({ windows: [], focusedId: null }),

  focus: (id) => {
    const z = get().topZ + 1;
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, zIndex: z } : w)),
      focusedId: id,
      topZ: z,
    }));
  },

  minimize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      focusedId: s.focusedId === id ? null : s.focusedId,
    })),

  toggleMaximize: (id, viewport) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized && w.restore) {
          return { ...w, maximized: false, ...w.restore, restore: undefined };
        }
        const inset = 12;
        return {
          ...w,
          maximized: true,
          restore: { x: w.x, y: w.y, width: w.width, height: w.height },
          x: inset,
          y: TOPBAR_H + inset,
          width: viewport.width - inset * 2,
          height: viewport.height - TOPBAR_H - DOCK_RESERVE - inset,
        };
      }),
    })),

  move: (id, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)),
    })),

  resize: (id, width, height, x, y) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id
          ? { ...w, width, height, x: x ?? w.x, y: y ?? w.y }
          : w
      ),
    })),

  taskbarClick: (id) => {
    const w = get().windows.find((win) => win.id === id);
    if (!w) return;
    if (w.minimized) {
      set((s) => ({
        windows: s.windows.map((win) =>
          win.id === id ? { ...win, minimized: false } : win
        ),
      }));
      get().focus(id);
    } else if (get().focusedId === id) {
      get().minimize(id);
    } else {
      get().focus(id);
    }
  },

  setPalette: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  tile: (viewport) => {
    const gap = 8;
    const top = TOPBAR_H + gap;
    set((s) => {
      const visible = s.windows.filter((w) => !w.minimized);
      const n = visible.length;
      if (!n) return {};
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const cellW = (viewport.width - gap * (cols + 1)) / cols;
      const cellH = (viewport.height - top - DOCK_RESERVE - gap * (rows + 1) + gap) / rows;
      let z = s.topZ;
      const placed = new Map<string, Partial<WindowState>>();
      visible.forEach((w, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        placed.set(w.id, {
          x: Math.round(gap + col * (cellW + gap)),
          y: Math.round(top + row * (cellH + gap)),
          width: Math.round(cellW),
          height: Math.round(cellH),
          maximized: false,
          restore: undefined,
          zIndex: ++z,
        });
      });
      return {
        topZ: z,
        windows: s.windows.map((w) => (placed.has(w.id) ? { ...w, ...placed.get(w.id) } : w)),
      };
    });
  },

  cascade: (viewport) => {
    const step = 32;
    const top = TOPBAR_H + 12;
    set((s) => {
      const visible = s.windows.filter((w) => !w.minimized);
      if (!visible.length) return {};
      const width = Math.min(900, Math.round(viewport.width * 0.62));
      const height = Math.min(620, Math.round((viewport.height - top - DOCK_RESERVE) * 0.82));
      let z = s.topZ;
      const placed = new Map<string, Partial<WindowState>>();
      visible.forEach((w, i) => {
        placed.set(w.id, {
          x: 24 + i * step,
          y: top + i * step,
          width,
          height,
          maximized: false,
          restore: undefined,
          zIndex: ++z,
        });
      });
      return {
        topZ: z,
        windows: s.windows.map((w) => (placed.has(w.id) ? { ...w, ...placed.get(w.id) } : w)),
      };
    });
  },

  minimizeAll: () =>
    set((s) => ({ windows: s.windows.map((w) => ({ ...w, minimized: true })), focusedId: null })),
}));
