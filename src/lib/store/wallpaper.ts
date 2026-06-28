"use client";

import { create } from "zustand";

interface WallpaperStore {
  id: string;
  setWallpaper: (id: string) => void;
  load: () => void;
}

export const useWallpaperStore = create<WallpaperStore>((set) => ({
  id: "default",
  setWallpaper: (id) => {
    if (typeof window !== "undefined") localStorage.setItem("nimbo-wallpaper", id);
    set({ id });
  },
  load: () => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("nimbo-wallpaper");
    if (stored) set({ id: stored });
  },
}));
