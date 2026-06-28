"use client";

import { create } from "zustand";

const STORAGE_KEY = "nimbo-dock-favorites";

// Apps pinned to the dock by default. The rest are still reachable from the
// Nimbo menu (top-left cloud icon); users curate the dock from there.
const DEFAULT_FAVORITES = [
  "dashboard",
  "files",
  "zfs",
  "storage",
  "monitor",
  "docker",
  "packages",
  "settings",
];

interface FavoritesStore {
  ids: string[];
  loaded: boolean;
  toggle: (id: string) => void;
  isFavorite: (id: string) => boolean;
  load: () => void;
}

function persist(ids: string[]) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  ids: DEFAULT_FAVORITES,
  loaded: false,
  toggle: (id) => {
    const next = get().ids.includes(id)
      ? get().ids.filter((x) => x !== id)
      : [...get().ids, id];
    persist(next);
    set({ ids: next });
  },
  isFavorite: (id) => get().ids.includes(id),
  load: () => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) set({ ids: parsed, loaded: true });
        return;
      } catch {
        // fall through to defaults
      }
    }
    set({ loaded: true });
  },
}));
