"use client";

import { useState } from "react";
import {
  Bell,
  ListChecks,
  MessageSquare,
  Send,
  MessagesSquare,
  Webhook,
  Plus,
  Pencil,
  Trash2,
  Zap,
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
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  NotifyChannel,
  NotifyEvent,
  NotifyEventType,
  NotifyLevel,
  NotifyOverview,
  NotifyTarget,
} from "@/lib/types";

const CHANNEL_META: Record<NotifyChannel, { label: string; Icon: typeof MessageSquare; cls: string }> = {
  slack: { label: "Slack", Icon: MessageSquare, cls: "bg-violet-500/15 text-violet-500" },
  telegram: { label: "Telegram", Icon: Send, cls: "bg-sky-500/15 text-sky-500" },
  discord: { label: "Discord", Icon: MessagesSquare, cls: "bg-indigo-500/15 text-indigo-500" },
  webhook: { label: "Webhook", Icon: Webhook, cls: "bg-emerald-500/15 text-emerald-500" },
};

const EVENT_LABEL: Record<NotifyEventType, string> = {
  "pool.degraded": "풀 성능 저하",
  "disk.health": "디스크 상태 경고",
  "scrub.finished": "스크럽 완료",
  "backup.failed": "백업 실패",
  "backup.success": "백업 성공",
  "container.down": "컨테이너 중단",
  "cpu.high": "CPU 과부하",
  "storage.full": "저장공간 부족",
  login: "로그인",
};

const LEVEL_DOT: Record<NotifyLevel, string> = {
  info: "bg-muted-foreground",
  warning: "bg-amber-500",
  critical: "bg-red-500",
};

const CHANNELS: NotifyChannel[] = ["slack", "telegram", "discord", "webhook"];

function maskUrl(url: string): string {
  if (!url) return "";
  if (url.length <= 16) return url.slice(0, 4) + "•••";
  return `${url.slice(0, 18)}…${url.slice(-4)}`;
}

type Act = (body: Record<string, unknown>, msg: string) => void;
type DialogState =
  | { type: "target"; target?: NotifyTarget }
  | { type: "confirm"; title: string; desc: string; onConfirm: () => void }
  | null;

export function Notifications() {
  const { data, refresh } = usePoll<NotifyOverview>("/api/notify", 4000);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/notify", {
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

  const targets = data?.targets ?? [];
  const rules = data?.rules ?? [];
  const events = data?.events ?? [];

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="channels" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="channels">
              <Bell className="size-3.5" /> 채널
            </TabsTrigger>
            <TabsTrigger value="events">
              <ListChecks className="size-3.5" /> 이벤트
            </TabsTrigger>
          </TabsList>
          {data?.isMock && (
            <Badge variant="secondary" className="text-[10px]">
              demo
            </Badge>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* CHANNELS */}
          <TabsContent value="channels" className="m-0 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{targets.length}개 채널</p>
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog({ type: "target" })}>
                <Plus className="size-4" /> 채널 추가
              </Button>
            </div>
            <div className="space-y-3">
              {targets.map((target) => (
                <TargetCard key={target.id} target={target} busy={busy} act={act} setDialog={setDialog} />
              ))}
              {targets.length === 0 && <p className="text-sm text-muted-foreground">등록된 채널이 없습니다.</p>}
            </div>
          </TabsContent>

          {/* EVENTS */}
          <TabsContent value="events" className="m-0 space-y-4 p-4">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">알림 규칙</p>
                  <p className="text-xs text-muted-foreground">활성화된 이벤트만 채널로 전송됩니다.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 text-xs"
                  disabled={busy}
                  onClick={() => act({ kind: "event.testEmit" }, "테스트 이벤트를 발송했습니다")}
                >
                  <Zap className="size-3.5" /> 테스트 이벤트 발송
                </Button>
              </div>
              <div className="space-y-1.5">
                {rules.map((rule) => (
                  <label
                    key={rule.event}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                  >
                    {EVENT_LABEL[rule.event]}
                    <Switch
                      checked={rule.enabled}
                      disabled={busy}
                      onCheckedChange={(v) =>
                        act(
                          { kind: "rule.toggle", event: rule.event, enabled: v },
                          v ? `${EVENT_LABEL[rule.event]} 알림 켜짐` : `${EVENT_LABEL[rule.event]} 알림 꺼짐`
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </Card>

            <div>
              <p className="mb-2 text-sm text-muted-foreground">최근 이벤트 {events.length}건</p>
              <div className="space-y-2">
                {events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
                {events.length === 0 && <p className="text-sm text-muted-foreground">이벤트 기록이 없습니다.</p>}
              </div>
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <NotifyDialogs dialog={dialog} setDialog={setDialog} act={act} busy={busy} />
    </div>
  );
}

function TargetCard({
  target,
  busy,
  act,
  setDialog,
}: {
  target: NotifyTarget;
  busy: boolean;
  act: Act;
  setDialog: (d: DialogState) => void;
}) {
  const meta = CHANNEL_META[target.channel];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 items-center justify-center rounded-lg", meta.cls)}>
            <meta.Icon className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{target.label}</span>
              <Badge variant="outline" className="text-[10px]">
                {meta.label}
              </Badge>
              {!target.enabled && (
                <Badge variant="secondary" className="text-[10px]">
                  비활성
                </Badge>
              )}
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {maskUrl(target.webhookUrl)}
              {target.channel === "telegram" && target.chatId ? ` · chat ${target.chatId}` : ""}
            </p>
          </div>
        </div>
        <Switch
          checked={target.enabled}
          disabled={busy}
          onCheckedChange={(v) =>
            act(
              { kind: "target.toggle", id: target.id, enabled: v },
              v ? `${target.label} 활성화됨` : `${target.label} 비활성화됨`
            )
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5 border-t pt-3">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          disabled={busy}
          onClick={() => act({ kind: "target.test", id: target.id }, `${target.label}로 테스트 전송됨`)}
        >
          <Send className="size-3.5" /> 테스트
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => setDialog({ type: "target", target })}
        >
          <Pencil className="size-3.5" /> 편집
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-destructive"
          onClick={() =>
            setDialog({
              type: "confirm",
              title: "채널 삭제",
              desc: `${target.label} 채널을 삭제합니다.`,
              onConfirm: () => act({ kind: "target.delete", id: target.id }, "채널 삭제됨"),
            })
          }
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

function EventRow({ event }: { event: NotifyEvent }) {
  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", LEVEL_DOT[event.level])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{event.title}</span>
            <span className="text-[11px] text-muted-foreground">{formatRelative(event.ts)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{event.message}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-[9px]">
              {EVENT_LABEL[event.type]}
            </Badge>
            {event.delivered.length > 0 ? (
              event.delivered.map((label) => (
                <Badge key={label} variant="secondary" className="text-[9px]">
                  {label}
                </Badge>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground">전송 대상 없음</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function NotifyDialogs({
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
      <DialogContent>
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
        {dialog?.type === "target" && <TargetDialog target={dialog.target} act={act} close={close} busy={busy} />}
      </DialogContent>
    </Dialog>
  );
}

function TargetDialog({
  target,
  act,
  close,
  busy,
}: {
  target?: NotifyTarget;
  act: Act;
  close: () => void;
  busy: boolean;
}) {
  const [channel, setChannel] = useState<NotifyChannel>(target?.channel ?? "slack");
  const [label, setLabel] = useState(target?.label ?? "");
  const [webhookUrl, setWebhookUrl] = useState(target?.webhookUrl ?? "");
  const [chatId, setChatId] = useState(target?.chatId ?? "");

  const isTelegram = channel === "telegram";
  const payload = {
    channel,
    label: label.trim(),
    webhookUrl: webhookUrl.trim(),
    chatId: chatId.trim(),
  };
  const valid = label.trim() && webhookUrl.trim() && (!isTelegram || chatId.trim());

  return (
    <>
      <DialogHeader>
        <DialogTitle>{target ? "채널 편집" : "채널 추가"}</DialogTitle>
        <DialogDescription>이벤트가 발생하면 이 채널로 알림을 전송합니다.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <label className="flex items-center justify-between text-sm">
          채널 종류
          <select
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={channel}
            onChange={(e) => setChannel(e.target.value as NotifyChannel)}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_META[c].label}
              </option>
            ))}
          </select>
        </label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="라벨 (예: #nas-alerts)" autoFocus />
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{isTelegram ? "봇 토큰" : "Webhook URL"}</p>
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={isTelegram ? "123456789:AA..." : "https://hooks.slack.com/services/..."}
          />
        </div>
        {isTelegram && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Chat ID</p>
            <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="예: 123456" />
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>
          취소
        </Button>
        <Button
          disabled={busy || !valid}
          onClick={() =>
            act(
              target
                ? { kind: "target.update", id: target.id, target: payload }
                : { kind: "target.create", target: payload },
              target ? "채널 저장됨" : "채널 추가됨"
            )
          }
        >
          저장
        </Button>
      </DialogFooter>
    </>
  );
}
