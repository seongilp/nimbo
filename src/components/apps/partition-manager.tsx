"use client";

import { useState } from "react";
import { AlertTriangle, HardDrive, Lock, Plus, Table2, Trash2, Wand2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";
import { usePoll } from "@/lib/hooks/use-poll";
import type { DiskTable, PartitionOverview, PartitionSlot } from "@/lib/types";

const SELECT_CLASS = "w-full rounded-md border bg-background px-3 py-2 text-sm";

const FSTYPES: Array<{ value: string; label: string }> = [
  { value: "ext4", label: "ext4 (권장)" },
  { value: "xfs", label: "XFS" },
  { value: "btrfs", label: "Btrfs" },
  { value: "f2fs", label: "F2FS" },
  { value: "exfat", label: "exFAT" },
  { value: "vfat", label: "FAT32" },
  { value: "ntfs", label: "NTFS" },
];

type Dialog =
  | { type: "table"; disk: DiskTable }
  | { type: "create"; disk: DiskTable }
  | { type: "format"; disk: DiskTable; slot: PartitionSlot }
  | { type: "delete"; disk: DiskTable; slot: PartitionSlot }
  | null;

type Act = (body: Record<string, unknown>, msg: string) => void;

/**
 * A destructive action is only enabled once the operator has typed the exact
 * device path — the same string the API requires in `confirm`.
 */
function ConfirmField({ expected, value, onChange }: { expected: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">
        확인을 위해 <span className="font-mono text-foreground">{expected}</span> 를 그대로 입력하세요
      </label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={expected} autoComplete="off" />
    </div>
  );
}

function DangerNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DiskCard({ disk, onAction }: { disk: DiskTable; onAction: (d: Dialog) => void }) {
  const locked = Boolean(disk.lockedReason);
  const freeBytes = disk.free.reduce((sum, f) => sum + f.sizeBytes, 0);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HardDrive className="size-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{disk.device}</span>
              <Badge variant="outline" className="text-[10px] uppercase">{disk.label ?? "테이블 없음"}</Badge>
              {locked && (
                <Badge className="gap-1 border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
                  <Lock className="size-3" />
                  잠김
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{disk.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tabular-nums">{formatBytes(disk.sizeBytes)}</span>
          <Button size="sm" variant="outline" disabled={locked} onClick={() => onAction({ type: "table", disk })}>
            <Table2 className="size-3.5" />
            테이블
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={locked || !disk.label || disk.free.length === 0}
            onClick={() => onAction({ type: "create", disk })}
          >
            <Plus className="size-3.5" />
            파티션
          </Button>
        </div>
      </div>

      {locked && (
        <p className="border-b bg-amber-500/5 px-4 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          {disk.lockedReason} 변경하려면 먼저 사용을 중지해야 합니다.
        </p>
      )}

      <div className="divide-y">
        {disk.partitions.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {disk.label ? "파티션이 없습니다." : "파티션 테이블이 없습니다. 먼저 테이블을 만드세요."}
          </p>
        )}
        {disk.partitions.map((slot) => (
          <div key={slot.device} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{slot.device}</span>
                <Badge variant="secondary" className="text-[10px] font-normal">{slot.fstype ?? "포맷 없음"}</Badge>
                {slot.label && <span className="truncate text-xs text-muted-foreground">{slot.label}</span>}
                {slot.mountpoint && <span className="text-xs text-muted-foreground">→ {slot.mountpoint}</span>}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatBytes(slot.sizeBytes)} · {slot.typeName}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={locked || Boolean(slot.mountpoint)}
                onClick={() => onAction({ type: "format", disk, slot })}
              >
                <Wand2 className="size-3.5" />
                포맷
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={locked || Boolean(slot.mountpoint)}
                onClick={() => onAction({ type: "delete", disk, slot })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {disk.free.length > 0 && (
        <p className="border-t bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
          빈 공간 {formatBytes(freeBytes)} ({disk.free.length}개 영역)
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function TableDialog({ disk, busy, act, onClose }: { disk: DiskTable; busy: boolean; act: Act; onClose: () => void }) {
  const [label, setLabel] = useState<"gpt" | "dos">("gpt");
  const [confirm, setConfirm] = useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>파티션 테이블 만들기</DialogTitle>
        <DialogDescription>{disk.device} 의 파티션 구조를 새로 만듭니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <DangerNote>
          이 디스크의 <strong>모든 데이터가 삭제</strong>됩니다. 되돌릴 수 없습니다.
        </DangerNote>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">형식</label>
          <select className={SELECT_CLASS} value={label} onChange={(e) => setLabel(e.target.value as "gpt" | "dos")}>
            <option value="gpt">GPT (권장 · 2TB 초과 지원)</option>
            <option value="dos">MBR / DOS (레거시 호환)</option>
          </select>
        </div>
        <ConfirmField expected={disk.device} value={confirm} onChange={setConfirm} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button
          variant="destructive"
          disabled={busy || confirm.trim() !== disk.device}
          onClick={() => {
            act({ kind: "table.create", device: disk.device, label, confirm: confirm.trim() }, "파티션 테이블을 만들었습니다.");
            onClose();
          }}
        >
          지우고 만들기
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CreateDialog({ disk, support, busy, act, onClose }: {
  disk: DiskTable;
  support: Record<string, boolean>;
  busy: boolean;
  act: Act;
  onClose: () => void;
}) {
  const largestFree = Math.max(0, ...disk.free.map((f) => f.sizeBytes));
  const maxMiB = Math.floor(largestFree / (1024 * 1024));
  const [useAll, setUseAll] = useState(true);
  const [sizeMiB, setSizeMiB] = useState(String(maxMiB));
  const [fstype, setFstype] = useState("ext4");
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState("");

  const size = Number(sizeMiB);
  const sizeValid = useAll || (Number.isFinite(size) && size >= 1 && size <= maxMiB);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>파티션 만들기</DialogTitle>
        <DialogDescription>
          {disk.device} 의 빈 공간에 새 파티션을 추가합니다 (사용 가능 {formatBytes(largestFree)}).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">크기</label>
          <select className={SELECT_CLASS} value={useAll ? "all" : "custom"} onChange={(e) => setUseAll(e.target.value === "all")}>
            <option value="all">남은 공간 전체 사용</option>
            <option value="custom">직접 지정 (MiB)</option>
          </select>
          {!useAll && (
            <Input
              className="mt-2"
              value={sizeMiB}
              onChange={(e) => setSizeMiB(e.target.value)}
              placeholder={`1 ~ ${maxMiB}`}
              inputMode="numeric"
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">파일시스템 (선택)</label>
          <select className={SELECT_CLASS} value={fstype} onChange={(e) => setFstype(e.target.value)}>
            <option value="">포맷하지 않음</option>
            {FSTYPES.map((f) => (
              <option key={f.value} value={f.value} disabled={support[f.value] === false}>
                {f.label}
                {support[f.value] === false ? " — mkfs 미설치" : ""}
              </option>
            ))}
          </select>
        </div>
        {fstype && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">볼륨 레이블 (선택)</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="data" />
          </div>
        )}
        <ConfirmField expected={disk.device} value={confirm} onChange={setConfirm} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button
          disabled={busy || !sizeValid || confirm.trim() !== disk.device}
          onClick={() => {
            act(
              {
                kind: "partition.create",
                device: disk.device,
                sizeMiB: useAll ? undefined : size,
                fstype: fstype || undefined,
                label: label.trim() || undefined,
                confirm: confirm.trim(),
              },
              "파티션을 만들었습니다."
            );
            onClose();
          }}
        >
          만들기
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function FormatDialog({ slot, support, busy, act, onClose }: {
  slot: PartitionSlot;
  support: Record<string, boolean>;
  busy: boolean;
  act: Act;
  onClose: () => void;
}) {
  const [fstype, setFstype] = useState("ext4");
  const [label, setLabel] = useState(slot.label ?? "");
  const [confirm, setConfirm] = useState("");

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>파티션 포맷</DialogTitle>
        <DialogDescription>{slot.device} ({formatBytes(slot.sizeBytes)}) 을(를) 새 파일시스템으로 만듭니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <DangerNote>
          이 파티션의 <strong>모든 데이터가 삭제</strong>됩니다.
        </DangerNote>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">파일시스템</label>
          <select className={SELECT_CLASS} value={fstype} onChange={(e) => setFstype(e.target.value)}>
            {FSTYPES.map((f) => (
              <option key={f.value} value={f.value} disabled={support[f.value] === false}>
                {f.label}
                {support[f.value] === false ? " — mkfs 미설치" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">볼륨 레이블 (선택)</label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="data" />
        </div>
        <ConfirmField expected={slot.device} value={confirm} onChange={setConfirm} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button
          variant="destructive"
          disabled={busy || confirm.trim() !== slot.device}
          onClick={() => {
            act(
              { kind: "partition.format", device: slot.device, fstype, label: label.trim() || undefined, confirm: confirm.trim() },
              "포맷했습니다."
            );
            onClose();
          }}
        >
          포맷
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DeleteDialog({ disk, slot, busy, act, onClose }: {
  disk: DiskTable;
  slot: PartitionSlot;
  busy: boolean;
  act: Act;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>파티션 삭제</DialogTitle>
        <DialogDescription>{slot.device} 를 파티션 테이블에서 제거합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <DangerNote>
          파티션에 들어 있던 <strong>데이터에 접근할 수 없게 됩니다.</strong>
        </DangerNote>
        <ConfirmField expected={disk.device} value={confirm} onChange={setConfirm} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button
          variant="destructive"
          disabled={busy || confirm.trim() !== disk.device}
          onClick={() => {
            act({ kind: "partition.delete", device: disk.device, number: slot.number, confirm: confirm.trim() }, "파티션을 삭제했습니다.");
            onClose();
          }}
        >
          삭제
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------

export function PartitionManager() {
  const { data, loading, refresh } = usePoll<PartitionOverview>("/api/partitions", 10_000);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, successMsg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/partitions", {
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
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const support = data?.mkfsSupport ?? {};

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-3 p-4">
          {data?.toolInstalled === false && (
            <DangerNote>sfdisk(util-linux)가 설치되어 있지 않아 파티셔닝을 사용할 수 없습니다.</DangerNote>
          )}
          {(data?.disks ?? []).length === 0 && (
            <p className="px-1 py-3 text-sm text-muted-foreground">파티셔닝 가능한 디스크가 없습니다.</p>
          )}
          {(data?.disks ?? []).map((disk) => (
            <DiskCard key={disk.device} disk={disk} onAction={setDialog} />
          ))}
        </div>
      </ScrollArea>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog?.type === "table" && <TableDialog disk={dialog.disk} busy={busy} act={act} onClose={() => setDialog(null)} />}
        {dialog?.type === "create" && (
          <CreateDialog disk={dialog.disk} support={support} busy={busy} act={act} onClose={() => setDialog(null)} />
        )}
        {dialog?.type === "format" && (
          <FormatDialog slot={dialog.slot} support={support} busy={busy} act={act} onClose={() => setDialog(null)} />
        )}
        {dialog?.type === "delete" && (
          <DeleteDialog disk={dialog.disk} slot={dialog.slot} busy={busy} act={act} onClose={() => setDialog(null)} />
        )}
      </Dialog>
    </>
  );
}
