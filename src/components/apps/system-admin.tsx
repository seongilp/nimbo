"use client";

import { useMemo, useState } from "react";
import {
  Server,
  Cog,
  ScrollText,
  Play,
  Square,
  RotateCcw,
  Plus,
  Trash2,
  CircleDot,
  MoreVertical,
  CheckCircle2,
  XCircle,
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
import type { CronJob, LogEntry, ServiceUnit, SystemAdminOverview } from "@/lib/types";

type Act = (body: Record<string, unknown>, msg: string) => void;

const ACTIVE_STYLE: Record<ServiceUnit["active"], { cls: string; label: string }> = {
  active: { cls: "bg-emerald-500/15 text-emerald-500", label: "실행 중" },
  inactive: { cls: "bg-muted text-muted-foreground", label: "중지됨" },
  failed: { cls: "bg-red-500/15 text-red-500", label: "실패" },
  activating: { cls: "bg-amber-500/15 text-amber-500", label: "시작 중" },
};

const LEVEL_STYLE: Record<LogEntry["level"], { dot: string; text: string; label: string }> = {
  info: { dot: "bg-sky-500", text: "text-foreground", label: "정보" },
  warning: { dot: "bg-amber-500", text: "text-amber-500", label: "경고" },
  error: { dot: "bg-red-500", text: "text-red-500", label: "오류" },
  debug: { dot: "bg-muted-foreground", text: "text-muted-foreground", label: "디버그" },
};

export function SystemAdmin() {
  const { data, refresh } = usePoll<SystemAdminOverview>("/api/system", 4000);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(msg);
        refresh();
      } else {
        toast.error(json.error ?? "작업 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const services = data?.services ?? [];
  const cron = data?.cron ?? [];
  const logs = data?.logs ?? [];

  const activeCount = services.filter((s) => s.active === "active").length;
  const failedCount = services.filter((s) => s.active === "failed").length;

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="services" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="services"><Server className="size-3.5" /> 서비스</TabsTrigger>
            <TabsTrigger value="cron"><Cog className="size-3.5" /> 예약 작업</TabsTrigger>
            <TabsTrigger value="logs"><ScrollText className="size-3.5" /> 로그</TabsTrigger>
          </TabsList>
          {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
        </div>

        {/* SERVICES */}
        <TabsContent value="services" className="m-0 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="size-3.5 text-emerald-500" /> {activeCount}개 실행 중</span>
            <span className="flex items-center gap-1"><XCircle className="size-3.5 text-red-500" /> {failedCount}개 실패</span>
            <span className="ml-auto">{services.length}개 유닛</span>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <Card className="m-4 overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">서비스</th>
                    <th className="px-3 py-2 font-medium">상태</th>
                    <th className="px-3 py-2 text-center font-medium">자동 시작</th>
                    <th className="px-3 py-2 text-right font-medium">메모리</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc) => {
                    const st = ACTIVE_STYLE[svc.active];
                    return (
                      <tr key={svc.name} className="border-b border-border/40 last:border-0 hover:bg-accent/30">
                        <td className="px-4 py-2">
                          <div className="font-mono font-medium">{svc.name}</div>
                          <div className="text-xs text-muted-foreground">{svc.description}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={cn("gap-1 border-0", st.cls)}>{st.label}</Badge>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Switch
                            checked={svc.enabled}
                            disabled={busy}
                            onCheckedChange={(v) =>
                              act(
                                { kind: v ? "service.enable" : "service.disable", name: svc.name },
                                v ? `${svc.name} 자동 시작 켜짐` : `${svc.name} 자동 시작 꺼짐`
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {svc.memoryBytes > 0 ? formatBytes(svc.memoryBytes) : "—"}
                        </td>
                        <td className="px-2 py-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-7"><MoreVertical className="size-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem disabled={busy} onClick={() => act({ kind: "service.start", name: svc.name }, `${svc.name} 시작됨`)}>
                                <Play className="size-4" /> 시작
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={busy} onClick={() => act({ kind: "service.restart", name: svc.name }, `${svc.name} 재시작됨`)}>
                                <RotateCcw className="size-4" /> 재시작
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => act({ kind: "service.stop", name: svc.name }, `${svc.name} 중지됨`)}>
                                <Square className="size-4" /> 중지
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                  {services.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">서비스가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </ScrollArea>
        </TabsContent>

        {/* CRON */}
        <TabsContent value="cron" className="m-0 flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <p className="text-sm text-muted-foreground">{cron.length}개 예약 작업</p>
            <Button size="sm" className="h-8 gap-1" onClick={() => setDialogOpen(true)}><Plus className="size-4" /> 작업 추가</Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-4">
              {cron.map((job) => (
                <CronRow key={job.id} job={job} busy={busy} act={act} />
              ))}
              {cron.length === 0 && <p className="text-sm text-muted-foreground">예약된 작업이 없습니다.</p>}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* LOGS */}
        <TabsContent value="logs" className="m-0 flex min-h-0 flex-1 flex-col">
          <LogsView logs={logs} />
        </TabsContent>
      </Tabs>

      <CronCreateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} act={act} busy={busy} />
    </div>
  );
}

function CronRow({ job, busy, act }: { job: CronJob; busy: boolean; act: Act }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Cog className="size-4" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px]">{job.schedule}</Badge>
            <span className="text-xs text-muted-foreground">{job.user}</span>
            {job.comment && <span className="text-xs text-muted-foreground">· {job.comment}</span>}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{job.command}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={job.enabled}
          disabled={busy}
          onCheckedChange={(v) => act({ kind: "cron.toggle", id: job.id, enabled: v }, v ? "작업 활성화" : "작업 비활성화")}
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-destructive"
          disabled={busy}
          onClick={() => act({ kind: "cron.delete", id: job.id }, "작업 삭제됨")}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

type LevelFilter = "all" | "error" | "warning";

function LogsView({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<LevelFilter>("all");
  const filtered = useMemo(
    () => logs.filter((l) => filter === "all" || l.level === filter),
    [logs, filter]
  );
  const filters: Array<{ key: LevelFilter; label: string }> = [
    { key: "all", label: "전체" },
    { key: "error", label: "오류" },
    { key: "warning", label: "경고" },
  ];
  return (
    <>
      <div className="flex items-center gap-1.5 border-b px-4 py-2">
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length}개 항목</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-border/40 font-mono text-xs">
          {filtered.map((entry, i) => {
            const lv = LEVEL_STYLE[entry.level];
            return (
              <div key={i} className="flex items-start gap-2 px-4 py-1.5 hover:bg-accent/30">
                <CircleDot className={cn("mt-0.5 size-3 shrink-0", lv.text)} />
                <span className={cn("mt-0.5 size-2 shrink-0 rounded-full", lv.dot)} />
                <span className="w-20 shrink-0 truncate text-muted-foreground">{entry.unit}</span>
                <span className={cn("min-w-0 flex-1 break-words", lv.text)}>{entry.message}</span>
                <span className="shrink-0 text-muted-foreground">{formatRelative(entry.ts)}</span>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="px-4 py-6 text-center text-muted-foreground">표시할 로그가 없습니다.</p>}
        </div>
      </ScrollArea>
    </>
  );
}

function CronCreateDialog({ open, onClose, act, busy }: { open: boolean; onClose: () => void; act: Act; busy: boolean }) {
  const [schedule, setSchedule] = useState("");
  const [command, setCommand] = useState("");
  const [comment, setComment] = useState("");
  const valid = schedule.trim().length > 0 && command.trim().length > 0;

  const submit = () => {
    act(
      { kind: "cron.create", cron: { schedule: schedule.trim(), command: command.trim(), comment: comment.trim() } },
      "작업 추가됨"
    );
    setSchedule("");
    setCommand("");
    setComment("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>예약 작업 추가</DialogTitle>
          <DialogDescription>cron 표현식과 실행할 명령을 입력하세요.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">스케줄 (cron)</p>
            <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="0 3 * * *" className="font-mono" autoFocus />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">명령</p>
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="/usr/local/bin/backup.sh" className="font-mono" />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">설명 (선택)</p>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="야간 백업" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>취소</Button>
          <Button onClick={submit} disabled={busy || !valid}>추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
