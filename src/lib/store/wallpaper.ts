"use client";

import { create } from "zustand";

const KEY = "nimbo-wallpaper";
const CUSTOM_KEY = "nimbo-wallpaper-custom";

// Sentinel id for a user-uploaded image (stored as a downscaled data URL).
export const CUSTOM_WALLPAPER_ID = "custom";

interface WallpaperStore {
  id: string;
  customImage: string | null; // data URL, or null
  setWallpaper: (id: string) => void;
  setCustomImage: (dataUrl: string | null) => void;
  load: () => void;
}

export const useWallpaperStore = create<WallpaperStore>((set) => ({
  id: "default",
  customImage: null,
  setWallpaper: (id) => {
    if (typeof window !== "undefined") localStorage.setItem(KEY, id);
    set({ id });
  },
  setCustomImage: (dataUrl) => {
    if (typeof window !== "undefined") {
      if (dataUrl) {
        try {
          localStorage.setItem(CUSTOM_KEY, dataUrl);
          localStorage.setItem(KEY, CUSTOM_WALLPAPER_ID);
        } catch {
          // localStorage quota — image too large even after downscale
        }
      } else {
        localStorage.removeItem(CUSTOM_KEY);
      }
    }
    set(dataUrl ? { customImage: dataUrl, id: CUSTOM_WALLPAPER_ID } : { customImage: null });
  },
  load: () => {
    if (typeof window === "undefined") return;
    const custom = localStorage.getItem(CUSTOM_KEY);
    const stored = localStorage.getItem(KEY);
    set({ customImage: custom ?? null, id: stored ?? "default" });
  },
}));
