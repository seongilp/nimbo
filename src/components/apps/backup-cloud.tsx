"use client";

import { useState } from "react";
import { Cloud, Plus, Play, Pencil, Trash2, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, XCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CloudJob, CloudOverview, RcloneRemote, RcloneType, SyncSchedule } from "@/lib/types";

const SCHEDULE_LABEL: Record<SyncSchedule, string> = { manual: "수동", hourly: "매시간", daily: "매일", weekly: "매주" };
const STATUS = {
  success: { cls: "bg-emerald-500/15 text-emerald-500", Icon: CheckCircle2, label: "성공" },
  failed: { cls: "bg-red-500/15 text-red-500", Icon: XCircle, label: "실패" },
  running: { cls: "bg-sky-500/15 text-sky-500", Icon: Loader2, label: "실행 중" },
  idle: { cls: "bg-muted text-muted-foreground", Icon: RefreshCw, label: "대기" },
} as const;

const TYPE_LABEL: Record<string, string> = { s3: "Amazon S3", drive: "Google Drive", dropbox: "Dropbox", b2: "Backblaze B2", onedrive: "OneDrive", sftp: "SFTP", gcs: "Google Cloud", mega: "MEGA", webdav: "WebDAV" };

type Act = (body: Record<string, unknown>, msg: string) => void;

export function CloudTab() {
  const { data, refresh } = usePoll<CloudOverview>("/api/cloud", 4000);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ job?: CloudJob } | null>(null);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/cloud", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.ok) { toast.success(msg); refresh(); } else toast.error(json.error ?? "실패");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setDialog(null); }
  };

  const [remoteOpen, setRemoteOpen] = useState(false);
  const remotes = data?.remotes ?? [];
  const jobs = data?.jobs ?? [];

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{remotes.length}개 클라우드 원격</p>
          <Button size="sm" className="h-8 gap-1" onClick={() => setRemoteOpen(true)}><Plus className="size-4" /> 원격 연결</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {remotes.map((r) => <RemoteCard key={r.name} r={r} busy={busy} act={act} />)}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{jobs.length}개 클라우드 동기화 작업</p>
          <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({})}><Plus className="size-4" /> 작업 추가</Button>
        </div>
        <div className="space-y-3">
          {jobs.map((job) => {
            const st = STATUS[job.lastStatus];
            const pull = job.direction === "pull";
            return (
              <Card key={job.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <span className={cn("flex size-10 items-center justify-center rounded-lg", pull ? "bg-sky-500/15 text-sky-500" : "bg-violet-500/15 text-violet-500")}>
                      {pull ? <ArrowDownToLine className="size-5" /> : <ArrowUpFromLine className="size-5" />}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{job.name}</span>
                        <Badge variant="outline" className="text-[10px]">{job.operation}</Badge>
                        <Badge variant="secondary" className="text-[10px]">{SCHEDULE_LABEL[job.schedule]}</Badge>
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{pull ? <>{job.remote} → {job.localPath}</> : <>{job.localPath} → {job.remote}</>}</p>
                    </div>
                  </div>
                  <Badge className={cn("gap-1 border-0", st.cls)}><st.Icon className={cn("size-3.5", job.lastStatus === "running" && "animate-spin")} />{st.label}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div className="text-xs text-muted-foreground">
                    {job.lastRun ? <>마지막 {formatRelative(job.lastRun)} · {formatBytes(job.lastBytes)} · {job.lastFiles.toLocaleString()}개</> : "아직 실행되지 않음"}
                    {job.lastError && <span className="ml-1 text-red-500">· {job.lastError}</span>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => act({ kind: "job.run", id: job.id }, "동기화 실행됨")}><Play className="size-3.5" /> 실행</Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setDialog({ job })}><Pencil className="size-3.5" /> 편집</Button>
                    <Button size="icon" variant="ghost" className="size-7 text-destructive" disabled={busy} onClick={() => act({ kind: "job.delete", id: job.id }, "작업 삭제됨")}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>{dialog && <CloudJobDialog job={dialog.job} remotes={remotes} act={act} close={() => setDialog(null)} busy={busy} />}</DialogContent>
      </Dialog>
      <Dialog open={remoteOpen} onOpenChange={setRemoteOpen}>
        <DialogContent className="max-w-lg"><RemoteCreateDialog act={act} close={() => setRemoteOpen(false)} busy={busy} /></DialogContent>
      </Dialog>
    </div>
  );
}

function RemoteCard({ r, busy, act }: { r: RcloneRemote; busy: boolean; act: Act }) {
  const pct = r.usedBytes != null && r.totalBytes ? (r.usedBytes / r.totalBytes) * 100 : null;
  return (
    <Card className="group relative p-3">
      <button
        className="absolute right-2 top-2 hidden rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-destructive group-hover:block"
        disabled={busy}
        onClick={() => act({ kind: "remote.delete", name: r.name }, "원격 연결 해제됨")}
        aria-label="원격 삭제"
      >
        <Trash2 className="size-3.5" />
      </button>
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Cloud className="size-4" /></span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{r.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{TYPE_LABEL[r.type] ?? r.type}</p>
        </div>
      </div>
      {r.usedBytes != null && (
        <p className="mt-2 text-xs text-muted-foreground">{formatBytes(r.usedBytes)}{r.totalBytes ? ` / ${formatBytes(r.totalBytes)}` : ""}{pct != null ? ` · ${pct.toFixed(0)}%` : ""}</p>
      )}
    </Card>
  );
}

interface Field { key: string; label: string; kind?: "text" | "password" | "select"; placeholder?: string; options?: string[]; optional?: boolean }

const PROVIDER_FIELDS: { type: RcloneType; label: string; note?: string; fields: Field[] }[] = [
  {
    type: "s3",
    label: "S3 호환 (AWS · Wasabi · R2 · MinIO)",
    fields: [
      { key: "provider", label: "제공자", kind: "select", options: ["AWS", "Wasabi", "Backblaze", "Cloudflare", "DigitalOcean", "Minio", "Other"] },
      { key: "access_key_id", label: "Access Key ID" },
      { key: "secret_access_key", label: "Secret Access Key", kind: "password" },
      { key: "region", label: "Region", placeholder: "us-east-1", optional: true },
      { key: "endpoint", label: "Endpoint (S3 호환 시)", placeholder: "https://...", optional: true },
    ],
  },
  {
    type: "drive",
    label: "Google Drive",
    note: "client_id/secret는 선택이지만 권장됩니다. 서비스 계정 JSON 경로를 넣으면 무인 인증이 가능합니다. 비우면 호스트에서 `rclone config`로 OAuth 인증이 필요합니다.",
    fields: [
      { key: "client_id", label: "Client ID", optional: true },
      { key: "client_secret", label: "Client Secret", kind: "password", optional: true },
      { key: "scope", label: "Scope", placeholder: "drive", optional: true },
      { key: "service_account_file", label: "서비스 계정 JSON 경로", placeholder: "/etc/rclone/sa.json", optional: true },
    ],
  },
  { type: "b2", label: "Backblaze B2", fields: [{ key: "account", label: "Account ID / Key ID" }, { key: "key", label: "Application Key", kind: "password" }] },
  { type: "dropbox", label: "Dropbox", note: "토큰을 비우면 호스트에서 OAuth 인증이 필요합니다.", fields: [{ key: "token", label: "Token (JSON, 선택)", optional: true }] },
  { type: "onedrive", label: "OneDrive", note: "토큰을 비우면 호스트에서 OAuth 인증이 필요합니다.", fields: [{ key: "token", label: "Token (JSON, 선택)", optional: true }] },
  { type: "sftp", label: "SFTP", fields: [{ key: "host", label: "Host" }, { key: "user", label: "User" }, { key: "pass", label: "Password", kind: "password", optional: true }, { key: "key_file", label: "키 파일 경로", placeholder: "~/.ssh/id_ed25519", optional: true }, { key: "port", label: "Port", placeholder: "22", optional: true }] },
  { type: "webdav", label: "WebDAV", fields: [{ key: "url", label: "URL", placeholder: "https://..." }, { key: "vendor", label: "Vendor", kind: "select", options: ["nextcloud", "owncloud", "sharepoint", "other"] }, { key: "user", label: "User", optional: true }, { key: "pass", label: "Password", kind: "password", optional: true }] },
  { type: "mega", label: "MEGA", fields: [{ key: "user", label: "Email" }, { key: "pass", label: "Password", kind: "password" }] },
];

function RemoteCreateDialog({ act, close, busy }: { act: Act; close: () => void; busy: boolean }) {
  const [typeIdx, setTypeIdx] = useState(0);
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const provider = PROVIDER_FIELDS[typeIdx];
  const setVal = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const required = provider.fields.filter((f) => !f.optional);
  const valid = /^[A-Za-z0-9][A-Za-z0-9_\-]*$/.test(name) && required.every((f) => (values[f.key] ?? "").trim() || (f.kind === "select" && f.options?.length));

  return (
    <>
      <DialogHeader>
        <DialogTitle>클라우드 원격 연결</DialogTitle>
        <DialogDescription>S3, Google Drive 등 rclone 원격을 자격증명으로 연결합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDER_FIELDS.map((p, i) => (
            <button key={p.type} onClick={() => { setTypeIdx(i); setValues({}); }} className={cn("rounded-md border px-2 py-1.5 text-left text-xs transition-colors", i === typeIdx ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>
              {p.label}
            </button>
          ))}
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="원격 이름 (예: my-s3)" autoFocus />
        {provider.fields.map((f) => (
          <div key={f.key}>
            <p className="mb-1 text-xs text-muted-foreground">{f.label}{!f.optional && " *"}</p>
            {f.kind === "select" ? (
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={values[f.key] ?? f.options?.[0] ?? ""} onChange={(e) => setVal(f.key, e.target.value)}>
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <Input type={f.kind === "password" ? "password" : "text"} value={values[f.key] ?? ""} onChange={(e) => setVal(f.key, e.target.value)} placeholder={f.placeholder} />
            )}
          </div>
        ))}
        {provider.note && <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">{provider.note}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !valid} onClick={() => {
          const config: Record<string, string> = {};
          for (const f of provider.fields) {
            const v = (values[f.key] ?? (f.kind === "select" ? f.options?.[0] : "") ?? "").trim();
            if (v) config[f.key] = v;
          }
          act({ kind: "remote.create", name: name.trim(), type: provider.type, config }, "원격 연결됨");
        }}>연결</Button>
      </DialogFooter>
    </>
  );
}

function CloudJobDialog({ job, remotes, act, close, busy }: { job?: CloudJob; remotes: RcloneRemote[]; act: Act; close: () => void; busy: boolean }) {
  const [name, setName] = useState(job?.name ?? "");
  const [direction, setDirection] = useState<"pull" | "push">(job?.direction ?? "push");
  const [remote, setRemote] = useState(job?.remote ?? (remotes[0] ? `${remotes[0].name}:` : ""));
  const [localPath, setLocalPath] = useState(job?.localPath ?? "");
  const [operation, setOperation] = useState<"sync" | "copy">(job?.operation ?? "sync");
  const [schedule, setSchedule] = useState<SyncSchedule>(job?.schedule ?? "manual");
  const payload = { name: name.trim(), direction, remote: remote.trim(), localPath: localPath.trim(), operation, schedule };
  const valid = name.trim() && remote.includes(":") && localPath.trim();
  return (
    <>
      <DialogHeader><DialogTitle>{job ? "클라우드 작업 편집" : "클라우드 동기화 추가"}</DialogTitle><DialogDescription>rclone 으로 클라우드와 동기화합니다.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="작업 이름" autoFocus />
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={() => setDirection("pull")} className={cn("rounded-md border px-2 py-2 text-xs", direction === "pull" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>가져오기 (클라우드→로컬)</button>
          <button onClick={() => setDirection("push")} className={cn("rounded-md border px-2 py-2 text-xs", direction === "push" ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>보내기 (로컬→클라우드)</button>
        </div>
        <Input value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="remote:path (예: s3-backup:bucket/photos)" />
        <Input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/volume1/Photos" />
        <div className="flex items-center justify-between text-sm">
          <div className="flex gap-1.5">
            {(["sync", "copy"] as const).map((o) => <button key={o} onClick={() => setOperation(o)} className={cn("rounded-md border px-3 py-1 text-xs", operation === o ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent")}>{o}</button>)}
          </div>
          <select className="rounded-md border bg-background px-2 py-1 text-sm" value={schedule} onChange={(e) => setSchedule(e.target.value as SyncSchedule)}>
            {(["manual", "hourly", "daily", "weekly"] as SyncSchedule[]).map((s) => <option key={s} value={s}>{SCHEDULE_LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !valid} onClick={() => act(job ? { kind: "job.update", id: job.id, job: payload } : { kind: "job.create", job: payload }, job ? "저장됨" : "추가됨")}>저장</Button>
      </DialogFooter>
    </>
  );
}
