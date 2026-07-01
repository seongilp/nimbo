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
  add: (type: WidgetType) => void;
  remove: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  load: () => void;
}

export const useWidgetStore = create<WidgetStore>((set, get) => ({
  widgets: [],
  add: (type) => {
    const n = get().widgets.length;
    const next: WidgetInstance[] = [
      ...get().widgets,
      { id: `w${typeof window !== "undefined" ? window.performance.now().toFixed(0) : seq}-${seq++}`, type, x: 32 + (n % 3) * 28, y: 60 + n * 26 },
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
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) set({ widgets: arr as WidgetInstance[] });
      }
    } catch {
      // ignore malformed
    }
  },
}));
