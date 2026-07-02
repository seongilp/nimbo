"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu as Chip,
  Clock,
  Download,
  HardDrive,
  MapPin,
  Search,
  Thermometer,
  Trash2,
  Upload,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes, formatRelative } from "@/lib/format";
import type {
  DiskFault,
  DiskHistoryEntry,
  DiskHistoryOverview,
  DiskInventoryItem,
  DiskInventoryOverview,
  ZfsDevice,
} from "@/lib/types";

const TRANSPORT_LABEL: Record<string, string> = {
  sata: "SATA", sas: "SAS", usb: "USB", nvme: "NVMe", iscsi: "iSCSI", virtio: "virtio", unknown: "—",
};
const TYPE_LABEL: Record<string, string> = { hdd: "HDD", ssd: "SSD", nvme: "NVMe", unknown: "Disk" };

const SMART_BADGE = {
  passed: { label: "정상", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
  warning: { label: "경고", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400", Icon: AlertTriangle },
  failed: { label: "실패", className: "bg-red-500/15 text-red-600 dark:text-red-400", Icon: XCircle },
  unknown: { label: "알 수 없음", className: "bg-muted text-muted-foreground", Icon: AlertTriangle },
} as const;

const FAULT_DOT: Record<DiskFault, string> = {
  ok: "bg-emerald-500", warning: "bg-amber-500", critical: "bg-red-500",
};
const ZFS_STATE_CLASS: Record<string, string> = {
  ONLINE: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  DEGRADED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  FAULTED: "bg-red-500/15 text-red-600 dark:text-red-400",
  OFFLINE: "bg-slate-500/15 text-slate-500",
  UNAVAIL: "bg-red-500/15 text-red-600 dark:text-red-400",
  REMOVED: "bg-slate-500/15 text-slate-500",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

function DiskItemCard({ item, onEditLocation, onReplace }: {
  item: DiskInventoryItem;
  onEditLocation: (item: DiskInventoryItem) => void;
  onReplace: (item: DiskInventoryItem) => void;
}) {
  const { disk, zfs, location, fault, faultReasons } = item;
  const smart = SMART_BADGE[disk.smartStatus];
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`size-2.5 shrink-0 rounded-full ${FAULT_DOT[fault]}`} title={fault} />
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {disk.type === "nvme" ? <Chip className="size-5" /> : <HardDrive className="size-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{disk.device}</span>
              <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[disk.type]}</Badge>
              <Badge variant="secondary" className="text-[10px] font-normal">{TRANSPORT_LABEL[disk.transport]}</Badge>
              {location && (
                <Badge className="gap-1 border-0 bg-sky-500/15 text-[10px] text-sky-600 dark:text-sky-400">
                  <MapPin className="size-3" />{location.label || location.bay}
                </Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{disk.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {disk.temperatureC != null && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Thermometer className="size-3.5" />{disk.temperatureC}°C
            </span>
          )}
          <Badge className={`gap-1 border-0 font-medium ${smart.className}`}>
            <smart.Icon className="size-3.5" />{smart.label}
          </Badge>
          {zfs && (
            <Badge className={`border-0 font-medium ${ZFS_STATE_CLASS[zfs.state] ?? "bg-muted"}`}>
              {zfs.pool} · {zfs.state}
            </Badge>
          )}
          <span className="text-sm font-medium tabular-nums">{formatBytes(disk.sizeBytes)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 px-4 py-3 sm:grid-cols-2">
        <Row label="Serial" value={disk.serial ?? "—"} />
        <Row label="WWN" value={disk.wwn ?? "—"} />
        <Row label="펌웨어" value={disk.firmware ?? "—"} />
        <Row label="회전수" value={disk.rotationRpm ? `${disk.rotationRpm} RPM` : disk.rotationRpm === 0 ? "SSD" : "—"} />
        <Row label="가동시간" value={disk.powerOnHours != null ? `${disk.powerOnHours.toLocaleString()} h` : "—"} />
        <Row label="슬롯 힌트" value={disk.hctl ?? disk.byPath?.split("/").pop() ?? "—"} />
        {(disk.reallocatedSectors ?? 0) > 0 && <Row label="재할당 섹터" value={<span className="text-amber-500">{disk.reallocatedSectors}</span>} />}
        {(disk.pendingSectors ?? 0) > 0 && <Row label="대기 섹터" value={<span className="text-amber-500">{disk.pendingSectors}</span>} />}
        {zfs && <Row label="ZFS 역할" value={`${zfs.pool}/${zfs.vdev} · ${zfs.role}`} />}
        {zfs && (zfs.readErrors + zfs.writeErrors + zfs.cksumErrors) > 0 && (
          <Row label="ZFS 에러 (R/W/C)" value={<span className="text-amber-500">{zfs.readErrors}/{zfs.writeErrors}/{zfs.cksumErrors}</span>} />
        )}
      </div>

      {fault !== "ok" && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-amber-500/5 px-4 py-2 text-xs">
          <AlertTriangle className={`size-3.5 ${fault === "critical" ? "text-red-500" : "text-amber-500"}`} />
          <span className="text-muted-foreground">{faultReasons.join(" · ")}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onEditLocation(item)}>
          <MapPin className="size-3.5" /> 위치 편집
        </Button>
        {zfs && fault !== "ok" && (
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => onReplace(item)}>
            <Wrench className="size-3.5" /> 교체 마법사
          </Button>
        )}
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------
function LocationDialog({ item, onClose, onSaved }: {
  item: DiskInventoryItem | null; onClose: () => void; onSaved: () => void;
}) {
  // Keyed by stableId in the parent, so initial state is fresh per disk.
  const [label, setLabel] = useState(item?.location?.label ?? "");
  const [bay, setBay] = useState(item?.location?.bay ?? "");
  const [note, setNote] = useState(item?.location?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!item) return;
    setBusy(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "location.set", stableId: item.disk.stableId, label, bay, note }),
      });
      const j = await res.json();
      if (j.ok) { toast.success("위치를 저장했습니다"); onSaved(); onClose(); }
      else toast.error(j.error ?? "저장 실패");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>물리 위치 · {item?.disk.model}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs text-muted-foreground">라벨</label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: Bay 1" /></div>
          <div><label className="mb-1 block text-xs text-muted-foreground">베이/슬롯</label><Input value={bay} onChange={(e) => setBay(e.target.value)} placeholder="예: 1" /></div>
          <div><label className="mb-1 block text-xs text-muted-foreground">메모</label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 전면 상단" /></div>
          <p className="text-[11px] text-muted-foreground">stableId <span className="font-mono">{item?.disk.stableId}</span> 로 저장됩니다 (재부팅해도 유지).</p>
          <Button className="w-full" disabled={busy} onClick={save}>저장</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
function ReplaceWizard({ item, onClose }: { item: DiskInventoryItem | null; onClose: () => void }) {
  const [devices, setDevices] = useState<ZfsDevice[]>([]);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);

  // Keyed by stableId in the parent → step/picked start fresh; effect only fetches.
  useEffect(() => {
    if (!item) return;
    fetch("/api/zfs").then((r) => r.json()).then((j) => {
      if (j.ok) setDevices((j.data.availableDevices ?? []).filter((d: ZfsDevice) => !d.inUse));
    }).catch(() => {});
  }, [item]);

  if (!item || !item.zfs) return null;
  const zfs = item.zfs;

  async function zaction(body: Record<string, unknown>, msg: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/zfs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (j.ok) { toast.success(msg); return true; }
      toast.error(j.error ?? "작업 실패"); return false;
    } catch (e) { toast.error((e as Error).message); return false; }
    finally { setBusy(false); }
  }

  const steps = ["식별", "오프라인", "물리 교체", "완료"];
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="size-4" /> 디스크 교체 마법사</DialogTitle></DialogHeader>

        <div className="mb-3 flex items-center gap-1.5">
          {steps.map((s, i) => (
            <div key={s} className={`flex-1 rounded-full py-1 text-center text-[11px] ${i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{s}</div>
          ))}
        </div>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <Row label="풀 / vdev" value={`${zfs.pool} / ${zfs.vdev}`} />
            <Row label="멤버" value={<span className="font-mono">{zfs.member}</span>} />
            <Row label="위치" value={item.location?.label || item.location?.bay || "미지정"} />
            <Row label="상태" value={<span className="text-red-500">{zfs.state}</span>} />
          </div>

          {step === 0 && (
            <>
              <p className="text-muted-foreground">위 멤버가 장애 디스크입니다. 물리 위치(<b>{item.location?.label || "위치 미지정 — 먼저 위치를 등록하세요"}</b>)를 확인한 뒤 진행하세요.</p>
              <Button className="w-full" onClick={() => setStep(1)}>다음: 오프라인</Button>
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-muted-foreground">디스크를 물리적으로 뽑기 전, ZFS에서 오프라인 처리합니다.</p>
              <Button className="w-full" disabled={busy} onClick={async () => {
                if (await zaction({ kind: "device.offline", name: zfs.pool, device: zfs.member }, "오프라인 처리됨")) setStep(2);
              }}>오프라인 전환</Button>
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-muted-foreground"><b>{item.location?.label || "해당 베이"}</b>의 디스크를 뽑고 새 디스크를 삽입한 뒤, 아래에서 새 디스크를 선택하고 교체를 실행하세요.</p>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={picked} onChange={(e) => setPicked(e.target.value)}>
                <option value="">새 디스크 선택…</option>
                {devices.map((d) => <option key={d.path} value={d.path}>{d.name} · {d.model} · {formatBytes(d.sizeBytes)}</option>)}
              </select>
              {devices.length === 0 && <p className="text-[11px] text-muted-foreground">사용 가능한 새 디스크가 없습니다. 삽입 후 목록이 갱신됩니다.</p>}
              <Button className="w-full" disabled={busy || !picked} onClick={async () => {
                if (await zaction({ kind: "device.replace", name: zfs.pool, oldDevice: zfs.member, newDevice: picked }, "교체(replace) 시작 — 리실버 진행")) setStep(3);
              }}>교체 실행 (replace)</Button>
            </>
          )}
          {step === 3 && (
            <>
              <p className="text-muted-foreground">교체가 시작되어 리실버가 진행됩니다. 진행률은 ZFS 앱에서 확인하세요. 완료 후 에러 카운터를 초기화합니다.</p>
              <Button variant="secondary" className="w-full" disabled={busy} onClick={async () => {
                await zaction({ kind: "pool.clear", name: zfs.pool }, "에러 카운터 초기화됨");
              }}>에러 초기화 (clear)</Button>
              <Button className="w-full" onClick={onClose}>닫기</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
const HISTORY_BADGE: Record<string, { label: string; className: string }> = {
  added: { label: "추가", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  removed: { label: "제거", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
  moved: { label: "이동", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  smart: { label: "SMART", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  zfs: { label: "ZFS", className: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
};

function HistoryTab() {
  const { data, loading, refresh } = usePoll<DiskHistoryOverview>("/api/inventory?view=history", 15000);
  const [q, setQ] = useState("");
  const entries = useMemo(() => {
    const list = data?.entries ?? [];
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter((e) => e.model.toLowerCase().includes(s) || e.detail.toLowerCase().includes(s) || e.kind.includes(s));
  }, [data, q]);

  async function clearAll() {
    await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "history.clear" }) });
    toast.success("이력을 지웠습니다"); refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이력 검색…" className="h-8 pl-8" />
        </div>
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={clearAll}><Trash2 className="size-3.5" /> 지우기</Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {loading && !data ? (
          <div className="space-y-2 p-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">기록된 디스크 변경이 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {entries.map((e: DiskHistoryEntry) => {
                const b = HISTORY_BADGE[e.kind] ?? { label: e.kind, className: "bg-muted" };
                return (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="w-16 px-3 py-2"><Badge className={`border-0 text-[10px] ${b.className}`}>{b.label}</Badge></td>
                    <td className="px-2 py-2">
                      <div className="font-medium">{e.detail}</div>
                      <div className="text-xs text-muted-foreground">{e.model}</div>
                    </td>
                    <td className="w-24 px-3 py-2 text-right text-xs text-muted-foreground">
                      <span className="flex items-center justify-end gap-1"><Clock className="size-3" />{formatRelative(e.ts)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}

// --------------------------------------------------------------------------
function downloadBlob(name: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula injection (a cell starting with = + - @ or a
  // control char is executed as a formula by Excel/Sheets) by prefixing a quote.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function DiskInventory() {
  const { data, loading, refresh } = usePoll<DiskInventoryOverview>("/api/inventory", 8000);
  const [locItem, setLocItem] = useState<DiskInventoryItem | null>(null);
  const [replaceItem, setReplaceItem] = useState<DiskInventoryItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const items = data?.disks ?? [];
  const faults = items.filter((i) => i.fault !== "ok");

  const stamp = () => new Date().toISOString().slice(0, 10);

  async function exportJson() {
    setBusy(true);
    try {
      const res = await fetch("/api/inventory?view=export", { cache: "no-store" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "내보내기 실패");
      downloadBlob(`nimbo-disk-inventory-${stamp()}.json`, "application/json", JSON.stringify(j.data, null, 2));
      toast.success("인벤토리를 JSON으로 내보냈습니다");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const cols = ["device", "model", "serial", "wwn", "transport", "sizeBytes", "smart", "tempC", "pool", "vdev", "zfsState", "fault", "label", "bay", "note"];
    const rows = items.map((it) => {
      const d = it.disk;
      return [
        d.device, d.model, d.serial, d.wwn, d.transport, d.sizeBytes,
        d.smartStatus, d.temperatureC,
        it.zfs?.pool, it.zfs?.vdev, it.zfs?.state,
        it.fault, it.location?.label, it.location?.bay, it.location?.note,
      ].map(csvCell).join(",");
    });
    downloadBlob(`nimbo-disk-inventory-${stamp()}.csv`, "text/csv;charset=utf-8", [cols.join(","), ...rows].join("\n"));
    toast.success("인벤토리를 CSV로 내보냈습니다");
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "location.import", locations: parsed, mode: "merge" }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "가져오기 실패");
      toast.success(`위치 정보 ${j.applied}개를 가져왔습니다${j.skipped ? ` (건너뜀 ${j.skipped})` : ""}`);
      refresh();
    } catch (e) {
      toast.error(`가져오기 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const list = (rows: DiskInventoryItem[], empty: string) => (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 p-4">
        {loading && !data
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)
          : rows.length === 0
            ? <p className="p-6 text-center text-sm text-muted-foreground">{empty}</p>
            : rows.map((it) => (
                <DiskItemCard key={it.disk.stableId} item={it} onEditLocation={setLocItem} onReplace={setReplaceItem} />
              ))}
      </div>
    </ScrollArea>
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="inventory" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="inventory"><HardDrive className="size-3.5" /> 인벤토리</TabsTrigger>
            <TabsTrigger value="faults">
              <AlertTriangle className="size-3.5" /> 결함
              {faults.length > 0 && <Badge className="ml-1 border-0 bg-red-500/20 px-1.5 text-[10px] text-red-500">{faults.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="history"><Clock className="size-3.5" /> 이력</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1.5">
            {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={busy}>
                  <Download className="size-3.5" /> 내보내기
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportJson}>JSON (전체 + 위치 백업)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCsv}>CSV (표 · 스프레드시트)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 text-xs"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-3.5" /> 가져오기
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onImportFile} />
          </div>
        </div>

        <TabsContent value="inventory" className="m-0 flex min-h-0 flex-1 flex-col">{list(items, "디스크가 없습니다.")}</TabsContent>
        <TabsContent value="faults" className="m-0 flex min-h-0 flex-1 flex-col">{list(faults, "결함이 있는 디스크가 없습니다. 모두 정상입니다. ✓")}</TabsContent>
        <TabsContent value="history" className="m-0 flex min-h-0 flex-1 flex-col"><HistoryTab /></TabsContent>
      </Tabs>

      <LocationDialog key={locItem?.disk.stableId ?? "loc-none"} item={locItem} onClose={() => setLocItem(null)} onSaved={refresh} />
      <ReplaceWizard key={replaceItem?.disk.stableId ?? "rep-none"} item={replaceItem} onClose={() => { setReplaceItem(null); refresh(); }} />
    </div>
  );
}
