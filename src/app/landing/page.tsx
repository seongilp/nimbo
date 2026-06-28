/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import {
  Archive,
  ArrowRight,
  Bell,
  Box,
  Command,
  Database,
  HardDrive,
  Lock,
  type LucideIcon,
  MonitorSmartphone,
  Package,
  Server,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";

import { InstallBlock } from "./install-block";

export const metadata: Metadata = {
  title: "Nimbo — 당신만의 클라우드, 당신의 서버에",
  description:
    "Linux 서버를 NAS처럼 관리하세요. 파일 · ZFS 스토리지 · 백업 · 컨테이너를 하나의 아름다운 콘솔에서. 셀프호스팅 서버 관리 콘솔, Nimbo.",
};

const REPO = "https://github.com/seongilp/nimbo";

// ---------------------------------------------------------------------------

type Feature = {
  icon: LucideIcon;
  title: string;
  blurb: string;
  accent: string;
};

const FEATURES: Feature[] = [
  {
    icon: MonitorSmartphone,
    title: "데스크톱 UI",
    blurb: "macOS 스타일 윈도우 · 도크 · ⌘K 커맨드 팔레트로 익숙하게.",
    accent: "from-sky-500 to-blue-600",
  },
  {
    icon: Database,
    title: "ZFS 관리",
    blurb: "풀 · 데이터셋 · 스냅샷 · 복제까지 GUI 한곳에서.",
    accent: "from-cyan-500 to-sky-600",
  },
  {
    icon: Archive,
    title: "백업 & 동기화",
    blurb: "rsync · rclone 클라우드 · Time Machine 백업을 스케줄로.",
    accent: "from-amber-500 to-orange-600",
  },
  {
    icon: Box,
    title: "컨테이너",
    blurb: "Docker 컨테이너 상태 · 자원 · 라이프사이클 제어.",
    accent: "from-blue-500 to-indigo-600",
  },
  {
    icon: Package,
    title: "패키지 센터",
    blurb: "원클릭으로 셀프호스팅 앱을 설치하고 관리.",
    accent: "from-violet-500 to-purple-600",
  },
  {
    icon: ShieldCheck,
    title: "보안",
    blurb: "방화벽 · 2FA · 감사 로그로 안전하게 보호.",
    accent: "from-rose-500 to-red-600",
  },
  {
    icon: Users,
    title: "사용자 / 공유폴더",
    blurb: "계정 권한과 Samba · NFS 공유를 손쉽게 관리.",
    accent: "from-teal-500 to-emerald-600",
  },
  {
    icon: Server,
    title: "모니터링 대시보드",
    blurb: "CPU · 메모리 · 네트워크 · 스토리지를 실시간으로.",
    accent: "from-emerald-500 to-green-600",
  },
  {
    icon: Lock,
    title: "HTTPS / 인증서",
    blurb: "Caddy 리버스 프록시로 자동 TLS 인증서까지.",
    accent: "from-indigo-500 to-blue-600",
  },
  {
    icon: HardDrive,
    title: "UPS / SNMP",
    blurb: "무정전 전원 장치와 SNMP 모니터링을 기본 지원.",
    accent: "from-fuchsia-500 to-pink-600",
  },
  {
    icon: Bell,
    title: "알림",
    blurb: "Slack · Telegram · Discord로 이벤트를 즉시 전달.",
    accent: "from-yellow-500 to-amber-600",
  },
  {
    icon: Terminal,
    title: "systemd 네이티브 배포",
    blurb: "Docker 없이 systemd로 직접 실행 — 가볍고 견고하게.",
    accent: "from-slate-500 to-slate-700",
  },
];

type Shot = {
  src: string;
  title: string;
  blurb: string;
};

const SHOTS: Shot[] = [
  {
    src: "/screenshots/dashboard.png",
    title: "모니터링 대시보드",
    blurb: "시스템 · CPU · 메모리 · 스토리지 · 백업 · 보안을 한눈에.",
  },
  {
    src: "/screenshots/zfs.png",
    title: "ZFS 스토리지",
    blurb: "풀과 데이터셋, 스냅샷을 시각적으로 관리.",
  },
  {
    src: "/screenshots/packages.png",
    title: "패키지 센터",
    blurb: "셀프호스팅 앱을 원클릭으로 설치.",
  },
  {
    src: "/screenshots/security.png",
    title: "보안 센터",
    blurb: "방화벽 · 2FA · 감사 로그로 서버를 보호.",
  },
];

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#screenshots", label: "Screenshots" },
  { href: "#deploy", label: "Deploy" },
];

// ---------------------------------------------------------------------------

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.92 1.23 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.21.7.82.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/logo.svg"
      alt="Nimbo"
      width={size}
      height={size}
      className="shadow-icon rounded-[26%]"
    />
  );
}

function BrowserFrame({
  children,
  label = "nimbo.local",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="shadow-window overflow-hidden rounded-2xl border border-white/10 bg-card">
      <div className="flex items-center gap-2 border-b border-white/10 bg-background/60 px-4 py-2.5">
        <span className="size-3 rounded-full bg-red-500/80" />
        <span className="size-3 rounded-full bg-amber-500/80" />
        <span className="size-3 rounded-full bg-emerald-500/80" />
        <div className="mx-auto flex items-center gap-1.5 rounded-md border border-white/10 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
          <Lock className="size-3" />
          {label}
        </div>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function LandingPage() {
  return (
    <main className="desktop-wallpaper h-dvh overflow-y-auto text-foreground">
      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-white/10 glass-bar">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-lg font-bold tracking-tight">Nimbo</span>
          </a>
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="hidden items-center gap-1 sm:flex">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-full px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
            </div>
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-2 rounded-full border border-white/10 bg-card/70 px-4 py-2 text-sm font-medium shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40"
            >
              <GithubMark className="size-4" />
              GitHub
            </a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section
        id="top"
        className="relative mx-auto max-w-6xl px-5 pb-10 pt-20 text-center sm:px-8 sm:pt-28"
      >
        {/* glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[420px] max-w-3xl rounded-full bg-primary/20 blur-[120px]"
        />

        <div className="mx-auto flex size-20 items-center justify-center rounded-[26%] bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-icon ring-1 ring-white/15">
          <img src="/logo.svg" alt="" width={56} height={56} className="rounded-[20%]" />
        </div>

        <div className="mx-auto mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-card/60 px-3.5 py-1.5 text-xs text-muted-foreground shadow-soft">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          셀프호스팅 NAS · 서버 관리 콘솔
        </div>

        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-6xl">
          Your own cloud,
          <br className="hidden sm:block" />{" "}
          <span className="bg-gradient-to-r from-sky-400 to-blue-600 bg-clip-text text-transparent">
            self-hosted.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
          Linux 서버를 NAS처럼 관리하세요. 파일 · ZFS 스토리지 · 백업 · 컨테이너,
          그리고 그 이상을 하나의 아름다운 콘솔에서.
          <br className="hidden sm:block" />
          <span className="text-foreground/80">
            Manage a Linux server like a NAS — files, ZFS storage, backups,
            containers &amp; more, from one beautiful console.
          </span>
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#3B82F6] to-[#2563EB] px-6 py-3 text-sm font-semibold text-white shadow-icon transition-all hover:-translate-y-0.5 hover:brightness-110 sm:w-auto"
          >
            <GithubMark className="size-4" />
            GitHub에서 보기
          </a>
          <a
            href="#deploy"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-card/70 px-6 py-3 text-sm font-semibold shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 sm:w-auto"
          >
            배포 가이드
            <ArrowRight className="size-4" />
          </a>
        </div>

        {/* Hero screenshot */}
        <div className="mx-auto mt-16 max-w-5xl">
          <BrowserFrame>
            <img
              src="/screenshots/desktop.png"
              alt="Nimbo 데스크톱 콘솔"
              width={2560}
              height={1600}
              className="block w-full"
            />
          </BrowserFrame>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            하나의 콘솔, 모든 기능
          </h2>
          <p className="mt-4 text-muted-foreground">
            NAS에 필요한 모든 것을 직접 만들었습니다. 무겁지 않게, 아름답게.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group shadow-soft rounded-2xl border border-white/10 bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-window"
            >
              <span
                className={`shadow-icon flex size-11 items-center justify-center rounded-[26%] bg-gradient-to-b ${feature.accent} text-white ring-1 ring-white/15`}
              >
                <feature.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {feature.blurb}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshots */}
      <section
        id="screenshots"
        className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">
            Screenshots
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            직접 보는 게 빠릅니다
          </h2>
          <p className="mt-4 text-muted-foreground">
            실제 앱 화면 그대로. 슬레이트 다크 테마의 프리미엄한 감성.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {SHOTS.map((shot) => (
            <figure
              key={shot.src}
              className="group overflow-hidden rounded-2xl border border-white/10 bg-card shadow-soft transition-all duration-200 hover:-translate-y-1 hover:shadow-window"
            >
              <div className="overflow-hidden border-b border-white/10">
                <img
                  src={shot.src}
                  alt={shot.title}
                  width={1600}
                  height={1000}
                  className="block w-full transition-transform duration-500 group-hover:scale-[1.02]"
                />
              </div>
              <figcaption className="p-5">
                <h3 className="text-base font-semibold">{shot.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{shot.blurb}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Deploy */}
      <section id="deploy" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8">
        <div className="shadow-window relative overflow-hidden rounded-3xl border border-white/10 bg-card p-8 sm:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-primary/20 blur-[100px]"
          />
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                Deploy
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                systemd로 네이티브하게
              </h2>
              <p className="mt-4 leading-relaxed text-muted-foreground">
                Docker가 아니라 systemd로 직접 실행됩니다 — Docker가 죽어도
                Nimbo는 살아있습니다.
                <span className="text-foreground/80">
                  {" "}
                  Runs natively (systemd), not in Docker — survives Docker
                  crashes.
                </span>
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <Server className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span className="text-muted-foreground">
                    가벼운 standalone 번들 + systemd 서비스로 견고하게 동작.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Lock className="mt-0.5 size-4 shrink-0 text-sky-500" />
                  <span className="text-muted-foreground">
                    HTTPS는 Caddy 리버스 프록시로 자동 TLS 발급.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Command className="mt-0.5 size-4 shrink-0 text-violet-500" />
                  <span className="text-muted-foreground">
                    두 줄이면 설치 끝. 별도 의존성 없이 바로 실행.
                  </span>
                </li>
              </ul>
            </div>

            <div className="flex flex-col justify-center">
              <InstallBlock />
              <p className="mt-4 text-xs text-muted-foreground">
                설치 스크립트가 빌드 · systemd 유닛 등록 · Caddy 설정까지
                처리합니다. 자세한 내용은 저장소의{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  DEPLOYMENT.md
                </code>
                를 참고하세요.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-8 sm:px-8">
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-white/10 bg-gradient-to-b from-card to-background px-6 py-14 text-center shadow-soft">
          <Logo size={44} />
          <h2 className="max-w-xl text-2xl font-bold tracking-tight sm:text-3xl">
            당신만의 클라우드, 지금 시작하세요.
          </h2>
          <p className="max-w-md text-muted-foreground">
            오픈소스. 셀프호스팅. 당신의 데이터는 당신의 서버에.
          </p>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#3B82F6] to-[#2563EB] px-6 py-3 text-sm font-semibold text-white shadow-icon transition-all hover:-translate-y-0.5 hover:brightness-110"
          >
            <GithubMark className="size-4" />
            GitHub에서 시작하기
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:px-8">
          <div className="flex items-center gap-2.5">
            <Logo size={24} />
            <span className="font-semibold text-foreground">Nimbo</span>
            <span className="text-muted-foreground/60">·</span>
            <span>MIT License</span>
          </div>
          <div className="flex items-center gap-5">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <GithubMark className="size-4" />
              GitHub
            </a>
            <span>Built with Next.js</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
