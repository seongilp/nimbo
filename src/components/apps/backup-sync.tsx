"use client";

import { useState } from "react";
import {
  RefreshCw,
  Server,
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
  Play,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderInput,
  Globe,
  Lock,
  Clipboard,
  Cloud,
  HardDriveDownload,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";

import { CloudTab } from "./backup-cloud";
import { TimeMachineTab } from "./backup-tm";

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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BackupOverview, RsyncJob, RsyncModule, SyncSchedule } from "@/lib/types";

const SCHEDULE_LABEL: Record<SyncSchedule, string> = { manual: "수동", hourly: "매시간", daily: "매일", weekly: "매주" };

type Act = (body: Record<string, unknown>, msg: string) => void;
type DialogState =
  | { type: "job"; job?: RsyncJob }
  | { type: "module" }
  | { type: "log"; job: RsyncJob }
  | { type: "confirm"; title: string; desc: string; onConfirm: () => void }
  | null;

export function BackupSync() {
  const { data, refresh } = usePoll<BackupOverview>("/api/backup", 4000);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      setDialog(null);
    }
  };

  const jobs = data?.jobs ?? [];
  const server = data?.server;

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="jobs" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="jobs"><RefreshCw className="size-3.5" /> 동기화 작업</TabsTrigger>
            <TabsTrigger value="cloud"><Cloud className="size-3.5" /> 클라우드</TabsTrigger>
            <TabsTrigger value="tm"><HardDriveDownload className="size-3.5" /> Time Machine</TabsTrigger>
            <TabsTrigger value="server"><Server className="size-3.5" /> rsync 서버</TabsTrigger>
          </TabsList>
          {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* JOBS */}
          <TabsContent value="jobs" className="m-0 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{jobs.length}개 작업</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "job" })}><Plus className="size-4" /> 작업 추가</Button>
            </div>
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} busy={busy} act={act} setDialog={setDialog} />
              ))}
              {jobs.length === 0 && <p className="text-sm text-muted-foreground">동기화 작업이 없습니다.</p>}
            </div>
          </TabsContent>

          <TabsContent value="cloud" className="m-0"><CloudTab /></TabsContent>
          <TabsContent value="tm" className="m-0"><TimeMachineTab /></TabsContent>

          {/* SERVER */}
          <TabsContent value="server" className="m-0 space-y-3 p-4">
            {server && (
              <>
                <Card className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className={cn("flex size-10 items-center justify-center rounded-lg", server.enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")}>
                      <Server className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">rsync 데몬 {server.enabled ? "실행 중" : "중지됨"}</p>
                      <p className="text-xs text-muted-foreground">포트 {server.port} · 다른 기기가 이 NAS로 push/pull 가능</p>
                    </div>
                  </div>
                  <Switch checked={server.enabled} disabled={busy} onCheckedChange={(v) => act({ kind: "server.toggle", enabled: v }, v ? "rsync 데몬 시작" : "rsync 데몬 중지")} />
                </Card>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{server.modules.length}개 모듈(공유)</p>
                  <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "module" })}><Plus className="size-4" /> 모듈 추가</Button>
                </div>

                <div className="space-y-2">
                  {server.modules.map((m) => (
                    <Card key={m.name} className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{m.readOnly ? <Lock className="size-4" /> : <FolderInput className="size-4" />}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            <Badge variant={m.readOnly ? "secondary" : "outline"} className="text-[10px]">{m.readOnly ? "읽기 전용" : "쓰기 가능"}</Badge>
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">{m.path}</p>
                          <p className="text-[11px] text-muted-foreground">allow: {m.hostsAllow}{m.comment ? ` · ${m.comment}` : ""}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="hidden rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground md:block">rsync://{data?.hostname}/{m.name}</code>
                        <Button size="icon" variant="ghost" className="size-8 text-destructive" disabled={busy}
                          onClick={() => setDialog({ type: "confirm", title: "모듈 삭제", desc: `${m.name} 모듈을 삭제합니다.`, onConfirm: () => act({ kind: "module.delete", name: m.name }, "모듈 삭제됨") })}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>

                <Card className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">생성된 rsyncd.conf</p>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { navigator.clipboard?.writeText(server.generatedConf); toast.success("클립보드에 복사됨"); }}>
                      <Clipboard className="size-3.5" /> 복사
                    </Button>
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{server.generatedConf}</pre>
                </Card>
              </>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <BackupDialogs dialog={dialog} setDialog={setDialog} act={act} busy={busy} />
    </div>
  );
}

const STATUS = {
  success: { cls: "bg-emerald-500/15 text-emerald-500", Icon: CheckCircle2, label: "성공" },
  failed: { cls: "bg-red-500/15 text-red-500", Icon: XCircle, label: "실패" },
  running: { cls: "bg-sky-500/15 text-sky-500", Icon: Loader2, label: "실행 중" },
  idle: { cls: "bg-muted text-muted-foreground", Icon: RefreshCw, label: "대기" },
} as const;

function JobCard({ job, busy, act, setDialog }: { job: RsyncJob; busy: boolean; act: Act; setDialog: (d: DialogState) => void }) {
  const st = STATUS[job.lastStatus];
  const pull = job.direction === "pull";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 items-center justify-center rounded-lg", pull ? "bg-sky-500/15 text-sky-500" : "bg-violet-500/15 text-violet-500")}>
            {pull ? <ArrowDownToLine className="size-5" /> : <ArrowUpFromLine className="size-5" />}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{job.name}</span>
              <Badge variant="outline" className="text-[10px]">{pull ? "가져오기 (pull)" : "보내기 (push)"}</Badge>
              <Badge variant="secondary" className="text-[10px]">{SCHEDULE_LABEL[job.schedule]}</Badge>
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {pull ? <>{job.remote} → {job.localPath}</> : <>{job.localPath} → {job.remote}</>}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {job.archive && <Badge variant="secondary" className="text-[9px]">archive -a</Badge>}
              {job.compress && <Badge variant="secondary" className="text-[9px]">compress -z</Badge>}
              {job.deleteExtra && <Badge variant="secondary" className="text-[9px] text-amber-500">--delete</Badge>}
            </div>
          </div>
        </div>
        <Badge className={cn("gap-1 border-0", st.cls)}><st.Icon className={cn("size-3.5", job.lastStatus === "running" && "animate-spin")} />{st.label}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="text-xs text-muted-foreground">
          {job.lastRun ? (
            <>마지막 {formatRelative(job.lastRun)} · {formatBytes(job.lastBytes)} · {job.lastFiles.toLocaleString()}개 파일</>
          ) : (
            <>아직 실행되지 않음</>
          )}
          {job.lastError && <span className="ml-1 text-red-500">· {job.lastError}</span>}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => act({ kind: "job.run", id: job.id }, "동기화 실행됨")}><Play className="size-3.5" /> 지금 실행</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDialog({ type: "log", job })}><ScrollText className="size-3.5" /> 로그</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDialog({ type: "job", job })}><Pencil className="size-3.5" /> 편집</Button>
          <Button size="icon" variant="ghost" className="size-7 text-destructive"
            onClick={() => setDialog({ type: "confirm", title: "작업 삭제", desc: `${job.name} 작업을 삭제합니다.`, onConfirm: () => act({ kind: "job.delete", id: job.id }, "작업 삭제됨") })}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function BackupDialogs({ dialog, setDialog, act, busy }: { dialog: DialogState; setDialog: (d: DialogState) => void; act: Act; busy: boolean }) {
  const close = () => setDialog(null);
  return (
    <Dialog open={dialog !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className={dialog?.type === "job" || dialog?.type === "log" ? "max-w-2xl" : undefined}>
        {dialog?.type === "confirm" && (
          <>
            <DialogHeader><DialogTitle>{dialog.title}</DialogTitle><DialogDescription>{dialog.desc}</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
              <Button variant="destructive" onClick={dialog.onConfirm} disabled={busy}>삭제</Button>
            </DialogFooter>
          </>
        )}
        {dialog?.type === "job" && <JobDialog job={dialog.job} act={act} close={close} busy={busy} />}
        {dialog?.type === "module" && <ModuleDialog act={act} close={close} busy={busy} />}
        {dialog?.type === "log" && <LogView job={dialog.job} />}
      </DialogContent>
    </Dialog>
  );
}

function JobDialog({ job, act, close, busy }: { job?: RsyncJob; act: Act; close: () => void; busy: boolean }) {
  const [name, setName] = useState(job?.name ?? "");
  const [direction, setDirection] = useState<"pull" | "push">(job?.direction ?? "push");
  const [remote, setRemote] = useState(job?.remote ?? "");
  const [localPath, setLocalPath] = useState(job?.localPath ?? "");
  const [archive, setArchive] = useState(job?.archive ?? true);
  const [compress, setCompress] = useState(job?.compress ?? true);
  const [deleteExtra, setDeleteExtra] = useState(job?.deleteExtra ?? false);
  const [schedule, setSchedule] = useState<SyncSchedule>(job?.schedule ?? "manual");

  const payload = { name: name.trim(), direction, remote: remote.trim(), localPath: localPath.trim(), archive, compress, deleteExtra, schedule };
  const valid = name.trim() && remote.trim() && localPath.trim();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{job ? "작업 편집" : "동기화 작업 추가"}</DialogTitle>
        <DialogDescription>rsync 으로 로컬과 원격 간 파일을 동기화합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="작업 이름" autoFocus />
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => setDirection("pull")} className={cn("flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm transition-colors", direction === "pull" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
            <ArrowDownToLine className="size-4" /> 가져오기 (원격→로컬)
          </button>
          <button onClick={() => setDirection("push")} className={cn("flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm transition-colors", direction === "push" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
            <ArrowUpFromLine className="size-4" /> 보내기 (로컬→원격)
          </button>
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><Globe className="size-3" /> 원격 경로</p>
          <Input value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="user@host:/path 또는 rsync://host/module" />
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><FolderInput className="size-3" /> 로컬 경로</p>
          <Input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/volume1/Photos" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <label className="flex items-center gap-2"><Switch checked={archive} onCheckedChange={setArchive} /> archive</label>
          <label className="flex items-center gap-2"><Switch checked={compress} onCheckedChange={setCompress} /> compress</label>
          <label className="flex items-center gap-2"><Switch checked={deleteExtra} onCheckedChange={setDeleteExtra} /> delete</label>
        </div>
        <label className="flex items-center justify-between text-sm">
          예약
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={schedule} onChange={(e) => setSchedule(e.target.value as SyncSchedule)}>
            {(["manual", "hourly", "daily", "weekly"] as SyncSchedule[]).map((s) => <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !valid} onClick={() => act(job ? { kind: "job.update", id: job.id, job: payload } : { kind: "job.create", job: payload }, job ? "작업 저장됨" : "작업 추가됨")}>저장</Button>
      </DialogFooter>
    </>
  );
}

function ModuleDialog({ act, close, busy }: { act: Act; close: () => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [hostsAllow, setHostsAllow] = useState("192.168.1.0/24");
  const [comment, setComment] = useState("");
  const module: RsyncModule = { name: name.trim(), path: path.trim(), readOnly, hostsAllow: hostsAllow.trim(), comment: comment.trim() };
  return (
    <>
      <DialogHeader><DialogTitle>rsync 모듈 추가</DialogTitle><DialogDescription>다른 기기가 rsync://로 접근할 공유를 정의합니다.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="모듈 이름 (예: media)" autoFocus />
        <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="경로 (예: /volume1/Movies)" />
        <Input value={hostsAllow} onChange={(e) => setHostsAllow(e.target.value)} placeholder="hosts allow (예: 192.168.1.0/24)" />
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="설명 (선택)" />
        <label className="flex items-center justify-between text-sm">읽기 전용<Switch checked={readOnly} onCheckedChange={setReadOnly} /></label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !name.trim() || !path.trim()} onClick={() => act({ kind: "module.create", module }, "모듈 추가됨")}>추가</Button>
      </DialogFooter>
    </>
  );
}

function LogView({ job }: { job: RsyncJob }) {
  const history = job.history ?? [];
  return (
    <>
      <DialogHeader>
        <DialogTitle>실행 로그 — {job.name}</DialogTitle>
        <DialogDescription>마지막 실행 출력과 최근 이력입니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <pre className="max-h-64 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {job.lastLog ?? "아직 실행 기록이 없습니다."}
        </pre>
        {history.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium">최근 이력</p>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-1.5 font-medium">시각</th><th className="px-3 py-1.5 font-medium">상태</th><th className="px-3 py-1.5 text-right font-medium">전송</th><th className="px-3 py-1.5 text-right font-medium">파일</th><th className="px-3 py-1.5 text-right font-medium">소요</th></tr></thead>
                <tbody>
                  {history.map((r, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-1.5 text-muted-foreground">{formatRelative(r.ts)}</td>
                      <td className="px-3 py-1.5"><Badge variant="outline" className={cn("text-[10px]", r.status === "success" ? "text-emerald-500" : r.status === "failed" ? "text-red-500" : "")}>{r.status}</Badge></td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(r.bytes)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.files.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{(r.durationMs / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
