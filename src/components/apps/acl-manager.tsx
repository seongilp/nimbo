"use client";

import { useState } from "react";
import { Eraser, FolderOpen, Plus, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
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
import { usePoll } from "@/lib/hooks/use-poll";
import type { AclEntry, AclInfo, AclTag, ShareInfo } from "@/lib/types";

const SELECT_CLASS = "w-full rounded-md border bg-background px-3 py-2 text-sm";

const TAG_LABEL: Record<AclTag, string> = {
  user: "사용자",
  group: "그룹",
  mask: "마스크",
  other: "기타",
};

/** The three base entries are structural — they can be edited but not removed. */
function isBaseEntry(entry: AclEntry): boolean {
  return entry.qualifier === "" && entry.tag !== "mask";
}

function PermToggles({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const has = (c: string) => value.includes(c);
  const toggle = (c: string) => {
    const next = ["r", "w", "x"].map((p) => (p === c ? (has(c) ? "-" : p) : has(p) ? p : "-")).join("");
    onChange(next);
  };
  return (
    <div className="flex gap-1">
      {(["r", "w", "x"] as const).map((c) => (
        <Button
          key={c}
          type="button"
          size="sm"
          variant={has(c) ? "default" : "outline"}
          className="h-7 w-9 font-mono text-xs"
          onClick={() => toggle(c)}
        >
          {c}
        </Button>
      ))}
    </div>
  );
}

function EntryRow({ entry, busy, onSave, onRemove }: {
  entry: AclEntry;
  busy: boolean;
  onSave: (entry: AclEntry, perms: string) => void;
  onRemove: (entry: AclEntry) => void;
}) {
  // Local draft of the permission toggles. The row is keyed on the server's
  // perms, so a refresh that changes them remounts this row with the new value
  // instead of needing an effect to re-sync.
  const [perms, setPerms] = useState(entry.perms);
  const dirty = perms !== entry.perms;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="outline" className="shrink-0 text-[10px]">{TAG_LABEL[entry.tag]}</Badge>
        <span className="truncate text-sm">
          {entry.qualifier || <span className="text-muted-foreground">(소유 {entry.tag === "group" ? "그룹" : entry.tag === "other" ? "외" : "자"})</span>}
        </span>
        {entry.isDefault && <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">기본값 상속</Badge>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <PermToggles value={perms} onChange={setPerms} />
        <Button size="sm" variant="outline" className="h-7" disabled={!dirty || busy} onClick={() => onSave(entry, perms)}>
          적용
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={busy || isBaseEntry(entry)}
          title={isBaseEntry(entry) ? "기본 항목은 삭제할 수 없습니다" : "항목 삭제"}
          onClick={() => onRemove(entry)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AddDialog({ busy, onAdd, onClose }: {
  busy: boolean;
  onAdd: (entry: AclEntry) => void;
  onClose: () => void;
}) {
  const [tag, setTag] = useState<AclTag>("user");
  const [qualifier, setQualifier] = useState("");
  const [perms, setPerms] = useState("r-x");
  const [isDefault, setIsDefault] = useState(false);

  const needsQualifier = tag === "user" || tag === "group";

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>ACL 항목 추가</DialogTitle>
        <DialogDescription>특정 사용자나 그룹에 이 경로의 접근 권한을 부여합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">대상</label>
          <select className={SELECT_CLASS} value={tag} onChange={(e) => setTag(e.target.value as AclTag)}>
            <option value="user">사용자</option>
            <option value="group">그룹</option>
            <option value="mask">마스크 (최대 허용 권한)</option>
          </select>
        </div>
        {needsQualifier && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">이름</label>
            <Input value={qualifier} onChange={(e) => setQualifier(e.target.value)} placeholder="alice" autoComplete="off" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">권한</label>
          <PermToggles value={perms} onChange={setPerms} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">기본(default) ACL로 추가</span>
            <p className="text-[11px] text-muted-foreground">이 폴더 아래에 새로 만들어지는 항목이 상속합니다.</p>
          </div>
          <Switch checked={isDefault} onCheckedChange={setIsDefault} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>취소</Button>
        <Button
          disabled={busy || (needsQualifier && !qualifier.trim())}
          onClick={() => {
            onAdd({ tag, qualifier: needsQualifier ? qualifier.trim() : "", perms, isDefault });
            onClose();
          }}
        >
          추가
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------

export function AclManager() {
  // Shares are the paths an operator actually wants to manage ACLs on, so they
  // seed the picker; any other path can still be typed in by hand.
  const { data: shares } = usePoll<ShareInfo[]>("/api/shares", 0);
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [acl, setAcl] = useState<AclInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recursive, setRecursive] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = async (target: string) => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/acl?path=${encodeURIComponent(target)}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setAcl(json.data as AclInfo);
        setError(null);
      } else {
        setAcl(null);
        setError(json.error ?? "ACL을 읽을 수 없습니다.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (body: Record<string, unknown>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/acl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, path, recursive }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(successMsg);
        await load(path);
      } else {
        toast.error(json.error ?? "작업 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const open = (target: string) => {
    setPath(target);
    setQuery(target);
    void load(target);
  };

  const access = acl?.entries.filter((e) => !e.isDefault) ?? [];
  const defaults = acl?.entries.filter((e) => e.isDefault) ?? [];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="space-y-3 border-b p-4">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && open(query.trim())}
            placeholder="/srv/share/photos"
            className="font-mono text-sm"
          />
          <Button variant="outline" disabled={busy || !query.trim()} onClick={() => open(query.trim())}>
            <FolderOpen className="size-4" />
            열기
          </Button>
          {acl && (
            <Button variant="ghost" disabled={busy} onClick={() => load(path)} title="새로고침">
              <RefreshCw className="size-4" />
            </Button>
          )}
        </div>
        {(shares?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shares?.map((s) => (
              <Button key={`${s.protocol}:${s.path}`} size="sm" variant="outline" className="h-7 text-xs" onClick={() => open(s.path)}>
                {s.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {error && (
            <Card className="border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">{error}</Card>
          )}

          {!acl && !error && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              공유 폴더를 선택하거나 경로를 입력해 ACL을 확인하세요.
            </p>
          )}

          {acl && (
            <>
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{acl.path}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      소유자 {acl.owner}:{acl.group} · 모드 {acl.mode} · {acl.isDirectory ? "디렉터리" : "파일"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {acl.supported ? (
                      <Badge className="gap-1 border-0 bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="size-3" />
                        ACL 지원
                      </Badge>
                    ) : (
                      <Badge className="border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
                        {acl.toolInstalled ? "이 파일시스템은 ACL 미지원" : "acl 패키지 미설치"}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>

              {acl.supported && (
                <>
                  {acl.isDirectory && (
                    <Card className="flex items-center justify-between p-4">
                      <div>
                        <span className="text-sm">하위 항목에 재귀 적용</span>
                        <p className="text-[11px] text-muted-foreground">
                          켜면 아래의 모든 변경이 하위 파일·폴더에도 함께 적용됩니다.
                        </p>
                      </div>
                      <Switch checked={recursive} onCheckedChange={setRecursive} />
                    </Card>
                  )}

                  <Card className="overflow-hidden p-0">
                    <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Users className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium">접근 권한</span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                        <Plus className="size-3.5" />
                        항목 추가
                      </Button>
                    </div>
                    <div className="divide-y">
                      {access.map((entry) => (
                        <EntryRow
                          key={`a:${entry.tag}:${entry.qualifier}:${entry.perms}`}
                          entry={entry}
                          busy={busy}
                          onSave={(e, perms) => act({ kind: "entry.set", entry: { ...e, perms } }, "권한을 적용했습니다.")}
                          onRemove={(e) => act({ kind: "entry.remove", entry: e }, "항목을 삭제했습니다.")}
                        />
                      ))}
                    </div>
                  </Card>

                  {acl.isDirectory && (
                    <Card className="overflow-hidden p-0">
                      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                        <span className="text-sm font-medium">기본(default) ACL</span>
                        {defaults.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => act({ kind: "clear.default" }, "기본 ACL을 제거했습니다.")}
                          >
                            <Eraser className="size-3.5" />
                            전체 제거
                          </Button>
                        )}
                      </div>
                      <div className="divide-y">
                        {defaults.length === 0 && (
                          <p className="px-4 py-3 text-sm text-muted-foreground">
                            기본 ACL이 없습니다. 새로 만들어지는 항목은 상위 권한을 상속하지 않습니다.
                          </p>
                        )}
                        {defaults.map((entry) => (
                          <EntryRow
                            key={`d:${entry.tag}:${entry.qualifier}:${entry.perms}`}
                            entry={entry}
                            busy={busy}
                            onSave={(e, perms) => act({ kind: "entry.set", entry: { ...e, perms } }, "기본 권한을 적용했습니다.")}
                            onRemove={(e) => act({ kind: "entry.remove", entry: e }, "항목을 삭제했습니다.")}
                          />
                        ))}
                      </div>
                    </Card>
                  )}

                  <Button
                    variant="outline"
                    className="w-full text-red-600 hover:text-red-600 dark:text-red-400"
                    disabled={busy}
                    onClick={() => act({ kind: "clear" }, "확장 ACL을 모두 제거했습니다.")}
                  >
                    <Eraser className="size-4" />
                    확장 ACL 전체 제거 (기본 유닉스 권한만 남김)
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && (
          <AddDialog
            busy={busy}
            onAdd={(entry) => act({ kind: "entry.set", entry }, "항목을 추가했습니다.")}
            onClose={() => setAdding(false)}
          />
        )}
      </Dialog>
    </div>
  );
}
