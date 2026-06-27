import type {
  NotifyChannel,
  NotifyEvent,
  NotifyEventType,
  NotifyLevel,
  NotifyOverview,
  NotifyRule,
  NotifyTarget,
} from "@/lib/types";
import { USE_MOCK } from "./exec";

const EVENT_TYPES: NotifyEventType[] = [
  "pool.degraded",
  "disk.health",
  "scrub.finished",
  "backup.failed",
  "backup.success",
  "container.down",
  "cpu.high",
  "storage.full",
  "login",
];

const MAX_EVENTS = 50;

interface State {
  targets: NotifyTarget[];
  rules: NotifyRule[];
  events: NotifyEvent[];
}

// Demo targets — only seeded in mock/dev mode. On a real deployment the
// operator configures their own notification targets.
function seedTargets(): NotifyTarget[] {
  return [
    {
      id: "tgt-slack",
      channel: "slack",
      label: "#nas-alerts",
      webhookUrl: "https://hooks.slack.com/services/XXX",
      chatId: "",
      enabled: true,
    },
    {
      id: "tgt-telegram",
      channel: "telegram",
      label: "텔레그램 봇",
      webhookUrl: "123456789:AAExampleBotTokenXXXXXXXXXXXXXXXXXXX",
      chatId: "123456",
      enabled: true,
    },
    {
      id: "tgt-discord",
      channel: "discord",
      label: "디스코드 #서버",
      webhookUrl: "https://discord.com/api/webhooks/XXX",
      chatId: "",
      enabled: false,
    },
  ];
}

// Demo event history — only seeded in mock/dev mode. On a real deployment the
// log starts empty and is populated solely by real emitEvent() calls.
function seedEvents(): NotifyEvent[] {
  return [
    {
      id: "evt-seed-1",
      ts: Date.now() - 8 * 60_000,
      type: "scrub.finished",
      level: "info",
      title: "스크럽 완료",
      message: "tank 풀 스크럽이 오류 0건으로 완료되었습니다. (4.2TB 검사)",
      delivered: ["#nas-alerts", "텔레그램 봇"],
    },
    {
      id: "evt-seed-2",
      ts: Date.now() - 95 * 60_000,
      type: "backup.failed",
      level: "critical",
      title: "백업 실패",
      message: "‘미디어 → 콜드 스토리지’ 작업이 실패했습니다: 연결 시간 초과",
      delivered: ["#nas-alerts", "텔레그램 봇"],
    },
    {
      id: "evt-seed-3",
      ts: Date.now() - 5 * 3600_000,
      type: "disk.health",
      level: "warning",
      title: "디스크 상태 경고",
      message: "/dev/sdc SMART 재할당 섹터 수가 증가하고 있습니다 (12).",
      delivered: ["#nas-alerts"],
    },
    {
      id: "evt-seed-4",
      ts: Date.now() - 11 * 3600_000,
      type: "backup.success",
      level: "info",
      title: "백업 성공",
      message: "‘사진 원격 백업’이 4.2GB / 1,284개 파일을 전송하며 완료되었습니다.",
      delivered: ["텔레그램 봇"],
    },
    {
      id: "evt-seed-5",
      ts: Date.now() - 26 * 3600_000,
      type: "storage.full",
      level: "warning",
      title: "저장공간 부족",
      message: "volume1 사용량이 92%에 도달했습니다. 정리를 고려하세요.",
      delivered: [],
    },
  ];
}

const state: State = {
  // Seeded demo data only in mock/dev mode; empty on real deployments.
  targets: USE_MOCK ? seedTargets() : [],
  // Rules are config defaults (one per event type) — present in both modes.
  rules: EVENT_TYPES.map((event) => ({
    event,
    // Most events on by default; the chatty "login" event is off.
    enabled: event !== "login",
  })),
  events: USE_MOCK ? seedEvents() : [],
};

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getNotifyOverview(): Promise<NotifyOverview> {
  return {
    targets: state.targets,
    rules: state.rules,
    events: state.events,
    isMock: USE_MOCK,
  };
}

// --------------------------------------------------------------------------
// Delivery
// --------------------------------------------------------------------------
function buildBody(channel: NotifyChannel, target: NotifyTarget, title: string, message: string) {
  switch (channel) {
    case "discord":
      return { url: target.webhookUrl, payload: { content: `**${title}**\n${message}` } };
    case "telegram":
      return {
        url: `https://api.telegram.org/bot${target.webhookUrl}/sendMessage`,
        payload: { chat_id: target.chatId, text: `${title}\n${message}` },
      };
    case "slack":
    case "webhook":
    default:
      return { url: target.webhookUrl, payload: { text: `*${title}*\n${message}` } };
  }
}

async function sendToTarget(
  target: NotifyTarget,
  title: string,
  message: string,
  _level: NotifyLevel
): Promise<boolean> {
  void _level;
  const { url, payload } = buildBody(target.channel, target, title, message);

  // In mock mode we never hit the network — pretend the delivery succeeded.
  if (USE_MOCK) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------
// Event emission (used by other modules)
// --------------------------------------------------------------------------
export async function emitEvent(
  type: NotifyEventType,
  level: NotifyLevel,
  title: string,
  message: string
): Promise<void> {
  const rule = state.rules.find((r) => r.event === type);
  const ruleEnabled = rule ? rule.enabled : true;

  const delivered: string[] = [];
  if (ruleEnabled) {
    const enabledTargets = state.targets.filter((t) => t.enabled);
    const results = await Promise.all(
      enabledTargets.map(async (t) => ({ label: t.label, ok: await sendToTarget(t, title, message, level) }))
    );
    for (const r of results) {
      if (r.ok) delivered.push(r.label);
    }
  }

  const event: NotifyEvent = {
    id: `evt-${Date.now()}`,
    ts: Date.now(),
    type,
    level,
    title,
    message,
    delivered,
  };

  // Always record the event, even when no targets received it.
  state.events = [event, ...state.events].slice(0, MAX_EVENTS);
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface NotifyAction {
  kind: string;
  id?: string;
  target?: Partial<NotifyTarget>;
  enabled?: boolean;
  event?: NotifyEventType;
  type?: NotifyEventType;
}

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

const CHANNELS: NotifyChannel[] = ["slack", "telegram", "discord", "webhook"];

function validateTarget(t: Partial<NotifyTarget>): string | null {
  const channel = t.channel;
  if (!channel || !CHANNELS.includes(channel)) return "잘못된 채널";
  if (!t.label || !t.label.trim()) return "라벨이 필요합니다";
  if (typeof t.webhookUrl !== "string" || !t.webhookUrl.trim()) return "webhook URL이 필요합니다";
  if (channel === "telegram") {
    if (!t.chatId || !t.chatId.trim()) return "텔레그램 chat id가 필요합니다";
  } else if (!t.webhookUrl.trim().startsWith("http")) {
    return "webhook URL은 http로 시작해야 합니다";
  }
  return null;
}

const SAMPLE_TITLE = "테스트 알림";
const SAMPLE_MESSAGE = "NAS 콘솔에서 보낸 테스트 메시지입니다. 이 메시지가 보이면 연결이 정상입니다.";

export async function runNotifyAction(a: NotifyAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "target.create": {
      const t = a.target ?? {};
      const err = validateTarget(t);
      if (err) return fail(err);
      const target: NotifyTarget = {
        id: `tgt-${Date.now()}`,
        channel: t.channel as NotifyChannel,
        label: (t.label as string).trim(),
        webhookUrl: (t.webhookUrl as string).trim(),
        chatId: (t.chatId ?? "").trim(),
        enabled: t.enabled ?? true,
      };
      state.targets = [...state.targets, target];
      return ok();
    }
    case "target.update": {
      const existing = state.targets.find((x) => x.id === a.id);
      if (!existing || !a.target) return fail("대상을 찾을 수 없습니다");
      const merged: Partial<NotifyTarget> = { ...existing, ...a.target };
      const err = validateTarget(merged);
      if (err) return fail(err);
      const updated: NotifyTarget = {
        ...existing,
        channel: merged.channel as NotifyChannel,
        label: (merged.label as string).trim(),
        webhookUrl: (merged.webhookUrl as string).trim(),
        chatId: (merged.chatId ?? "").trim(),
      };
      state.targets = state.targets.map((x) => (x.id === existing.id ? updated : x));
      return ok();
    }
    case "target.delete": {
      state.targets = state.targets.filter((x) => x.id !== a.id);
      return ok();
    }
    case "target.toggle": {
      const existing = state.targets.find((x) => x.id === a.id);
      if (!existing) return fail("대상을 찾을 수 없습니다");
      const updated = { ...existing, enabled: a.enabled ?? !existing.enabled };
      state.targets = state.targets.map((x) => (x.id === existing.id ? updated : x));
      return ok();
    }
    case "target.test": {
      const target = state.targets.find((x) => x.id === a.id);
      if (!target) return fail("대상을 찾을 수 없습니다");
      const sent = await sendToTarget(target, SAMPLE_TITLE, SAMPLE_MESSAGE, "info");
      return sent ? ok() : fail("전송 실패 — URL/토큰을 확인하세요");
    }
    case "rule.toggle": {
      const rule = state.rules.find((r) => r.event === a.event);
      if (!rule) return fail("규칙을 찾을 수 없습니다");
      const updated = { ...rule, enabled: a.enabled ?? !rule.enabled };
      state.rules = state.rules.map((r) => (r.event === rule.event ? updated : r));
      return ok();
    }
    case "event.testEmit": {
      const type: NotifyEventType = a.type && EVENT_TYPES.includes(a.type) ? a.type : "login";
      await emitEvent(type, "info", SAMPLE_TITLE, SAMPLE_MESSAGE);
      return ok();
    }
    default:
      return fail("알 수 없는 작업");
  }
}
