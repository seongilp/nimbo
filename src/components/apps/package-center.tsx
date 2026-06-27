"use client";

import { useMemo, useState } from "react";
import {
  Package,
  Download,
  Play,
  Square,
  Trash2,
  Search,
  Grid3x3,
  Film,
  Cloud,
  Network,
  Shield,
  Activity,
  Code,
  Image as ImageIcon,
  ArrowDownToLine,
  FileText,
  Music,
  Home,
  Boxes,
  Sparkles,
  ExternalLink,
  HardDrive,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePoll } from "@/lib/hooks/use-poll";
import { cn } from "@/lib/utils";
import type { PackageApp } from "@/lib/types";

// The API enriches each PackageApp with these optional fields (see
// src/lib/system/packages.ts). The catalog is read as JSON, so we describe the
// extended shape locally rather than importing from the server module.
type PackageAppView = PackageApp & {
  featured?: boolean;
  tagline?: string;
  webPort?: number;
  dataPath?: string;
};

interface PackageOverviewView {
  catalog: PackageAppView[];
  isMock: boolean;
}

type ActFn = (
  body: Record<string, unknown>,
  id: string,
  msg: string,
  pending?: string
) => void;

const INSTALL_PENDING = "설치 중… (docker compose 받는 중, 1~2분 소요)";

// Category → icon + gradient tile, app-registry style.
const CATEGORY_STYLE: Record<string, { Icon: LucideIcon; color: string }> = {
  미디어: { Icon: Film, color: "bg-gradient-to-b from-[#F59E0B] to-[#D97706]" },
  생산성: { Icon: Cloud, color: "bg-gradient-to-b from-[#3B82F6] to-[#2563EB]" },
  자동화: { Icon: Home, color: "bg-gradient-to-b from-[#14B8A6] to-[#0D9488]" },
  네트워크: { Icon: Network, color: "bg-gradient-to-b from-[#6366F1] to-[#4F46E5]" },
  보안: { Icon: Shield, color: "bg-gradient-to-b from-[#10B981] to-[#059669]" },
  관리: { Icon: Boxes, color: "bg-gradient-to-b from-[#64748B] to-[#334155]" },
  사진: { Icon: ImageIcon, color: "bg-gradient-to-b from-[#F43F5E] to-[#E11D48]" },
  모니터링: { Icon: Activity, color: "bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]" },
  개발: { Icon: Code, color: "bg-gradient-to-b from-[#8B5CF6] to-[#7C3AED]" },
  다운로드: { Icon: ArrowDownToLine, color: "bg-gradient-to-b from-[#22C55E] to-[#16A34A]" },
  문서: { Icon: FileText, color: "bg-gradient-to-b from-[#EAB308] to-[#CA8A04]" },
  음악: { Icon: Music, color: "bg-gradient-to-b from-[#EC4899] to-[#DB2777]" },
};

function styleFor(category: string) {
  return CATEGORY_STYLE[category] ?? { Icon: Package, color: "bg-gradient-to-b from-[#64748B] to-[#475569]" };
}

/** Build a browser URL to an installed app's web UI using the current host. */
function openUrl(app: PackageAppView): string | null {
  if (!app.webPort) return null;
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${host}:${app.webPort}`;
}

export function PackageCenter() {
  const { data, refresh } = usePoll<PackageOverviewView>("/api/packages", 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("전체");
  const [query, setQuery] = useState("");

  const catalog = useMemo(() => data?.catalog ?? [], [data]);

  const categories = useMemo(() => {
    const set = new Set(catalog.map((a) => a.category));
    return ["전체", ...Array.from(set)];
  }, [catalog]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((a) => {
      if (filter !== "전체" && a.category !== filter) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [catalog, filter, query]);

  const showFeatured = filter === "전체" && query.trim() === "";
  const featured = useMemo(() => catalog.filter((a) => a.featured), [catalog]);

  const act: ActFn = async (body, id, msg, pending) => {
    setBusy(id);
    const toastId = pending ? toast.loading(pending) : undefined;
    try {
      const res = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(msg, toastId ? { id: toastId } : undefined);
        refresh();
      } else {
        toast.error(json.error ?? "작업 실패", toastId ? { id: toastId } : undefined);
      }
    } catch (err) {
      toast.error((err as Error).message, toastId ? { id: toastId } : undefined);
    } finally {
      setBusy(null);
    }
  };

  const installedCount = catalog.filter((a) => a.installed).length;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Top bar */}
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-[26%] bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white ring-1 ring-white/10">
              <Package className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight">패키지 센터</p>
              <p className="text-xs text-muted-foreground">
                {catalog.length}개 앱 · {installedCount}개 설치됨
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="앱 검색"
                className="h-8 w-44 pl-8 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => {
            const active = filter === cat;
            const Icon = cat === "전체" ? Grid3x3 : styleFor(cat).Icon;
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors",
                  active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"
                )}
              >
                <Icon className="size-3.5" /> {cat}
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* Featured */}
        {showFeatured && featured.length > 0 && (
          <div className="px-4 pt-4">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="size-4 text-amber-500" />
              <h2 className="text-sm font-semibold">추천</h2>
              <span className="text-xs text-muted-foreground">바로 쓸 수 있는 인기 앱</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {featured.map((app) => (
                <FeaturedCard key={app.id} app={app} busy={busy === app.id} act={act} />
              ))}
            </div>
          </div>
        )}

        {/* Browse grid */}
        <div className="px-4 pt-4">
          {showFeatured && (
            <div className="mb-2 flex items-center gap-1.5">
              <Grid3x3 className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">전체 앱</h2>
            </div>
          )}
          <div className="grid gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((app) => (
              <AppCard key={app.id} app={app} busy={busy === app.id} act={act} />
            ))}
          </div>
        </div>
        {visible.length === 0 && (
          <p className="px-4 pb-6 text-sm text-muted-foreground">표시할 앱이 없습니다.</p>
        )}
      </ScrollArea>
    </div>
  );
}

function OpenButton({ app, className }: { app: PackageAppView; className?: string }) {
  const url = openUrl(app);
  if (!url) return null;
  return (
    <Button asChild size="sm" variant="outline" className={cn("h-7 gap-1 text-xs", className)}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="size-3.5" /> 열기
      </a>
    </Button>
  );
}

function FeaturedCard({ app, busy, act }: { app: PackageAppView; busy: boolean; act: ActFn }) {
  const { Icon, color } = styleFor(app.category);
  return (
    <div className="rounded-xl bg-gradient-to-br from-primary/40 via-primary/10 to-transparent p-px shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <Card className="flex h-full flex-col gap-3 rounded-[11px] p-4">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-[26%] text-white ring-1 ring-white/10", color)}>
            <Icon className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-base font-semibold">{app.name}</p>
              <Badge className="shrink-0 gap-0.5 border-0 bg-amber-500/15 text-[9px] text-amber-600 dark:text-amber-400">
                <Sparkles className="size-2.5" /> 추천
              </Badge>
            </div>
            <p className="truncate text-xs font-medium text-foreground/80">{app.tagline}</p>
            <p className="truncate text-[11px] text-muted-foreground">{app.developer}</p>
          </div>
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{app.description}</p>

        {app.dataPath && (
          <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
            <HardDrive className="size-3 shrink-0" />
            <span className="truncate font-mono">데이터: {app.dataPath}</span>
          </p>
        )}

        <div className="mt-auto border-t pt-3">
          {app.installed ? (
            <div className="flex items-center justify-between gap-2">
              <Badge
                className={cn(
                  "gap-1 border-0 text-[10px]",
                  app.running ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
                )}
              >
                <span className={cn("size-1.5 rounded-full", app.running ? "bg-emerald-500" : "bg-muted-foreground")} />
                {app.running ? "실행 중" : "중지됨"}
              </Badge>
              <div className="flex gap-1.5">
                {app.running && <OpenButton app={app} />}
                {app.running ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={busy}
                    onClick={() => act({ kind: "app.stop", id: app.id }, app.id, `${app.name} 중지됨`)}
                  >
                    <Square className="size-3.5" /> 중지
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    disabled={busy}
                    onClick={() => act({ kind: "app.start", id: app.id }, app.id, `${app.name} 시작됨`)}
                  >
                    <Play className="size-3.5" /> 시작
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-destructive"
                  disabled={busy}
                  onClick={() => act({ kind: "app.uninstall", id: app.id }, app.id, `${app.name} 제거됨`)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              className="h-8 w-full gap-1.5 text-xs"
              disabled={busy}
              onClick={() => act({ kind: "app.install", id: app.id }, app.id, `${app.name} 설치됨`, INSTALL_PENDING)}
            >
              <Download className="size-3.5" /> 설치
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function AppCard({ app, busy, act }: { app: PackageAppView; busy: boolean; act: ActFn }) {
  const { Icon, color } = styleFor(app.category);
  return (
    <Card className="flex flex-col gap-3 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-[26%] text-white ring-1 ring-white/10", color)}>
          <Icon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-medium">{app.name}</p>
            <Badge variant="outline" className="shrink-0 text-[10px]">{app.category}</Badge>
          </div>
          {app.tagline ? (
            <p className="truncate text-xs text-muted-foreground">{app.tagline}</p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{app.developer}</p>
          )}
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{app.description}</p>

      <div className="flex flex-wrap gap-1">
        {app.ports.map((p) => (
          <Badge key={p} variant="secondary" className="font-mono text-[9px]">{p}</Badge>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
        {app.installed ? (
          <>
            <Badge
              className={cn(
                "gap-1 border-0 text-[10px]",
                app.running ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
              )}
            >
              <span className={cn("size-1.5 rounded-full", app.running ? "bg-emerald-500" : "bg-muted-foreground")} />
              {app.running ? "실행 중" : "중지됨"}
            </Badge>
            <div className="flex gap-1.5">
              {app.running && <OpenButton app={app} />}
              {app.running ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  disabled={busy}
                  onClick={() => act({ kind: "app.stop", id: app.id }, app.id, `${app.name} 중지됨`)}
                >
                  <Square className="size-3.5" /> 중지
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  disabled={busy}
                  onClick={() => act({ kind: "app.start", id: app.id }, app.id, `${app.name} 시작됨`)}
                >
                  <Play className="size-3.5" /> 시작
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-destructive"
                disabled={busy}
                onClick={() => act({ kind: "app.uninstall", id: app.id }, app.id, `${app.name} 제거됨`)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <Button
            size="sm"
            className="h-7 w-full gap-1 text-xs"
            disabled={busy}
            onClick={() => act({ kind: "app.install", id: app.id }, app.id, `${app.name} 설치됨`, INSTALL_PENDING)}
          >
            <Download className="size-3.5" /> 설치
          </Button>
        )}
      </div>
    </Card>
  );
}
