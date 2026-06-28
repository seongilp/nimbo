export interface Wallpaper {
  id: string;
  label: string;
  /** CSS background value. Empty string = use the default `.desktop-wallpaper`. */
  bg: string;
  /** Small swatch gradient for the picker. */
  swatch: string;
}

const slate =
  "radial-gradient(120% 80% at 50% -15%, oklch(0.5 0.13 256 / 0.4) 0%, transparent 55%)," +
  "radial-gradient(100% 70% at 90% 110%, oklch(0.4 0.1 280 / 0.28) 0%, transparent 55%)," +
  "linear-gradient(180deg, oklch(0.2 0.04 265), oklch(0.12 0.038 265))";

export const WALLPAPERS: Wallpaper[] = [
  { id: "default", label: "Slate", bg: "", swatch: "linear-gradient(135deg,#1e293b,#0f172a)" },
  {
    id: "midnight",
    label: "Midnight",
    bg: "radial-gradient(120% 90% at 50% -10%, oklch(0.38 0.12 264 / 0.55), transparent 60%), linear-gradient(180deg, #0b1020, #05070f)",
    swatch: "linear-gradient(135deg,#1e3a8a,#05070f)",
  },
  {
    id: "aurora",
    label: "Aurora",
    bg: "radial-gradient(90% 70% at 15% 10%, oklch(0.55 0.15 175 / 0.45), transparent 55%), radial-gradient(90% 70% at 85% 90%, oklch(0.5 0.16 280 / 0.4), transparent 55%), linear-gradient(180deg, #0a1622, #060d14)",
    swatch: "linear-gradient(135deg,#14b8a6,#7c3aed)",
  },
  {
    id: "dusk",
    label: "Dusk",
    bg: "radial-gradient(110% 80% at 80% 0%, oklch(0.55 0.2 12 / 0.5), transparent 55%), radial-gradient(110% 80% at 10% 100%, oklch(0.45 0.18 300 / 0.45), transparent 55%), linear-gradient(180deg, #1a0f1f, #0c0712)",
    swatch: "linear-gradient(135deg,#f43f5e,#7c3aed)",
  },
  {
    id: "ocean",
    label: "Ocean",
    bg: "radial-gradient(120% 90% at 50% -10%, oklch(0.5 0.14 230 / 0.55), transparent 60%), linear-gradient(180deg, #07172a, #04111e)",
    swatch: "linear-gradient(135deg,#0ea5e9,#04111e)",
  },
  {
    id: "graphite",
    label: "Graphite",
    bg: "radial-gradient(120% 90% at 50% -10%, oklch(0.4 0.01 260 / 0.5), transparent 60%), linear-gradient(180deg, #1c1c1f, #0e0e10)",
    swatch: "linear-gradient(135deg,#3f3f46,#0e0e10)",
  },
  {
    id: "forest",
    label: "Forest",
    bg: "radial-gradient(110% 80% at 20% 0%, oklch(0.5 0.13 150 / 0.45), transparent 55%), linear-gradient(180deg, #0a1410, #050b08)",
    swatch: "linear-gradient(135deg,#16a34a,#050b08)",
  },
  {
    id: "ink",
    label: "Ink",
    bg: "linear-gradient(180deg, #0a0a0b, #000000)",
    swatch: "linear-gradient(135deg,#27272a,#000000)",
  },
];

export const DEFAULT_WALLPAPER_BG = slate;

export function wallpaperById(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}
