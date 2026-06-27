"use client";

import { useEffect, useState } from "react";

export interface AccentDef {
  id: string;
  label: string;
  swatch: string; // css color for the picker dot
  primary: string; // oklch value applied to --primary / --ring
}

export const ACCENTS: AccentDef[] = [
  { id: "blue", label: "블루", swatch: "#3B82F6", primary: "oklch(0.62 0.17 256)" },
  { id: "indigo", label: "인디고", swatch: "#6366F1", primary: "oklch(0.58 0.2 280)" },
  { id: "teal", label: "틸", swatch: "#14B8A6", primary: "oklch(0.64 0.13 190)" },
  { id: "violet", label: "바이올렛", swatch: "#8B5CF6", primary: "oklch(0.6 0.22 300)" },
  { id: "rose", label: "로즈", swatch: "#F43F5E", primary: "oklch(0.64 0.22 12)" },
  { id: "amber", label: "앰버", swatch: "#F59E0B", primary: "oklch(0.74 0.15 70)" },
];

function apply(primary: string) {
  document.documentElement.style.setProperty("--primary", primary);
  document.documentElement.style.setProperty("--ring", primary);
  document.documentElement.style.setProperty("--sidebar-primary", primary);
}

/** Persisted accent color applied to CSS custom properties at runtime. */
export function useAccent() {
  const [accent, setAccentState] = useState("blue");

  useEffect(() => {
    const stored = localStorage.getItem("nas-accent") ?? "blue";
    const def = ACCENTS.find((a) => a.id === stored) ?? ACCENTS[0];
    setAccentState(def.id);
    apply(def.primary);
  }, []);

  const setAccent = (id: string) => {
    const def = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
    localStorage.setItem("nas-accent", def.id);
    setAccentState(def.id);
    apply(def.primary);
  };

  return { accent, setAccent };
}
