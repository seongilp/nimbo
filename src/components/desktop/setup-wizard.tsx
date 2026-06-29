"use client";

import { useState } from "react";
import { Cloud, User, Clock, Network, Check, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { SetupConfig } from "@/lib/types";

const TZ = ["Asia/Seoul", "Asia/Tokyo", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Australia/Sydney"];

const STEPS = [
  { icon: Cloud, label: "환영" },
  { icon: User, label: "관리자" },
  { icon: Clock, label: "지역" },
  { icon: Network, label: "접속" },
  { icon: Check, label: "완료" },
];

export function SetupWizard({ initial, onComplete }: { initial: SetupConfig; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<SetupConfig>(initial);
  const set = <K extends keyof SetupConfig>(k: K, v: SetupConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  async function finish() {
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "setup.save", config: cfg }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("설정이 저장되었습니다");
        onComplete();
      } else {
        toast.error(json.error ?? "저장 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canNext =
    step === 1 ? /^[a-z_][a-z0-9_-]{0,31}$/.test(cfg.adminUser)
    : step === 3 ? cfg.port >= 1 && cfg.port <= 65535
    : true;

  return (
    <div className="desktop-wallpaper relative flex h-dvh w-full items-center justify-center overflow-hidden p-4">
      <div className="glass shadow-window w-full max-w-md rounded-3xl border border-white/10 p-7">
        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center">
              <div className={cn("flex size-8 items-center justify-center rounded-full text-xs transition-colors", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/20 text-primary ring-2 ring-primary" : "bg-muted text-muted-foreground")}>
                {i < step ? <Check className="size-4" /> : <s.icon className="size-4" />}
              </div>
              {i < STEPS.length - 1 && <div className={cn("h-px w-5", i < step ? "bg-primary" : "bg-border")} />}
            </div>
          ))}
        </div>

        <div className="min-h-[230px]">
          {step === 0 && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex size-16 items-center justify-center rounded-[26%] bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-icon ring-1 ring-white/10"><Cloud className="size-8 fill-white/25" /></div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Nimbo 설정</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">서버 관리를 시작하기 위해 몇 가지만 설정합니다.<br />1분이면 끝납니다.</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <Field title="관리자 계정" desc="콘솔에 로그인할 관리자 계정을 만듭니다.">
              <Label>계정 이름</Label>
              <Input value={cfg.adminUser} onChange={(e) => set("adminUser", e.target.value)} placeholder="admin" autoFocus />
              <p className="text-xs text-muted-foreground">소문자/숫자/언더스코어, 32자 이내.</p>
            </Field>
          )}

          {step === 2 && (
            <Field title="호스트 & 지역" desc="서버 이름과 시간대를 설정합니다.">
              <Label>호스트 이름</Label>
              <Input value={cfg.hostname} onChange={(e) => set("hostname", e.target.value)} placeholder="nas-server" />
              <Label>시간대</Label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={cfg.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {TZ.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          )}

          {step === 3 && (
            <Field title="접속 설정" desc="콘솔 포트와 데이터 경로입니다.">
              <Label>포트</Label>
              <Input type="number" value={cfg.port} onChange={(e) => set("port", Number(e.target.value))} placeholder="3000" />
              <Label>데이터 경로</Label>
              <Input value={cfg.dataPath} onChange={(e) => set("dataPath", e.target.value)} placeholder="/volume1" />
              <label className="flex items-center justify-between pt-1 text-sm">HTTPS 사용 (Caddy 권장)<Switch checked={cfg.httpsEnabled} onCheckedChange={(v) => set("httpsEnabled", v)} /></label>
              <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">포트를 바꾸면 /etc/nimbo/nimbo.env 가 갱신되며, 적용하려면 서비스 재시작이 필요합니다.</p>
            </Field>
          )}

          {step === 4 && (
            <Field title="확인" desc="아래 설정으로 시작합니다.">
              <Summary label="관리자" value={cfg.adminUser} />
              <Summary label="호스트" value={cfg.hostname} />
              <Summary label="시간대" value={cfg.timezone} />
              <Summary label="포트" value={String(cfg.port)} />
              <Summary label="데이터 경로" value={cfg.dataPath} />
              <Summary label="HTTPS" value={cfg.httpsEnabled ? "사용" : "사용 안 함"} />
            </Field>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft className="size-4" /> 이전
          </Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>다음 <ChevronRight className="size-4" /></Button>
          ) : (
            <Button disabled={busy} onClick={finish}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 시작하기</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="mb-2"><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{desc}</p></div>
      {children}
    </div>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-xs font-medium text-muted-foreground">{children}</p>;
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
