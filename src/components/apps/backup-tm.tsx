"use client";

import { useState } from "react";
import { HardDriveDownload, Plus, Trash2, Clipboard, Laptop } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TimeMachineOverview } from "@/lib/types";

type Act = (body: Record<string, unknown>, msg: string) => void;

export function TimeMachineTab() {
  const { data, refresh } = usePoll<TimeMachineOverview>("/api/timemachine", 4000);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/timemachine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.ok) { toast.success(msg); refresh(); } else toast.error(json.error ?? "실패");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setDialog(false); }
  };

  if (!data) return <div className="p-4 text-sm text-muted-foreground">불러오는 중…</div>;

  return (
    <div className="space-y-3 p-4">
      <Card className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span className={cn("flex size-10 items-center justify-center rounded-lg", data.enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")}><HardDriveDownload className="size-5" /></span>
          <div>
            <p className="text-sm font-medium">Time Machine 백업 {data.enabled ? "활성" : "비활성"}</p>
            <p className="text-xs text-muted-foreground">macOS 가 SMB 로 이 NAS 에 Time Machine 백업</p>
          </div>
        </div>
        <Switch checked={data.enabled} disabled={busy} onCheckedChange={(v) => act({ kind: "tm.toggle", enabled: v }, v ? "Time Machine 활성화" : "비활성화")} />
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{data.targets.length}개 백업 대상</p>
        <Button size="sm" className="h-8 gap-1" onClick={() => setDialog(true)}><Plus className="size-4" /> 대상 추가</Button>
      </div>

      <div className="space-y-2">
        {data.targets.map((t) => {
          const pct = t.quotaBytes ? (t.usedBytes / t.quotaBytes) * 100 : null;
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Laptop className="size-4" /></span>
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{t.path}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={t.enabled} disabled={busy} onCheckedChange={(v) => act({ kind: "target.toggle", id: t.id, enabled: v }, v ? "활성화" : "비활성화")} />
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" disabled={busy} onClick={() => act({ kind: "target.delete", id: t.id }, "대상 삭제됨")}><Trash2 className="size-4" /></Button>
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>{formatBytes(t.usedBytes)} 사용{t.quotaBytes ? ` / ${formatBytes(t.quotaBytes)} 할당` : " · 무제한"}</span>
                  {pct != null && <span>{pct.toFixed(0)}%</span>}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct ?? 12}%` }} /></div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">생성된 smb.conf</p>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { navigator.clipboard?.writeText(data.generatedConf); toast.success("복사됨"); }}><Clipboard className="size-3.5" /> 복사</Button>
        </div>
        <pre className="max-h-56 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{data.generatedConf}</pre>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent><TmTargetDialog act={act} close={() => setDialog(false)} busy={busy} /></DialogContent>
      </Dialog>
    </div>
  );
}

function TmTargetDialog({ act, close, busy }: { act: Act; close: () => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [quota, setQuota] = useState("");
  const quotaBytes = quota.trim() ? Number(quota) * 1024 ** 4 : null;
  return (
    <>
      <DialogHeader><DialogTitle>Time Machine 대상 추가</DialogTitle><DialogDescription>새 백업 공유를 만듭니다.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="대상 이름 (예: 맥북 백업)" autoFocus />
        <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/volume1/TimeMachine" />
        <Input value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="할당 용량 TB (비우면 무제한)" type="number" />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !name.trim() || !path.trim()} onClick={() => act({ kind: "target.create", target: { name: name.trim(), path: path.trim(), quotaBytes } }, "대상 추가됨")}>추가</Button>
      </DialogFooter>
    </>
  );
}
