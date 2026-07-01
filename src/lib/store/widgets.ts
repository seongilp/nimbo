"use client";

import { create } from "zustand";

export type WidgetType = "clock" | "system" | "uptime" | "network";

export interface WidgetInstance {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
}

const KEY = "nimbo-widgets";
let seq = 0;

function persist(ws: WidgetInstance[]) {
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(ws));
}

interface WidgetStore {
  widgets: WidgetInstance[];
  /** Add the widget if absent, remove it if already present (one per type). */
  toggle: (type: WidgetType) => void;
  remove: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  load: () => void;
}

export const useWidgetStore = create<WidgetStore>((set, get) => ({
  widgets: [],
  toggle: (type) => {
    const cur = get().widgets;
    // One widget per type: a second "add" of the same type removes it instead.
    if (cur.some((w) => w.type === type)) {
      const next = cur.filter((w) => w.type !== type);
      persist(next);
      set({ widgets: next });
      return;
    }
    // Stack new widgets in a tidy left column so they don't overlap on add.
    const n = cur.length;
    const next: WidgetInstance[] = [
      ...cur,
      { id: `w${typeof window !== "undefined" ? window.performance.now().toFixed(0) : seq}-${seq++}`, type, x: 24, y: 56 + n * 120 },
    ];
    persist(next);
    set({ widgets: next });
  },
  remove: (id) => {
    const next = get().widgets.filter((w) => w.id !== id);
    persist(next);
    set({ widgets: next });
  },
  move: (id, x, y) => {
    const next = get().widgets.map((w) => (w.id === id ? { ...w, x, y } : w));
    persist(next);
    set({ widgets: next });
  },
  load: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      // Keep only the first widget of each type (repairs older duplicate state).
      const seen = new Set<WidgetType>();
      const deduped = (arr as WidgetInstance[]).filter(
        (w) => w && !seen.has(w.type) && (seen.add(w.type), true)
      );
      set({ widgets: deduped });
      if (deduped.length !== arr.length) persist(deduped);
    } catch {
      // ignore malformed
    }
  },
}));
