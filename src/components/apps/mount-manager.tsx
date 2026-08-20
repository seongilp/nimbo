"use client";

import { useState } from "react";
import { HardDrive, Link2, Network, Plus, Trash2, Unlink } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { formatBytes } from "@/lib/format";
import { usePoll } from "@/lib/hooks/use-poll";
import type { BlockVolume, MountEntry, MountOverview } from "@/lib/types";

const SELECT_CLASS = "w-full rounded-md border bg-background px-3 py-2 text-sm";

/** Filesystems offered in the "mount as" dropdown, with a human label. */
const FSTYPE_OPTIONS: Array<{ value: string; label: string; support?: string }> = [
  { value: "ext4", label: "ext4", support: "ext4" },
  { value: "xfs", label: "XFS", support: "xfs" },
  { value: "btrfs", label: "Btrfs", support: "btrfs" },
  { value: "ntfs", label: "NTFS (Windows)", support: "ntfs" },
  { value: "exfat", label: "exFAT", support: "exfat" },
  { value: "vfat", label: "FAT32", support: "vfat" },
  { value: "f2fs", label: "F2FS" },
  { value: "hfsplus", label: "HFS+ (macOS)" },
  { value: "iso9660", label: "ISO9660 (CD/DVD)" },
];

type Dialog =
  | { type: "mount"; volume: BlockVolume }
  | { type: "remote" }
  | { type: "confirm"; title: string; desc: string; danger?: boolean; onConfirm: () => void }
  | null;

export type MountAct = (body: Record<string, unknown>, msg: string) => void;

function suggestMountpoint(volume: BlockVolume, roots: string[]): string {
  const root = roots[0] ?? "/mnt";
  const slug = (volume.label || volume.device.split("/").pop() || "volume")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .toLowerCase();
  return `${root}/${slug}`;
}

// ---------------------------------------------------------------------------

function VolumeRow({ volume, onMount }: { volume: BlockVolume; onMount: (v: BlockVolume) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{volume.device}</span>
          <Badge variant="secondary" className="text-[10px] font-normal">{volume.fstype ?? "포맷 없음"}</Badge>
          {volume.label && <span className="truncate text-xs text-muted-foreground">{volume.label}</span>}
          {volume.inFstab && <Badge variant="outline" className="text-[10px]">fstab</Badge>}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatBytes(volume.sizeBytes)}
          {volume.mountpoint ? ` · ${volume.mountpoint} 에 마운트됨` : volume.claimedBy ? ` · ${volume.claimedBy}` : " · 마운트 안 됨"}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={Boolean(volume.mountpoint) || Boolean(volume.claimedBy) || !volume.fstype}
        onClick={() => onMount(volume)}
      >
        <Link2 className="size-3.5" />
        마운트
      </Button>
    </div>
  );
}

function MountRow({ mount, onUnmount, onForget }: { mount: MountEntry; onUnmount: (m: MountEntry) => void; onForget: (m: MountEntry) => void }) {
  const notMounted = mount.options === "(not mounted)";
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-sm">{mount.mountpoint}</span>
          <Badge variant="secondary" className="text-[10px] font-normal">{mount.fstype}</Badge>
          {mount.remote && <Badge variant="outline" className="text-[10px]">원격</Badge>}
          {mount.persistent && <Badge variant="outline" className="text-[10px]">부팅 시 자동</Badge>}
          {notMounted && <Badge className="border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">미마운트</Badge>}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {mount.device}
          {!notMounted && ` · ${mount.options}`}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {!notMounted && (
          <Button size="sm" variant="outline" onClick={() => onUnmount(mount)}>
            <Unlink className="size-3.5" />
            해제
          </Button>
        )}
        {mount.persistent && mount.managed && (
          <Button size="sm" variant="ghost" onClick={() => onForget(mount)} title="fstab 항목 삭제">
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MountDialog({ volume, data, busy, act, onClose }: {
  volume: BlockVolume;
  data: MountOverview;
  busy: boolean;
  act: MountAct;
  onClose: () => void;
}) {
  const [mountpoint, setMountpoint] = useState(() => suggestMountpoint(volume, data.mountRoots));
  const [fstype, setFstype] = useState(volume.fstype ?? "ext4");
  const [readOnly, setReadOnly] = useState(false);
  const [persist, setPersist] = useState(true);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>볼륨 마운트</DialogTitle>
        <DialogDescription>
          {volume.device} ({formatBytes(volume.sizeBytes)}) 을(를) 지정한 경로에 연결합니다.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">마운트 지점</label>
          <Input value={mountpoint} onChange={(e) => setMountpoint(e.target.value)} placeholder="/mnt/data" />
          <p className="mt-1 text-[11px] text-muted-foreground">
            허용 위치: {data.mountRoots.join(", ")} 하위
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">파일시스템</label>
          <select className={SELECT_CLASS} value={fstype} onChange={(e) => setFstype(e.target.value)}>
            {FSTYPE_OPTIONS.map((o) => {
              const unsupported = o.support ? data.support[o.support] === false : false;
              return (
                <option key={o.value} value={o.value} disabled={unsupported}>
                  {o.label}
                  {unsupported ? " — 미설치" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">읽기 전용</span>
          <Switch checked={readOnly} onCheckedChange={setReadOnly} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">부팅 시 자동 마운트</span>
            <p className="text-[11px] text-muted-foreground">/etc/fstab 에 UUID 기준으로 기록합니다.</p>
          </div>
          <Switch checked={persist} onCheckedChange={setPersist} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button
          disabled={busy || !mountpoint.trim()}
          onClick={() => {
            act(
              { kind: "mount", device: volume.device, mountpoint: mountpoint.trim(), fstype, readOnly, persist },
              `${mountpoint} 에 마운트했습니다.`
            );
            onClose();
          }}
        >
          마운트
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function RemoteDialog({ data, busy, act, onClose }: { data: MountOverview; busy: boolean; act: MountAct; onClose: () => void }) {
  const [protocol, setProtocol] = useState<"cifs" | "nfs">("cifs");
  const [server, setServer] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [mountpoint, setMountpoint] = useState(`${data.mountRoots[0] ?? "/mnt"}/`);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [persist, setPersist] = useState(true);

  const helperMissing = protocol === "cifs" ? data.support.cifs === false : data.support.nfs === false;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>네트워크 스토리지 연결</DialogTitle>
        <DialogDescription>Synology·다른 NAS의 SMB/NFS 공유를 이 서버에 마운트합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">프로토콜</label>
          <select className={SELECT_CLASS} value={protocol} onChange={(e) => setProtocol(e.target.value as "cifs" | "nfs")}>
            <option value="cifs">SMB / CIFS (Windows · Synology 공유 폴더)</option>
            <option value="nfs">NFS</option>
          </select>
          {helperMissing && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              {protocol === "cifs" ? "cifs-utils" : "nfs-common"} 패키지가 설치되어 있지 않습니다.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">서버</label>
            <Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="192.168.0.20" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {protocol === "cifs" ? "공유 이름" : "내보내기 경로"}
            </label>
            <Input
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              placeholder={protocol === "cifs" ? "photo" : "/volume1/photo"}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">마운트 지점</label>
          <Input value={mountpoint} onChange={(e) => setMountpoint(e.target.value)} placeholder="/mnt/synology" />
        </div>
        {protocol === "cifs" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">사용자 (비우면 게스트)</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">비밀번호</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm">읽기 전용</span>
          <Switch checked={readOnly} onCheckedChange={setReadOnly} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">부팅 시 자동 마운트</span>
            {protocol === "cifs" && username && (
              <p className="text-[11px] text-muted-foreground">
                비밀번호는 fstab이 아니라 0600 권한의 자격 증명 파일에 저장됩니다.
              </p>
            )}
          </div>
          <Switch checked={persist} onCheckedChange={setPersist} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button
          disabled={busy || !server.trim() || !remotePath.trim() || !mountpoint.trim()}
          onClick={() => {
            act(
              {
                kind: "remote.mount",
                protocol,
                server: server.trim(),
                remotePath: remotePath.trim(),
                mountpoint: mountpoint.trim(),
                username: username.trim() || undefined,
                password: password || undefined,
                readOnly,
                persist,
              },
              `${mountpoint} 에 연결했습니다.`
            );
            onClose();
          }}
        >
          연결
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------

export function MountManager() {
  const { data, loading, refresh } = usePoll<MountOverview>("/api/mounts", 8000);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const act: MountAct = async (body, successMsg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/mounts", {
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
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const unmounted = (data?.volumes ?? []).filter((v) => !v.mountpoint);

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-3 p-4">
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <Network className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">마운트된 파일시스템</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => setDialog({ type: "remote" })}>
                <Plus className="size-3.5" />
                네트워크 연결
              </Button>
            </div>
            <div className="divide-y">
              {(data?.mounts ?? []).length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">관리 가능한 마운트가 없습니다.</p>
              )}
              {(data?.mounts ?? []).map((m) => (
                <MountRow
                  key={m.mountpoint + m.device}
                  mount={m}
                  onUnmount={(mount) =>
                    setDialog({
                      type: "confirm",
                      title: "언마운트",
                      desc: `${mount.mountpoint} 를 해제합니다. 사용 중인 프로그램이 있으면 실패할 수 있습니다.`,
                      onConfirm: () => act({ kind: "unmount", mountpoint: mount.mountpoint }, "언마운트했습니다."),
                    })
                  }
                  onForget={(mount) =>
                    setDialog({
                      type: "confirm",
                      title: "자동 마운트 해제",
                      desc: `${mount.mountpoint} 의 /etc/fstab 항목을 삭제합니다. 현재 마운트 상태는 그대로 유지됩니다.`,
                      onConfirm: () => act({ kind: "fstab.remove", mountpoint: mount.mountpoint }, "fstab 항목을 삭제했습니다."),
                    })
                  }
                />
              ))}
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-3">
              <HardDrive className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">마운트되지 않은 볼륨</span>
            </div>
            <div className="divide-y">
              {unmounted.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">모든 볼륨이 이미 마운트되어 있습니다.</p>
              )}
              {unmounted.map((v) => (
                <VolumeRow key={v.device} volume={v} onMount={(volume) => setDialog({ type: "mount", volume })} />
              ))}
            </div>
          </Card>
        </div>
      </ScrollArea>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        {dialog?.type === "mount" && data && (
          <MountDialog volume={dialog.volume} data={data} busy={busy} act={act} onClose={() => setDialog(null)} />
        )}
        {dialog?.type === "remote" && data && (
          <RemoteDialog data={data} busy={busy} act={act} onClose={() => setDialog(null)} />
        )}
        {dialog?.type === "confirm" && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog.title}</DialogTitle>
              <DialogDescription>{dialog.desc}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialog(null)}>취소</Button>
              <Button
                variant={dialog.danger ? "destructive" : "default"}
                disabled={busy}
                onClick={() => {
                  dialog.onConfirm();
                  setDialog(null);
                }}
              >
                확인
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
