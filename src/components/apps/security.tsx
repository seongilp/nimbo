"use client";

import { useState } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Flame,
  Lock,
  KeyRound,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
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
import { cn } from "@/lib/utils";
import type { FirewallRule, SecurityCheck, SecurityOverview } from "@/lib/types";

type Act = (body: Record<string, unknown>, msg: string) => void;

const ACTION_STYLE: Record<FirewallRule["action"], { cls: string; label: string }> = {
  allow: { cls: "bg-emerald-500/15 text-emerald-500", label: "allow" },
  deny: { cls: "bg-red-500/15 text-red-500", label: "deny" },
  reject: { cls: "bg-amber-500/15 text-amber-500", label: "reject" },
};

const SEVERITY: Record<SecurityCheck["severity"], { dot: string; badge: string; label: string }> = {
  ok: { dot: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-500", label: "정상" },
  low: { dot: "bg-sky-500", badge: "bg-sky-500/15 text-sky-500", label: "낮음" },
  medium: { dot: "bg-amber-500", badge: "bg-amber-500/15 text-amber-500", label: "주의" },
  high: { dot: "bg-red-500", badge: "bg-red-500/15 text-red-500", label: "위험" },
};

export function Security() {
  const { data, refresh } = usePoll<SecurityOverview>("/api/security", 0);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/security", {
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
    }
  };

  const fw = data?.firewall;
  const checks = data?.checks ?? [];
  const tfa = data?.twoFactor;
  const passed = checks.filter((c) => c.passed).length;

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="firewall" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="firewall"><Flame className="size-3.5" /> 방화벽</TabsTrigger>
            <TabsTrigger value="advisor"><ShieldCheck className="size-3.5" /> 보안 검사</TabsTrigger>
            <TabsTrigger value="2fa"><KeyRound className="size-3.5" /> 2단계 인증</TabsTrigger>
          </TabsList>
          {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* FIREWALL */}
          <TabsContent value="firewall" className="m-0 space-y-3 p-4">
            {fw && (
              <>
                <Card className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className={cn("flex size-10 items-center justify-center rounded-lg", fw.enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")}>
                      <Flame className="size-5" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">방화벽 {fw.enabled ? "활성화됨" : "비활성화됨"}</p>
                      <p className="text-xs text-muted-foreground">ufw · {fw.rules.length}개 규칙 적용 중</p>
                    </div>
                  </div>
                  <Switch checked={fw.enabled} disabled={busy} onCheckedChange={(v) => act({ kind: "firewall.toggle", enabled: v }, v ? "방화벽 활성화됨" : "방화벽 비활성화됨")} />
                </Card>

                <Card className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">기본 수신 정책</p>
                    <p className="text-xs text-muted-foreground">규칙에 없는 들어오는 연결을 {fw.defaultIncoming === "deny" ? "차단" : "허용"}합니다.</p>
                  </div>
                  <div className="flex gap-1.5">
                    {(["deny", "allow"] as const).map((d) => (
                      <button
                        key={d}
                        disabled={busy}
                        onClick={() => fw.defaultIncoming !== d && act({ kind: "firewall.setDefault", defaultIncoming: d }, `기본 수신 정책 → ${d}`)}
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs transition-colors",
                          fw.defaultIncoming === d ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent",
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </Card>

                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{fw.rules.length}개 규칙</p>
                  <Button size="sm" className="h-8 gap-1" onClick={() => setAddOpen(true)}><Plus className="size-4" /> 규칙 추가</Button>
                </div>

                <Card className="overflow-hidden p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">동작</th>
                        <th className="px-3 py-2 font-medium">방향</th>
                        <th className="px-3 py-2 font-medium">프로토콜</th>
                        <th className="px-3 py-2 font-medium">포트</th>
                        <th className="px-3 py-2 font-medium">소스</th>
                        <th className="px-3 py-2 font-medium">설명</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {fw.rules.map((r) => {
                        const as = ACTION_STYLE[r.action];
                        return (
                          <tr key={r.id} className="border-b border-border/40 last:border-0 hover:bg-accent/30">
                            <td className="px-3 py-2"><Badge className={cn("border-0", as.cls)}>{as.label}</Badge></td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{r.direction === "in" ? "수신" : "송신"}</td>
                            <td className="px-3 py-2 font-mono text-xs">{r.protocol}</td>
                            <td className="px-3 py-2 font-mono text-xs">{r.port}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.source}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{r.comment}</td>
                            <td className="px-2 py-2">
                              <Button size="icon" variant="ghost" className="size-7 text-destructive" disabled={busy}
                                onClick={() => act({ kind: "rule.delete", id: r.id }, "규칙 삭제됨")}>
                                <Trash2 className="size-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                      {fw.rules.length === 0 && (
                        <tr><td colSpan={7} className="px-3 py-4 text-center text-sm text-muted-foreground">규칙이 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ADVISOR */}
          <TabsContent value="advisor" className="m-0 space-y-3 p-4">
            <Card className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className={cn("flex size-10 items-center justify-center rounded-lg", passed === checks.length ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
                  <Shield className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-medium">보안 점수 {passed} / {checks.length}</p>
                  <p className="text-xs text-muted-foreground">{checks.length - passed}개 항목에 조치가 필요합니다.</p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy} onClick={() => act({ kind: "advisor.scan" }, "보안 검사 완료")}>
                <ShieldCheck className="size-4" /> 다시 검사
              </Button>
            </Card>

            <div className="space-y-2">
              {checks.map((c) => {
                const sev = SEVERITY[c.severity];
                return (
                  <Card key={c.id} className={cn("p-4", !c.passed && "border-l-2 border-l-amber-500/60")}>
                    <div className="flex items-start gap-3">
                      <span className="mt-1.5 flex shrink-0">
                        {c.passed ? <CheckCircle2 className="size-4 text-emerald-500" /> : c.severity === "high" ? <XCircle className="size-4 text-red-500" /> : <AlertTriangle className="size-4 text-amber-500" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.title}</span>
                          <Badge className={cn("gap-1 border-0 text-[10px]", sev.badge)}>
                            <span className={cn("size-1.5 rounded-full", sev.dot)} />{sev.label}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
                        {!c.passed && <p className="mt-1 text-xs text-muted-foreground/80">권장: {c.recommendation}</p>}
                      </div>
                    </div>
                  </Card>
                );
              })}
              {checks.length === 0 && <p className="text-sm text-muted-foreground">검사 항목이 없습니다.</p>}
            </div>
          </TabsContent>

          {/* 2FA */}
          <TabsContent value="2fa" className="m-0 space-y-3 p-4">
            {tfa && (
              <>
                {tfa.enabled && tfa.verified ? (
                  <Card className="space-y-4 p-5">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500"><ShieldCheck className="size-5" /></span>
                      <div>
                        <p className="text-sm font-medium text-emerald-500">2단계 인증 활성화됨</p>
                        <p className="text-xs text-muted-foreground">관리자 로그인 시 TOTP 코드가 필요합니다.</p>
                      </div>
                    </div>
                    <Button variant="destructive" disabled={busy} onClick={() => act({ kind: "twoFactor.disable" }, "2FA 비활성화됨")}>
                      <Lock className="size-4" /> 비활성화
                    </Button>
                  </Card>
                ) : tfa.secret ? (
                  <Card className="space-y-4 p-5">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="size-5" /></span>
                      <div>
                        <p className="text-sm font-medium">인증 앱에 등록</p>
                        <p className="text-xs text-muted-foreground">인증 앱에 등록 후 코드 입력</p>
                      </div>
                    </div>
                    <SecretRow label="시크릿 키" value={tfa.secret} />
                    <SecretRow label="otpauth URL" value={tfa.otpauthUrl} />
                    <VerifyForm act={act} busy={busy} />
                  </Card>
                ) : (
                  <Card className="flex flex-col items-center gap-4 p-8 text-center">
                    <ShieldAlert className="size-10 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium">2단계 인증이 설정되지 않았습니다</p>
                      <p className="mt-1 max-w-sm text-xs text-muted-foreground">TOTP 기반 2FA를 설정하면 비밀번호가 유출되어도 계정을 보호할 수 있습니다.</p>
                    </div>
                    <Button disabled={busy} onClick={() => act({ kind: "twoFactor.setup" }, "2FA 설정 시작됨")}>
                      <ShieldCheck className="size-4" /> 2FA 설정
                    </Button>
                  </Card>
                )}
              </>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <AddRuleDialog open={addOpen} onOpenChange={setAddOpen} act={act} busy={busy} />
    </div>
  );
}

function SecretRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => { navigator.clipboard?.writeText(value); toast.success("클립보드에 복사됨"); }}>
          복사
        </Button>
      </div>
      <code className="block w-full overflow-x-auto whitespace-nowrap rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">{value}</code>
    </div>
  );
}

function VerifyForm({ act, busy }: { act: Act; busy: boolean }) {
  const [code, setCode] = useState("");
  const valid = /^[0-9]{6}$/.test(code.trim());
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">인증 앱에 표시된 6자리 코드를 입력하세요.</p>
      <div className="flex gap-2">
        <Input
          value={code}
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
          className="font-mono tracking-widest"
        />
        <Button disabled={busy || !valid} onClick={() => act({ kind: "twoFactor.verify", code: code.trim() }, "2FA 활성화됨")}>확인</Button>
      </div>
    </div>
  );
}

function AddRuleDialog({ open, onOpenChange, act, busy }: { open: boolean; onOpenChange: (v: boolean) => void; act: Act; busy: boolean }) {
  const [action, setAction] = useState<FirewallRule["action"]>("allow");
  const [protocol, setProtocol] = useState<FirewallRule["protocol"]>("tcp");
  const [port, setPort] = useState("");
  const [source, setSource] = useState("any");
  const [comment, setComment] = useState("");

  const valid = port.trim().length > 0;

  function submit() {
    act(
      { kind: "rule.create", rule: { action, protocol, port: port.trim(), source: source.trim() || "any", comment: comment.trim() } },
      "규칙 추가됨",
    );
    onOpenChange(false);
    setPort("");
    setComment("");
    setSource("any");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>방화벽 규칙 추가</DialogTitle>
          <DialogDescription>들어오는 연결에 대한 허용/차단 규칙을 정의합니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center justify-between text-sm">동작
            <select className="rounded-md border bg-background px-2 py-1 text-sm" value={action} onChange={(e) => setAction(e.target.value as FirewallRule["action"])}>
              {(["allow", "deny", "reject"] as const).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between text-sm">프로토콜
            <select className="rounded-md border bg-background px-2 py-1 text-sm" value={protocol} onChange={(e) => setProtocol(e.target.value as FirewallRule["protocol"])}>
              {(["tcp", "udp", "any"] as const).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">포트 (예: 22, 80,443, 8000:8100)</p>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" autoFocus />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">소스 (예: any, 192.168.1.0/24)</p>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="any" />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">설명 (선택)</p>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="SSH (LAN 전용)" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button onClick={submit} disabled={busy || !valid}>추가</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
