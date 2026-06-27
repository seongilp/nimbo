"use client";

import { useState } from "react";
import {
  User,
  Users as UsersIcon,
  UserPlus,
  KeyRound,
  Trash2,
  Plus,
  ShieldCheck,
  Ban,
  CheckCircle2,
  MoreHorizontal,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePoll } from "@/lib/hooks/use-poll";
import { cn } from "@/lib/utils";
import type { SysGroup, SysUser, UsersOverview } from "@/lib/types";

type Act = (body: Record<string, unknown>, msg: string) => void;

type DialogState =
  | { type: "createUser" }
  | { type: "password"; user: SysUser }
  | { type: "groups"; user: SysUser }
  | { type: "createGroup" }
  | { type: "confirm"; title: string; desc: string; onConfirm: () => void }
  | null;

export function Users() {
  const { data, refresh } = usePoll<UsersOverview>("/api/users", 0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/users", {
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

  const users = data?.users ?? [];
  const groups = data?.groups ?? [];

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="users" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="users"><User className="size-3.5" /> 사용자</TabsTrigger>
            <TabsTrigger value="groups"><UsersIcon className="size-3.5" /> 그룹</TabsTrigger>
          </TabsList>
          {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* USERS */}
          <TabsContent value="users" className="m-0 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{users.length}명 사용자</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "createUser" })}>
                <UserPlus className="size-4" /> 사용자 추가
              </Button>
            </div>
            <Card className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">사용자</th>
                    <th className="px-3 py-2 font-medium">UID</th>
                    <th className="px-3 py-2 font-medium">그룹</th>
                    <th className="px-3 py-2 font-medium">상태</th>
                    <th className="px-3 py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <UserRow key={u.name} user={u} groups={groups} busy={busy} act={act} setDialog={setDialog} />
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">사용자가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* GROUPS */}
          <TabsContent value="groups" className="m-0 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{groups.length}개 그룹</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "createGroup" })}>
                <Plus className="size-4" /> 그룹 추가
              </Button>
            </div>
            <div className="space-y-2">
              {groups.map((g) => (
                <GroupCard key={g.name} group={g} busy={busy} setDialog={setDialog} act={act} />
              ))}
              {groups.length === 0 && <p className="text-sm text-muted-foreground">그룹이 없습니다.</p>}
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <UserDialogs dialog={dialog} setDialog={setDialog} act={act} busy={busy} groups={groups} />
    </div>
  );
}

function initialOf(u: SysUser): string {
  const base = (u.fullName || u.name).trim();
  return base.charAt(0).toUpperCase() || "?";
}

function UserRow({
  user,
  groups,
  busy,
  act,
  setDialog,
}: {
  user: SysUser;
  groups: SysGroup[];
  busy: boolean;
  act: Act;
  setDialog: (d: DialogState) => void;
}) {
  void groups;
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            user.disabled ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
          )}>
            {initialOf(user)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{user.name}</span>
              {user.isSystem && (
                <Badge variant="outline" className="gap-0.5 text-[9px]"><ShieldCheck className="size-2.5" /> 시스템</Badge>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{user.fullName}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{user.uid}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {user.groups.map((g) => (
            <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>
          ))}
          {user.groups.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        {user.disabled ? (
          <Badge className="gap-1 border-0 bg-red-500/15 text-red-500"><Ban className="size-3" /> 비활성</Badge>
        ) : (
          <Badge className="gap-1 border-0 bg-emerald-500/15 text-emerald-500"><CheckCircle2 className="size-3" /> 활성</Badge>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="size-7"><MoreHorizontal className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setDialog({ type: "password", user })}>
              <KeyRound className="size-4" /> 비밀번호 변경
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog({ type: "groups", user })}>
              <UsersIcon className="size-4" /> 그룹 편집
            </DropdownMenuItem>
            {!user.isSystem && (
              <DropdownMenuItem
                disabled={busy}
                onClick={() => act({ kind: "user.toggleDisabled", name: user.name, disabled: !user.disabled }, user.disabled ? "사용자 활성화됨" : "사용자 비활성화됨")}
              >
                {user.disabled ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
                {user.disabled ? "활성화" : "비활성화"}
              </DropdownMenuItem>
            )}
            {!user.isSystem && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDialog({
                    type: "confirm",
                    title: "사용자 삭제",
                    desc: `${user.name} 사용자와 홈 디렉터리를 삭제합니다.`,
                    onConfirm: () => act({ kind: "user.delete", name: user.name }, "사용자 삭제됨"),
                  })}
                >
                  <Trash2 className="size-4" /> 삭제
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function GroupCard({
  group,
  busy,
  setDialog,
  act,
}: {
  group: SysGroup;
  busy: boolean;
  setDialog: (d: DialogState) => void;
  act: Act;
}) {
  return (
    <Card className="flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UsersIcon className="size-4" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{group.name}</span>
            <Badge variant="outline" className="text-[10px]">gid {group.gid}</Badge>
            {group.isSystem && (
              <Badge variant="outline" className="gap-0.5 text-[9px]"><ShieldCheck className="size-2.5" /> 시스템</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{group.members.length}명 멤버</p>
          {group.members.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {group.members.map((m) => (
                <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      {!group.isSystem && (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-destructive"
          disabled={busy}
          onClick={() => setDialog({
            type: "confirm",
            title: "그룹 삭제",
            desc: `${group.name} 그룹을 삭제합니다.`,
            onConfirm: () => act({ kind: "group.delete", name: group.name }, "그룹 삭제됨"),
          })}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </Card>
  );
}

function UserDialogs({
  dialog,
  setDialog,
  act,
  busy,
  groups,
}: {
  dialog: DialogState;
  setDialog: (d: DialogState) => void;
  act: Act;
  busy: boolean;
  groups: SysGroup[];
}) {
  const close = () => setDialog(null);
  return (
    <Dialog open={dialog !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {dialog?.type === "confirm" && (
          <>
            <DialogHeader><DialogTitle>{dialog.title}</DialogTitle><DialogDescription>{dialog.desc}</DialogDescription></DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
              <Button variant="destructive" onClick={dialog.onConfirm} disabled={busy}>삭제</Button>
            </DialogFooter>
          </>
        )}
        {dialog?.type === "createUser" && <CreateUserDialog act={act} close={close} busy={busy} groups={groups} />}
        {dialog?.type === "password" && <PasswordDialog user={dialog.user} act={act} close={close} busy={busy} />}
        {dialog?.type === "groups" && <GroupsDialog user={dialog.user} act={act} close={close} busy={busy} groups={groups} />}
        {dialog?.type === "createGroup" && <CreateGroupDialog act={act} close={close} busy={busy} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({
  act,
  close,
  busy,
  groups,
}: {
  act: Act;
  close: () => void;
  busy: boolean;
  groups: SysGroup[];
}) {
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (g: string) =>
    setSelected((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const valid = /^[a-z_][a-z0-9_-]{0,31}$/.test(name);

  return (
    <>
      <DialogHeader>
        <DialogTitle>사용자 추가</DialogTitle>
        <DialogDescription>새 시스템 사용자 계정을 생성합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">사용자 이름</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: alice" autoFocus />
          {name && !valid && <p className="mt-1 text-xs text-red-500">소문자/숫자/_/- 만 사용할 수 있습니다.</p>}
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">전체 이름 (선택)</p>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="예: 홍길동" />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">비밀번호 (선택)</p>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">그룹</p>
          <GroupCheckList groups={groups} selected={selected} toggle={toggle} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button
          disabled={busy || !valid}
          onClick={() => act({
            kind: "user.create",
            name: name.trim(),
            fullName: fullName.trim() || undefined,
            password: password || undefined,
            groups: selected,
          }, "사용자 추가됨")}
        >
          추가
        </Button>
      </DialogFooter>
    </>
  );
}

function PasswordDialog({
  user,
  act,
  close,
  busy,
}: {
  user: SysUser;
  act: Act;
  close: () => void;
  busy: boolean;
}) {
  const [password, setPassword] = useState("");
  return (
    <>
      <DialogHeader>
        <DialogTitle>비밀번호 변경 — {user.name}</DialogTitle>
        <DialogDescription>새 비밀번호를 입력하세요.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="새 비밀번호" autoFocus />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button
          disabled={busy || !password}
          onClick={() => act({ kind: "user.setPassword", name: user.name, password }, "비밀번호 변경됨")}
        >
          변경
        </Button>
      </DialogFooter>
    </>
  );
}

function GroupsDialog({
  user,
  act,
  close,
  busy,
  groups,
}: {
  user: SysUser;
  act: Act;
  close: () => void;
  busy: boolean;
  groups: SysGroup[];
}) {
  const [selected, setSelected] = useState<string[]>(user.groups);
  const toggle = (g: string) =>
    setSelected((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  return (
    <>
      <DialogHeader>
        <DialogTitle>그룹 편집 — {user.name}</DialogTitle>
        <DialogDescription>이 사용자가 속할 그룹을 선택하세요.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <GroupCheckList groups={groups} selected={selected} toggle={toggle} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button
          disabled={busy}
          onClick={() => act({ kind: "user.setGroups", name: user.name, groups: selected }, "그룹 변경됨")}
        >
          저장
        </Button>
      </DialogFooter>
    </>
  );
}

function CreateGroupDialog({ act, close, busy }: { act: Act; close: () => void; busy: boolean }) {
  const [name, setName] = useState("");
  const valid = /^[a-z_][a-z0-9_-]{0,31}$/.test(name);
  return (
    <>
      <DialogHeader>
        <DialogTitle>그룹 추가</DialogTitle>
        <DialogDescription>새 사용자 그룹을 생성합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="그룹 이름 (예: developers)" autoFocus />
        {name && !valid && <p className="text-xs text-red-500">소문자/숫자/_/- 만 사용할 수 있습니다.</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>취소</Button>
        <Button disabled={busy || !valid} onClick={() => act({ kind: "group.create", name: name.trim() }, "그룹 추가됨")}>추가</Button>
      </DialogFooter>
    </>
  );
}

function GroupCheckList({
  groups,
  selected,
  toggle,
}: {
  groups: SysGroup[];
  selected: string[];
  toggle: (g: string) => void;
}) {
  return (
    <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-auto rounded-md border p-2">
      {groups.map((g) => {
        const checked = selected.includes(g.name);
        return (
          <button
            key={g.name}
            type="button"
            onClick={() => toggle(g.name)}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors",
              checked ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent",
            )}
          >
            <span className="truncate">{g.name}</span>
            {checked && <CheckCircle2 className="size-3.5 shrink-0" />}
          </button>
        );
      })}
      {groups.length === 0 && <p className="col-span-2 text-xs text-muted-foreground">그룹이 없습니다.</p>}
    </div>
  );
}
