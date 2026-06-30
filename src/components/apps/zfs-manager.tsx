"use client";

import { useState } from "react";
import {
  Database,
  HardDrive,
  Layers,
  Camera,
  Gauge,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Play,
  Square,
  Eraser,
  Scissors,
  LogOut,
  Plus,
  MoreVertical,
  RotateCcw,
  Copy,
  Trash2,
  SlidersHorizontal,
  Lock,
  LockOpen,
  KeyRound,
  Send,
  Replace,
  Link2,
  Unlink,
  Power,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ArcStats,
  ScheduleInterval,
  SnapshotSchedule,
  Vdev,
  ZfsDataset,
  ZfsDevice,
  ZfsOverview,
  ZfsSnapshot,
  ZpoolInfo,
} from "@/lib/types";

const HEALTH = {
  ONLINE: { label: "정상", cls: "bg-emerald-500/15 text-emerald-500", Icon: CheckCircle2 },
  DEGRADED: { label: "성능 저하", cls: "bg-amber-500/15 text-amber-500", Icon: AlertTriangle },
  FAULTED: { label: "결함", cls: "bg-red-500/15 text-red-500", Icon: XCircle },
  OFFLINE: { label: "오프라인", cls: "bg-muted text-muted-foreground", Icon: AlertTriangle },
  UNAVAIL: { label: "사용 불가", cls: "bg-red-500/15 text-red-500", Icon: XCircle },
  REMOVED: { label: "제거됨", cls: "bg-muted text-muted-foreground", Icon: XCircle },
} as const;

const INTERVAL_LABEL: Record<ScheduleInterval, string> = { hourly: "매시간", daily: "매일", weekly: "매주" };
const MIN_DEVICES: Record<string, number> = { stripe: 1, mirror: 2, raidz1: 3, raidz2: 4, raidz3: 5 };

function usageColor(pct: number) {
  if (pct >= 90) return "var(--chart-5)";
  if (pct >= 75) return "var(--chart-3)";
  return "var(--primary)";
}

function Bar({ pct, color }: { pct: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color ?? usageColor(pct) }} />
    </div>
  );
}

type DialogState =
  | { type: "createPool" }
  | { type: "createDataset" }
  | { type: "createSnapshot"; dataset?: string }
  | { type: "editProps"; ds: ZfsDataset }
  | { type: "clone"; snap: ZfsSnapshot }
  | { type: "replicate"; snap: ZfsSnapshot }
  | { type: "loadKey"; ds: ZfsDataset }
  | { type: "device"; mode: "replace" | "attach"; pool: string; device: string }
  | { type: "addVdev"; pool: string }
  | { type: "createSchedule"; dataset?: string }
  | { type: "confirm"; title: string; desc: string; danger?: boolean; onConfirm: () => void }
  | null;

export type Act = (body: Record<string, unknown>, msg: string) => void;

export function ZfsManager() {
  const { data, loading, refresh } = usePoll<ZfsOverview>("/api/zfs", 3000);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, successMsg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/zfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(successMsg);
        refresh();
      } else {
        toast.error(json.error ?? "작업 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  if (data && !data.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <Database className="size-10 text-muted-foreground" />
        <p className="text-sm font-medium">이 호스트에 ZFS가 설치되어 있지 않습니다.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          <code>zpool</code> 명령을 찾을 수 없습니다. ZFS(zfsutils-linux 등)를 설치하면 풀과
          데이터셋이 여기에 표시됩니다.
        </p>
      </div>
    );
  }

  const pools = data?.pools ?? [];
  const datasets = data?.datasets ?? [];
  const snapshots = data?.snapshots ?? [];
  const devices = data?.availableDevices ?? [];
  const schedules = data?.schedules ?? [];

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="pools" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="pools"><Layers className="size-3.5" /> 풀</TabsTrigger>
            <TabsTrigger value="datasets"><HardDrive className="size-3.5" /> 데이터셋</TabsTrigger>
            <TabsTrigger value="snapshots"><Camera className="size-3.5" /> 스냅샷</TabsTrigger>
            <TabsTrigger value="schedules"><CalendarClock className="size-3.5" /> 예약</TabsTrigger>
            <TabsTrigger value="cache"><Gauge className="size-3.5" /> 캐시</TabsTrigger>
          </TabsList>
          {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* POOLS */}
          <TabsContent value="pools" className="m-0 space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{pools.length}개 풀 · 사용 가능 디스크 {devices.length}개</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "createPool" })}>
                <Plus className="size-4" /> 풀 생성
              </Button>
            </div>
            {loading && !data ? (
              <p className="text-sm text-muted-foreground">불러오는 중…</p>
            ) : (
              pools.map((pool) => <PoolCard key={pool.name} pool={pool} busy={busy} act={act} setDialog={setDialog} />)
            )}
          </TabsContent>

          {/* DATASETS */}
          <TabsContent value="datasets" className="m-0 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{datasets.length}개 데이터셋</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "createDataset" })}>
                <Plus className="size-4" /> 데이터셋 생성
              </Button>
            </div>
            <Card className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">이름</th>
                    <th className="px-3 py-2 text-right font-medium">사용</th>
                    <th className="px-3 py-2 text-right font-medium">여유</th>
                    <th className="px-3 py-2 font-medium">압축</th>
                    <th className="px-3 py-2 text-center font-medium">스냅샷</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((ds) => {
                    const depth = ds.name.split("/").length - 1;
                    return (
                      <tr key={ds.name} className="border-b border-border/40 last:border-0 hover:bg-accent/30">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                            {ds.type === "volume" ? <Database className="size-3.5 text-violet-400" /> : <HardDrive className="size-3.5 text-primary" />}
                            <span className="font-medium">{ds.name.split("/").pop()}</span>
                            {ds.encrypted && <Lock className="size-3 text-amber-500" />}
                            {ds.readonly && <Badge variant="secondary" className="text-[9px]">RO</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBytes(ds.usedBytes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{ds.mountpoint === "-" ? "—" : formatBytes(ds.availBytes)}</td>
                        <td className="px-3 py-2">
                          <span className="text-xs">{ds.compression}</span>
                          {ds.compressRatio > 1.01 && <span className="ml-1 text-xs text-emerald-500">{ds.compressRatio.toFixed(2)}x</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-xs text-muted-foreground">{ds.snapshotCount}</td>
                        <td className="px-2 py-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7"><MoreVertical className="size-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setDialog({ type: "createSnapshot", dataset: ds.name })}>
                                <Camera className="size-4" /> 스냅샷 생성
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDialog({ type: "createSchedule", dataset: ds.name })}>
                                <CalendarClock className="size-4" /> 스냅샷 예약
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDialog({ type: "editProps", ds })}>
                                <SlidersHorizontal className="size-4" /> 속성 편집
                              </DropdownMenuItem>
                              {ds.encrypted && (
                                <>
                                  <DropdownMenuItem onClick={() => setDialog({ type: "loadKey", ds })}>
                                    <KeyRound className="size-4" /> 암호화 키 로드
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => act({ kind: "dataset.unloadkey", name: ds.name }, "키 언로드됨")}>
                                    <LockOpen className="size-4" /> 키 언로드
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  setDialog({
                                    type: "confirm",
                                    title: "데이터셋 삭제",
                                    desc: `${ds.name} 와(과) 하위 스냅샷이 모두 삭제됩니다.`,
                                    danger: true,
                                    onConfirm: () => act({ kind: "dataset.destroy", name: ds.name, recursive: true }, "데이터셋 삭제됨"),
                                  })
                                }
                              >
                                <Trash2 className="size-4" /> 삭제
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* SNAPSHOTS */}
          <TabsContent value="snapshots" className="m-0 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{snapshots.length}개 스냅샷</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "createSnapshot" })}>
                <Plus className="size-4" /> 스냅샷 생성
              </Button>
            </div>
            <Card className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">스냅샷</th>
                    <th className="px-3 py-2 text-right font-medium">사용</th>
                    <th className="px-3 py-2 text-right font-medium">참조</th>
                    <th className="px-3 py-2 font-medium">생성</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.name} className="border-b border-border/40 last:border-0 hover:bg-accent/30">
                      <td className="px-4 py-2">
                        <span className="text-muted-foreground">{s.dataset}@</span>
                        <span className="font-medium">{s.snap}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatBytes(s.usedBytes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatBytes(s.referBytes)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatRelative(s.creation)}</td>
                      <td className="px-2 py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7"><MoreVertical className="size-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                setDialog({
                                  type: "confirm",
                                  title: "스냅샷으로 롤백",
                                  desc: `${s.dataset} 을(를) ${s.snap} 시점으로 되돌립니다. 이후 변경사항과 최신 스냅샷이 삭제됩니다.`,
                                  danger: true,
                                  onConfirm: () => act({ kind: "snapshot.rollback", name: s.name }, "롤백 완료"),
                                })
                              }
                            >
                              <RotateCcw className="size-4" /> 롤백
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDialog({ type: "clone", snap: s })}>
                              <Copy className="size-4" /> 클론 생성
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDialog({ type: "replicate", snap: s })}>
                              <Send className="size-4" /> 복제 (send/receive)
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                setDialog({
                                  type: "confirm",
                                  title: "스냅샷 삭제",
                                  desc: `${s.name} 을(를) 삭제합니다.`,
                                  danger: true,
                                  onConfirm: () => act({ kind: "snapshot.destroy", name: s.name }, "스냅샷 삭제됨"),
                                })
                              }
                            >
                              <Trash2 className="size-4" /> 삭제
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* SCHEDULES */}
          <TabsContent value="schedules" className="m-0 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{schedules.length}개 예약 · 30초마다 평가</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "createSchedule" })}>
                <Plus className="size-4" /> 예약 추가
              </Button>
            </div>
            <div className="space-y-2">
              {schedules.length === 0 && <p className="text-sm text-muted-foreground">예약된 스냅샷이 없습니다.</p>}
              {schedules.map((s) => (
                <ScheduleRow key={s.id} s={s} busy={busy} act={act} setDialog={setDialog} />
              ))}
            </div>
          </TabsContent>

          {/* CACHE / ARC */}
          <TabsContent value="cache" className="m-0 p-4">
            {data?.arc ? <ArcView arc={data.arc} /> : <p className="text-sm text-muted-foreground">ARC 통계를 사용할 수 없습니다.</p>}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <ZfsDialogs dialog={dialog} setDialog={setDialog} datasets={datasets} devices={devices} act={act} busy={busy} />
    </div>
  );
}

function ScheduleRow({ s, busy, act, setDialog }: { s: SnapshotSchedule; busy: boolean; act: Act; setDialog: (d: DialogState) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><CalendarClock className="size-4" /></span>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{s.dataset}</span>
            <Badge variant="outline" className="text-[10px]">{INTERVAL_LABEL[s.interval]}</Badge>
            <Badge variant="secondary" className="text-[10px]">{s.keep}개 보관</Badge>
            {s.recursive && <Badge variant="secondary" className="text-[10px]">재귀</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            마지막 {s.lastRun ? formatRelative(s.lastRun) : "없음"} · 다음 {formatRelative(s.nextRun)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={s.enabled} disabled={busy} onCheckedChange={(v) => act({ kind: "schedule.toggle", id: s.id, enabled: v }, v ? "예약 활성화" : "예약 비활성화")} />
        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => act({ kind: "schedule.runNow", id: s.id }, "스냅샷 생성됨")}>
          <Play className="size-3.5" /> 지금 실행
        </Button>
        <Button size="icon" variant="ghost" className="size-8 text-destructive" disabled={busy}
          onClick={() => setDialog({ type: "confirm", title: "예약 삭제", desc: `${s.dataset} ${INTERVAL_LABEL[s.interval]} 예약을 삭제합니다.`, danger: true, onConfirm: () => act({ kind: "schedule.delete", id: s.id }, "예약 삭제됨") })}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function PoolCard({ pool, busy, act, setDialog }: { pool: ZpoolInfo; busy: boolean; act: Act; setDialog: (d: DialogState) => void }) {
  const h = HEALTH[pool.health];
  const scrubbing = pool.scan.state === "scrubbing" || pool.scan.state === "resilvering";
  const hasErrors = pool.readErrors + pool.writeErrors + pool.cksumErrors > 0;
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Layers className="size-5" /></div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{pool.name}</span>
              <Badge className={cn("gap-1 border-0", h.cls)}><h.Icon className="size-3.5" />{h.label}</Badge>
              {pool.autotrim && <Badge variant="outline" className="text-[10px]">autotrim</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatBytes(pool.allocBytes)} / {formatBytes(pool.sizeBytes)} · 단편화 {pool.fragPercent}% · dedup {pool.dedupRatio.toFixed(2)}x
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {scrubbing ? (
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => act({ kind: "pool.scrub", name: pool.name, stop: true }, "스크럽 중지됨")}>
              <Square className="size-3.5" /> 스크럽 중지
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => act({ kind: "pool.scrub", name: pool.name }, "스크럽 시작됨")}>
              <Play className="size-3.5" /> 스크럽
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => act({ kind: "pool.trim", name: pool.name }, "트림 시작됨")}>
            <Scissors className="size-3.5" /> 트림
          </Button>
          {hasErrors && (
            <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => act({ kind: "pool.clear", name: pool.name }, "오류 초기화됨")}>
              <Eraser className="size-3.5" /> 오류 초기화
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8"><MoreVertical className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setDialog({ type: "confirm", title: "풀 내보내기", desc: `${pool.name} 풀을 내보냅니다(export).`, onConfirm: () => act({ kind: "pool.export", name: pool.name }, "풀 내보냄") })}>
                <LogOut className="size-4" /> 풀 내보내기
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog({ type: "addVdev", pool: pool.name })}>
                <Plus className="size-4" /> vdev 추가 (log/cache/spare)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive"
                onClick={() => setDialog({ type: "confirm", title: "풀 삭제", desc: `${pool.name} 풀과 모든 데이터셋·스냅샷이 영구 삭제됩니다.`, danger: true, onConfirm: () => act({ kind: "pool.destroy", name: pool.name }, "풀 삭제됨") })}>
                <Power className="size-4" /> 풀 삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted-foreground">용량 {pool.capacityPercent}%</span>
            <span className="text-muted-foreground">{formatBytes(pool.freeBytes)} 여유</span>
          </div>
          <Bar pct={pool.capacityPercent} />
        </div>

        {scrubbing && (
          <div className="rounded-lg bg-primary/5 p-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-primary">{pool.scan.state === "resilvering" ? "리실버링" : "스크럽"} 진행 중 · {pool.scan.progressPercent}%</span>
              <span className="text-muted-foreground">{formatBytes(pool.scan.speedBytesPerSec)}/s</span>
            </div>
            <Bar pct={pool.scan.progressPercent} color="var(--primary)" />
          </div>
        )}

        <div className="rounded-lg border bg-card/40 p-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1 font-medium">vdev / 디바이스</th>
                <th className="px-2 py-1 font-medium">상태</th>
                <th className="px-2 py-1 text-right font-medium">R</th>
                <th className="px-2 py-1 text-right font-medium">W</th>
                <th className="px-2 py-1 text-right font-medium">CKSUM</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {pool.vdevs.map((v) => (
                <VdevRows key={v.name} vdev={v} depth={0} pool={pool.name} busy={busy} act={act} setDialog={setDialog} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function VdevRows({ vdev, depth, pool, busy, act, setDialog }: { vdev: Vdev; depth: number; pool: string; busy: boolean; act: Act; setDialog: (d: DialogState) => void }) {
  const h = HEALTH[vdev.state];
  const isGroup = vdev.type !== "disk";
  const isLeaf = !vdev.children?.length && (vdev.type === "disk");
  const err = vdev.readErrors + vdev.writeErrors + vdev.cksumErrors > 0;
  return (
    <>
      <tr className={cn("border-t border-border/30", err && "bg-red-500/5")}>
        <td className="px-2 py-1">
          <span style={{ paddingLeft: depth * 14 }} className={cn("inline-flex items-center gap-1.5", isGroup ? "font-medium" : "font-mono text-[11px]")}>
            {isGroup && <Badge variant="outline" className="text-[9px] uppercase">{vdev.type}</Badge>}
            {vdev.name}
          </span>
        </td>
        <td className="px-2 py-1"><span className={cn("rounded px-1.5 py-0.5 text-[10px]", h.cls)}>{vdev.state}</span></td>
        <td className={cn("px-2 py-1 text-right tabular-nums", vdev.readErrors && "text-red-500")}>{vdev.readErrors}</td>
        <td className={cn("px-2 py-1 text-right tabular-nums", vdev.writeErrors && "text-red-500")}>{vdev.writeErrors}</td>
        <td className={cn("px-2 py-1 text-right tabular-nums", vdev.cksumErrors && "text-red-500")}>{vdev.cksumErrors}</td>
        <td className="px-1 py-1">
          {isLeaf && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6"><MoreVertical className="size-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog({ type: "device", mode: "replace", pool, device: vdev.name })}>
                  <Replace className="size-4" /> 교체 (replace)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog({ type: "device", mode: "attach", pool, device: vdev.name })}>
                  <Link2 className="size-4" /> 미러 추가 (attach)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => act({ kind: "device.offline", name: pool, device: vdev.name }, "오프라인 전환됨")}>
                  <Power className="size-4" /> 오프라인
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => act({ kind: "device.detach", name: pool, device: vdev.name }, "디바이스 분리됨")}>
                  <Unlink className="size-4" /> 분리 (detach)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </td>
      </tr>
      {vdev.children?.map((c) => <VdevRows key={c.name} vdev={c} depth={depth + 1} pool={pool} busy={busy} act={act} setDialog={setDialog} />)}
    </>
  );
}

function ArcView({ arc }: { arc: ArcStats }) {
  const fillPct = arc.maxBytes > 0 ? (arc.sizeBytes / arc.maxBytes) * 100 : 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">ARC 크기</p><p className="text-xl font-semibold">{formatBytes(arc.sizeBytes)}</p><p className="text-xs text-muted-foreground">/ {formatBytes(arc.maxBytes)} 최대</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">히트율</p><p className="text-xl font-semibold text-emerald-500">{arc.hitRatio.toFixed(1)}%</p><p className="text-xs text-muted-foreground">{arc.misses.toLocaleString()} 미스</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">L2ARC</p><p className="text-xl font-semibold">{arc.l2SizeBytes != null ? formatBytes(arc.l2SizeBytes) : "—"}</p><p className="text-xs text-muted-foreground">캐시 디바이스</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">총 히트</p><p className="text-xl font-semibold">{(arc.hits / 1e6).toFixed(0)}M</p><p className="text-xs text-muted-foreground">누적</p></Card>
      </div>
      <Card className="space-y-3 p-4">
        <div>
          <div className="mb-1 flex justify-between text-xs"><span className="font-medium">ARC 사용률</span><span className="text-muted-foreground">{fillPct.toFixed(0)}%</span></div>
          <Bar pct={fillPct} color="var(--primary)" />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">MFU (자주 사용) {formatBytes(arc.mfuBytes)}</span><span className="text-muted-foreground">MRU (최근 사용) {formatBytes(arc.mruBytes)}</span></div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-[var(--chart-1)]" style={{ width: `${(arc.mfuBytes / arc.sizeBytes) * 100}%` }} />
            <div className="h-full bg-[var(--chart-4)]" style={{ width: `${(arc.mruBytes / arc.sizeBytes) * 100}%` }} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function ZfsDialogs({ dialog, setDialog, datasets, devices, act, busy }: { dialog: DialogState; setDialog: (d: DialogState) => void; datasets: ZfsDataset[]; devices: ZfsDevice[]; act: Act; busy: boolean }) {
  const close = () => setDialog(null);
  return (
    <Dialog open={dialog !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className={dialog?.type === "createPool" ? "max-w-lg" : undefined}>
        {dialog?.type === "confirm" && (
          <>
            <DialogHeader><DialogTitle>{dialog.title}</DialogTitle><DialogDescription>{dialog.desc}</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
              <Button variant={dialog.danger ? "destructive" : "default"} onClick={dialog.onConfirm} disabled={busy}>확인</Button>
            </DialogFooter>
          </>
        )}
        {dialog?.type === "createPool" && <PoolCreateDialog devices={devices} act={act} close={close} busy={busy} />}
        {dialog?.type === "createDataset" && <SimpleCreateDialog title="데이터셋 생성" desc="전체 경로를 입력하세요. 예: tank/documents" placeholder="tank/새데이터셋" requireSlash onSubmit={(v) => act({ kind: "dataset.create", name: v }, "데이터셋 생성됨")} close={close} busy={busy} />}
        {dialog?.type === "createSnapshot" && <SnapshotCreateDialog datasets={datasets} preset={dialog.dataset} act={act} close={close} busy={busy} />}
        {dialog?.type === "clone" && <SimpleCreateDialog title="스냅샷 클론" desc={`${dialog.snap.name} 으로부터 새 데이터셋을 만듭니다.`} placeholder="tank/clone-name" requireSlash onSubmit={(v) => act({ kind: "snapshot.clone", name: dialog.snap.name, target: v }, "클론 생성됨")} close={close} busy={busy} />}
        {dialog?.type === "replicate" && <ReplicateDialog snap={dialog.snap} act={act} close={close} busy={busy} />}
        {dialog?.type === "loadKey" && <LoadKeyDialog ds={dialog.ds} act={act} close={close} busy={busy} />}
        {dialog?.type === "device" && <DeviceDialog mode={dialog.mode} pool={dialog.pool} device={dialog.device} devices={devices} act={act} close={close} busy={busy} />}
        {dialog?.type === "addVdev" && <AddVdevDialog pool={dialog.pool} devices={devices} act={act} close={close} busy={busy} />}
        {dialog?.type === "createSchedule" && <ScheduleCreateDialog datasets={datasets} preset={dialog.dataset} act={act} close={close} busy={busy} />}
        {dialog?.type === "editProps" && <PropsEditor ds={dialog.ds} act={act} close={close} busy={busy} />}
      </DialogContent>
    </Dialog>
  );
}

function SimpleCreateDialog({ title, desc, placeholder, requireSlash, onSubmit, close, busy }: { title: string; desc: string; placeholder: string; requireSlash?: boolean; onSubmit: (v: string) => void; close: () => void; busy: boolean }) {
  const [v, setV] = useState("");
  const valid = v.trim().length > 0 && (!requireSlash || v.includes("/"));
  return (
    <>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{desc}</DialogDescription></DialogHeader>
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus />
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button onClick={() => onSubmit(v.trim())} disabled={busy || !valid}>생성</Button>
      </DialogFooter>
    </>
  );
}

function SnapshotCreateDialog({ datasets, preset, act, close, busy }: { datasets: ZfsDataset[]; preset?: string; act: Act; close: () => void; busy: boolean }) {
  const fs = datasets.filter((d) => d.type === "filesystem");
  const [dataset, setDataset] = useState(preset ?? fs[0]?.name ?? "");
  const [snap, setSnap] = useState(`manual-${new Date().toISOString().slice(0, 10)}`);
  const [recursive, setRecursive] = useState(false);
  return (
    <>
      <DialogHeader><DialogTitle>스냅샷 생성</DialogTitle><DialogDescription>데이터셋의 현재 상태를 저장합니다.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={dataset} onChange={(e) => setDataset(e.target.value)}>
          {fs.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
        </select>
        <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">{dataset}@</span><Input value={snap} onChange={(e) => setSnap(e.target.value)} className="flex-1" /></div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={recursive} onCheckedChange={setRecursive} /> 하위 데이터셋 포함 (-r)</label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button onClick={() => act({ kind: "snapshot.create", name: dataset, target: snap.trim(), recursive }, "스냅샷 생성됨")} disabled={busy || !snap.trim() || !dataset}>생성</Button>
      </DialogFooter>
    </>
  );
}

function PoolCreateDialog({ devices, act, close, busy }: { devices: ZfsDevice[]; act: Act; close: () => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("mirror");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (p: string) => setSelected((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const sel = devices.filter((d) => selected.has(d.path));
  const totalRaw = sel.reduce((s, d) => s + d.sizeBytes, 0);
  const usable = type === "mirror" ? (sel.length ? Math.min(...sel.map((d) => d.sizeBytes)) : 0)
    : type === "raidz1" ? totalRaw * (1 - 1 / Math.max(1, sel.length))
    : type === "raidz2" ? totalRaw * (1 - 2 / Math.max(1, sel.length))
    : type === "raidz3" ? totalRaw * (1 - 3 / Math.max(1, sel.length))
    : totalRaw;
  const min = MIN_DEVICES[type] ?? 1;
  const valid = NAME_OK(name) && selected.size >= min;
  return (
    <>
      <DialogHeader><DialogTitle>풀 생성</DialogTitle><DialogDescription>RAID 구성과 디스크를 선택하세요.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="풀 이름 (예: tank2)" autoFocus />
        <div className="grid grid-cols-5 gap-1.5">
          {["stripe", "mirror", "raidz1", "raidz2", "raidz3"].map((t) => (
            <button key={t} onClick={() => setType(t)} className={cn("rounded-md border px-2 py-1.5 text-xs transition-colors", type === t ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>{t}</button>
          ))}
        </div>
        <div className="rounded-lg border">
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">사용 가능 디스크 — 최소 {min}개 선택</p>
          <div className="max-h-48 overflow-y-auto">
            {devices.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">사용 가능한 디스크가 없습니다.</p>}
            {devices.map((d) => (
              <label key={d.path} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-0 hover:bg-accent/40">
                <input type="checkbox" checked={selected.has(d.path)} onChange={() => toggle(d.path)} className="size-4 accent-[var(--primary)]" />
                <span className="flex-1">{d.name} <span className="text-xs text-muted-foreground">· {d.model}</span></span>
                <span className="text-xs text-muted-foreground">{formatBytes(d.sizeBytes)}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
          <span className="text-muted-foreground">선택 {selected.size}개 · {type}</span>
          <span className="font-medium">예상 사용 가능 용량 ≈ {formatBytes(usable)}</span>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button onClick={() => act({ kind: "pool.create", name: name.trim(), poolType: type, devices: [...selected] }, "풀 생성됨")} disabled={busy || !valid}>생성</Button>
      </DialogFooter>
    </>
  );
}

function DeviceDialog({ mode, pool, device, devices, act, close, busy }: { mode: "replace" | "attach"; pool: string; device: string; devices: ZfsDevice[]; act: Act; close: () => void; busy: boolean }) {
  const [path, setPath] = useState(devices[0]?.path ?? "");
  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "replace" ? "디바이스 교체" : "미러 디바이스 추가"}</DialogTitle>
        <DialogDescription>{pool} 풀의 {device} {mode === "replace" ? "을(를) 새 디스크로 교체합니다." : "에 디스크를 붙여 미러를 구성합니다."}</DialogDescription>
      </DialogHeader>
      <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={path} onChange={(e) => setPath(e.target.value)}>
        {devices.length === 0 && <option value="">사용 가능한 디스크 없음</option>}
        {devices.map((d) => <option key={d.path} value={d.path}>{d.name} · {d.model} · {formatBytes(d.sizeBytes)}</option>)}
      </select>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !path}
          onClick={() => act({ kind: mode === "replace" ? "device.replace" : "device.attach", name: pool, oldDevice: device, newDevice: path }, mode === "replace" ? "교체 시작됨 (리실버)" : "미러 추가됨")}>
          {mode === "replace" ? "교체" : "추가"}
        </Button>
      </DialogFooter>
    </>
  );
}

function AddVdevDialog({ pool, devices, act, close, busy }: { pool: string; devices: ZfsDevice[]; act: Act; close: () => void; busy: boolean }) {
  const [role, setRole] = useState("cache");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (p: string) => setSelected((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const ROLE_DESC: Record<string, string> = { log: "쓰기 지연 로그 (SLOG) — 동기 쓰기 가속", cache: "읽기 캐시 (L2ARC) — 읽기 성능 향상", spare: "핫 스페어 — 디스크 장애 시 자동 교체" };
  return (
    <>
      <DialogHeader><DialogTitle>vdev 추가 — {pool}</DialogTitle><DialogDescription>풀에 log/cache/spare 디바이스를 추가합니다.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1.5">
          {["log", "cache", "spare"].map((r) => (
            <button key={r} onClick={() => setRole(r)} className={cn("rounded-md border px-2 py-1.5 text-xs transition-colors", role === r ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>{r}</button>
          ))}
        </div>
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{ROLE_DESC[role]}</p>
        <div className="rounded-lg border">
          <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">사용 가능 디스크</p>
          <div className="max-h-44 overflow-y-auto">
            {devices.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">사용 가능한 디스크가 없습니다.</p>}
            {devices.map((d) => (
              <label key={d.path} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-0 hover:bg-accent/40">
                <input type="checkbox" checked={selected.has(d.path)} onChange={() => toggle(d.path)} className="size-4 accent-[var(--primary)]" />
                <span className="flex-1">{d.name} <span className="text-xs text-muted-foreground">· {d.model}</span></span>
                <span className="text-xs text-muted-foreground">{formatBytes(d.sizeBytes)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button onClick={() => act({ kind: "pool.addvdev", name: pool, vdevRole: role, devices: [...selected] }, "vdev 추가됨")} disabled={busy || selected.size === 0}>추가</Button>
      </DialogFooter>
    </>
  );
}

function ReplicateDialog({ snap, act, close, busy }: { snap: ZfsSnapshot; act: Act; close: () => void; busy: boolean }) {
  const [target, setTarget] = useState("");
  const [remote, setRemote] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>스냅샷 복제 (send / receive)</DialogTitle>
        <DialogDescription>{snap.name} 을(를) 다른 데이터셋으로 전송합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">대상 데이터셋</p>
          <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="backup/replicated" autoFocus />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">원격 호스트 (선택, SSH)</p>
          <Input value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="user@nas2.local (비우면 로컬)" />
        </div>
        <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
          {remote ? `zfs send -R ${snap.name} | ssh ${remote || "<host>"} zfs receive -F ${target || "<target>"}` : `zfs send -R ${snap.name} | zfs receive -F ${target || "<target>"}`}
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !target.includes("/")}
          onClick={() => act({ kind: "replication.run", source: snap.name, target: target.trim(), remoteHost: remote.trim() || undefined }, "복제 시작됨")}>
          복제
        </Button>
      </DialogFooter>
    </>
  );
}

function LoadKeyDialog({ ds, act, close, busy }: { ds: ZfsDataset; act: Act; close: () => void; busy: boolean }) {
  const [pass, setPass] = useState("");
  return (
    <>
      <DialogHeader><DialogTitle>암호화 키 로드 — {ds.name}</DialogTitle><DialogDescription>패스프레이즈를 입력하면 마운트할 수 있습니다.</DialogDescription></DialogHeader>
      <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="패스프레이즈" autoFocus />
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button onClick={() => act({ kind: "dataset.loadkey", name: ds.name, passphrase: pass }, "키 로드됨")} disabled={busy || !pass}>키 로드</Button>
      </DialogFooter>
    </>
  );
}

function ScheduleCreateDialog({ datasets, preset, act, close, busy }: { datasets: ZfsDataset[]; preset?: string; act: Act; close: () => void; busy: boolean }) {
  const fs = datasets.filter((d) => d.type === "filesystem");
  const [dataset, setDataset] = useState(preset ?? fs[0]?.name ?? "");
  const [interval, setInterval] = useState<ScheduleInterval>("daily");
  const [keep, setKeep] = useState(7);
  const [recursive, setRecursive] = useState(false);
  return (
    <>
      <DialogHeader><DialogTitle>스냅샷 예약</DialogTitle><DialogDescription>주기적으로 스냅샷을 만들고 오래된 것은 자동 정리합니다.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={dataset} onChange={(e) => setDataset(e.target.value)}>
          {fs.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
        </select>
        <div className="grid grid-cols-3 gap-1.5">
          {(["hourly", "daily", "weekly"] as ScheduleInterval[]).map((iv) => (
            <button key={iv} onClick={() => setInterval(iv)} className={cn("rounded-md border px-2 py-1.5 text-xs transition-colors", interval === iv ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>{INTERVAL_LABEL[iv]}</button>
          ))}
        </div>
        <label className="flex items-center justify-between text-sm">보관 개수<Input type="number" min={1} max={365} value={keep} onChange={(e) => setKeep(Number(e.target.value))} className="w-24" /></label>
        <label className="flex items-center justify-between text-sm">하위 데이터셋 포함 (-r)<Switch checked={recursive} onCheckedChange={setRecursive} /></label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button onClick={() => act({ kind: "schedule.create", name: dataset, interval, keep, recursive }, "예약 추가됨")} disabled={busy || !dataset || keep < 1}>추가</Button>
      </DialogFooter>
    </>
  );
}

function PropsEditor({ ds, act, close, busy }: { ds: ZfsDataset; act: Act; close: () => void; busy: boolean }) {
  const [compression, setCompression] = useState(ds.compression);
  const [recordsize, setRecordsize] = useState(ds.recordsize);
  const [atime, setAtime] = useState(ds.atime);
  const [readonly, setReadonly] = useState(ds.readonly);
  function save() {
    if (compression !== ds.compression) act({ kind: "dataset.setprop", name: ds.name, prop: "compression", value: compression }, "압축 변경됨");
    if (recordsize !== ds.recordsize) act({ kind: "dataset.setprop", name: ds.name, prop: "recordsize", value: recordsize }, "recordsize 변경됨");
    if (atime !== ds.atime) act({ kind: "dataset.setprop", name: ds.name, prop: "atime", value: atime ? "on" : "off" }, "atime 변경됨");
    if (readonly !== ds.readonly) act({ kind: "dataset.setprop", name: ds.name, prop: "readonly", value: readonly ? "on" : "off" }, "readonly 변경됨");
  }
  return (
    <>
      <DialogHeader><DialogTitle>속성 편집 — {ds.name}</DialogTitle><DialogDescription>ZFS 데이터셋 속성을 변경합니다.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <label className="flex items-center justify-between text-sm">압축 (compression)
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={compression} onChange={(e) => setCompression(e.target.value)}>
            {["off", "lz4", "zstd", "zstd-3", "zstd-9", "gzip"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between text-sm">레코드 크기 (recordsize)
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={recordsize} onChange={(e) => setRecordsize(e.target.value)}>
            {["16K", "32K", "64K", "128K", "256K", "512K", "1M"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between text-sm">접근 시간 기록 (atime)<Switch checked={atime} onCheckedChange={setAtime} /></label>
        <label className="flex items-center justify-between text-sm">읽기 전용 (readonly)<Switch checked={readonly} onCheckedChange={setReadonly} /></label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button onClick={save} disabled={busy}>저장</Button>
      </DialogFooter>
    </>
  );
}

function NAME_OK(v: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_.:\-]*$/.test(v.trim());
}
