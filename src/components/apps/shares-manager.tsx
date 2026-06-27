"use client";

import { useState } from "react";
import {
  FolderCog,
  FolderPlus,
  Network,
  Share2,
  Lock,
  Users,
  Server,
  Clipboard,
  Pencil,
  Trash2,
  Plus,
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileServices, SharedFolder, SharesAdminOverview } from "@/lib/types";

const HOST = "nas-server";

type Act = (body: Record<string, unknown>, msg: string) => void;
type DialogState =
  | { type: "folder"; folder?: SharedFolder }
  | { type: "confirm"; title: string; desc: string; onConfirm: () => void }
  | null;

export function SharesManager() {
  const { data, refresh } = usePoll<SharesAdminOverview>("/api/shares-admin", 0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/shares-admin", {
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
      setDialog(null);
    }
  };

  const folders = data?.folders ?? [];
  const services = data?.services;

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="folders" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="folders">
              <FolderCog className="size-3.5" /> 공유 폴더
            </TabsTrigger>
            <TabsTrigger value="services">
              <Server className="size-3.5" /> 파일 서비스
            </TabsTrigger>
          </TabsList>
          {data?.isMock && (
            <Badge variant="secondary" className="text-[10px]">
              demo
            </Badge>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* FOLDERS */}
          <TabsContent value="folders" className="m-0 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{folders.length}개 공유 폴더</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "folder" })}>
                <FolderPlus className="size-4" /> 공유 폴더 생성
              </Button>
            </div>
            <div className="space-y-2">
              {folders.map((f) => (
                <FolderRow key={f.name} folder={f} busy={busy} act={act} setDialog={setDialog} />
              ))}
              {folders.length === 0 && (
                <p className="text-sm text-muted-foreground">공유 폴더가 없습니다.</p>
              )}
            </div>
          </TabsContent>

          {/* SERVICES */}
          <TabsContent value="services" className="m-0 space-y-3 p-4">
            {services && <ServicesPanel services={services} busy={busy} act={act} />}
            {data && (
              <div className="grid gap-3 md:grid-cols-2">
                <ConfPreview title="smb.conf" conf={data.smbConf} />
                <ConfPreview title="exports" conf={data.exportsConf} />
              </div>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <SharesDialogs dialog={dialog} setDialog={setDialog} act={act} busy={busy} />
    </div>
  );
}

function FolderRow({
  folder,
  busy,
  act,
  setDialog,
}: {
  folder: SharedFolder;
  busy: boolean;
  act: Act;
  setDialog: (d: DialogState) => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {folder.readOnly ? <Lock className="size-5" /> : <Share2 className="size-5" />}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{folder.name}</span>
              {folder.smbEnabled && (
                <Badge variant="outline" className="text-[10px]">
                  SMB
                </Badge>
              )}
              {folder.nfsEnabled && (
                <Badge variant="outline" className="text-[10px]">
                  NFS
                </Badge>
              )}
              {folder.readOnly && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Lock className="size-3" /> 읽기 전용
                </Badge>
              )}
              {folder.guestOk && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Users className="size-3" /> 게스트
                </Badge>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{folder.path}</p>
            {folder.description && (
              <p className="text-[11px] text-muted-foreground">{folder.description}</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums">{formatBytes(folder.usedBytes)} 사용</span>
              {folder.smbEnabled && (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {`\\\\${HOST}\\${folder.name}`}
                </code>
              )}
              {folder.validUsers && <span>허용: {folder.validUsers}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => setDialog({ type: "folder", folder })}
          >
            <Pencil className="size-3.5" /> 편집
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-destructive"
            disabled={busy}
            onClick={() =>
              setDialog({
                type: "confirm",
                title: "공유 폴더 삭제",
                desc: `${folder.name} 공유 폴더를 삭제합니다.`,
                onConfirm: () => act({ kind: "folder.delete", name: folder.name }, "공유 폴더 삭제됨"),
              })
            }
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

const SERVICE_META: { key: keyof FileServices; label: string; desc: string; Icon: typeof Server }[] = [
  { key: "smb", label: "SMB / CIFS", desc: "Windows·macOS 파일 공유 (smbd)", Icon: Network },
  { key: "nfs", label: "NFS", desc: "Unix·Linux 네트워크 파일 시스템 (nfs-server)", Icon: Server },
  { key: "afp", label: "AFP", desc: "레거시 Apple Filing Protocol (netatalk)", Icon: Share2 },
];

function ServicesPanel({
  services,
  busy,
  act,
}: {
  services: FileServices;
  busy: boolean;
  act: Act;
}) {
  return (
    <div className="space-y-2">
      {SERVICE_META.map(({ key, label, desc, Icon }) => {
        const enabled = services[key];
        return (
          <Card key={key} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-lg",
                  enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-sm font-medium">
                  {label} {enabled ? "실행 중" : "중지됨"}
                </p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
            <Switch
              checked={enabled}
              disabled={busy}
              onCheckedChange={(v) =>
                act(
                  { kind: "service.toggle", service: key, enabled: v },
                  `${label} ${v ? "시작" : "중지"}`
                )
              }
            />
          </Card>
        );
      })}
    </div>
  );
}

function ConfPreview({ title, conf }: { title: string; conf: string }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">생성된 {title}</p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            navigator.clipboard?.writeText(conf);
            toast.success("클립보드에 복사됨");
          }}
        >
          <Clipboard className="size-3.5" /> 복사
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {conf || "활성화된 공유가 없습니다."}
      </pre>
    </Card>
  );
}

function SharesDialogs({
  dialog,
  setDialog,
  act,
  busy,
}: {
  dialog: DialogState;
  setDialog: (d: DialogState) => void;
  act: Act;
  busy: boolean;
}) {
  const close = () => setDialog(null);
  return (
    <Dialog open={dialog !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className={dialog?.type === "folder" ? "max-w-lg" : undefined}>
        {dialog?.type === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle>{dialog.title}</DialogTitle>
              <DialogDescription>{dialog.desc}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>
                취소
              </Button>
              <Button variant="destructive" onClick={dialog.onConfirm} disabled={busy}>
                삭제
              </Button>
            </DialogFooter>
          </>
        )}
        {dialog?.type === "folder" && (
          <FolderDialog folder={dialog.folder} act={act} close={close} busy={busy} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FolderDialog({
  folder,
  act,
  close,
  busy,
}: {
  folder?: SharedFolder;
  act: Act;
  close: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [path, setPath] = useState(folder?.path ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [smbEnabled, setSmbEnabled] = useState(folder?.smbEnabled ?? true);
  const [nfsEnabled, setNfsEnabled] = useState(folder?.nfsEnabled ?? false);
  const [readOnly, setReadOnly] = useState(folder?.readOnly ?? false);
  const [guestOk, setGuestOk] = useState(folder?.guestOk ?? false);
  const [validUsers, setValidUsers] = useState(folder?.validUsers ?? "");

  const payload: SharedFolder = {
    name: name.trim(),
    path: path.trim(),
    description: description.trim(),
    smbEnabled,
    nfsEnabled,
    readOnly,
    guestOk,
    validUsers: validUsers.trim(),
    usedBytes: folder?.usedBytes ?? 0,
  };
  const valid = name.trim().length > 0 && path.trim().length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{folder ? "공유 폴더 편집" : "공유 폴더 생성"}</DialogTitle>
        <DialogDescription>SMB·NFS 공유 폴더의 경로와 접근 권한을 설정합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">이름</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: Documents"
            disabled={!!folder}
            autoFocus={!folder}
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">경로</p>
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="예: /volume1/Documents"
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">설명</p>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="설명 (선택)"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            SMB 활성
            <Switch checked={smbEnabled} onCheckedChange={setSmbEnabled} />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            NFS 활성
            <Switch checked={nfsEnabled} onCheckedChange={setNfsEnabled} />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            읽기 전용
            <Switch checked={readOnly} onCheckedChange={setReadOnly} />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            게스트 허용
            <Switch checked={guestOk} onCheckedChange={setGuestOk} />
          </label>
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3" /> 허용 사용자 (valid users)
          </p>
          <Input
            value={validUsers}
            onChange={(e) => setValidUsers(e.target.value)}
            placeholder="예: alice @group (비우면 전체 허용)"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>
          취소
        </Button>
        <Button
          disabled={busy || !valid}
          onClick={() =>
            act(
              folder
                ? { kind: "folder.update", name: folder.name, folder: payload }
                : { kind: "folder.create", folder: payload },
              folder ? "공유 폴더 저장됨" : "공유 폴더 생성됨"
            )
          }
        >
          <Plus className="size-4" /> 저장
        </Button>
      </DialogFooter>
    </>
  );
}
