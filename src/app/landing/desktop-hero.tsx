/* eslint-disable @next/next/no-img-element */
import { Check } from "lucide-react";

function Gauge({ label, pct, accent }: { label: string; pct: number; accent: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full bg-gradient-to-r ${accent}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * The hero centerpiece: the Nimbo desktop screenshot framed as the running OS,
 * with live HTML "chips" floating over its edges so the landing reads as a
 * working console, not a flat marketing shot. Entrance + float motion is
 * disabled under `prefers-reduced-motion` (see globals.css).
 */
export function DesktopHero() {
  return (
    <div className="relative mx-auto mt-10 max-w-5xl [perspective:2000px] sm:mt-12">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-8 -top-10 bottom-8 -z-10 rounded-[44px] bg-primary/25 blur-[100px]"
      />

      {/* framed desktop (the screenshot already is the wallpaper + dock + windows) */}
      <div className="animate-hero-rise relative overflow-hidden rounded-2xl border border-white/10 bg-card shadow-window">
        <img
          src="/screenshots/desktop.png"
          alt="Nimbo 데스크톱 콘솔"
          width={2560}
          height={1600}
          className="block w-full"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
      </div>

      {/* ── live floating chips (decorative; hidden on small screens) ── */}

      {/* snapshot toast — top-left */}
      <div
        className="animate-chip-in absolute -left-4 top-10 hidden lg:block"
        style={{ animationDelay: "0.55s" }}
      >
        <div
          className="animate-float flex items-center gap-3 rounded-xl border border-white/10 glass px-3.5 py-2.5 shadow-window"
          style={{ animationDelay: "0.2s" }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-b from-emerald-500 to-green-600 text-white shadow-icon ring-1 ring-white/15">
            <Check className="size-4" />
          </span>
          <div className="text-left">
            <p className="text-xs font-semibold leading-none">스냅샷 생성 완료</p>
            <p className="mt-1 font-mono text-[11px] leading-none text-muted-foreground">
              tank/photos@auto-0628
            </p>
          </div>
        </div>
      </div>

      {/* mini system gauges — right */}
      <div
        className="animate-chip-in absolute -right-4 top-1/4 hidden w-44 lg:block"
        style={{ animationDelay: "0.7s" }}
      >
        <div
          className="animate-float rounded-xl border border-white/10 glass p-3.5 shadow-window"
          style={{ animationDelay: "1.1s" }}
        >
          <p className="text-[11px] font-semibold text-muted-foreground">시스템</p>
          <div className="mt-2.5 space-y-2.5">
            <Gauge label="CPU" pct={14} accent="from-sky-400 to-blue-600" />
            <Gauge label="MEM" pct={38} accent="from-violet-400 to-purple-600" />
            <Gauge label="ZFS" pct={61} accent="from-cyan-400 to-sky-600" />
          </div>
        </div>
      </div>

      {/* ZFS status pill — lower-left, clear of the centered dock */}
      <div
        className="animate-chip-in absolute bottom-[26%] -left-3 hidden lg:block"
        style={{ animationDelay: "0.85s" }}
      >
        <div
          className="animate-float inline-flex items-center gap-2 rounded-full border border-white/10 glass px-3.5 py-2 text-xs shadow-window"
          style={{ animationDelay: "0.6s" }}
        >
          <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/70" />
          <span className="font-semibold">ZFS · tank</span>
          <span className="text-muted-foreground">ONLINE · 9.1 TiB</span>
        </div>
      </div>
    </div>
  );
}
