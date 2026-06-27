"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Lock,
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  Star,
  Upload,
  Award,
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
import type { HttpsConfig, TlsCert } from "@/lib/types";

type Act = (body: Record<string, unknown>, msg: string) => void;
type DialogState = "letsencrypt" | "selfsigned" | "import" | null;

const DAY = 86_400_000;

const TYPE_STYLE: Record<TlsCert["type"], { cls: string; label: string }> = {
  letsencrypt: { cls: "bg-emerald-500/15 text-emerald-500", label: "Let's Encrypt" },
  selfsigned: { cls: "bg-amber-500/15 text-amber-500", label: "자체 서명" },
  imported: { cls: "bg-slate-500/15 text-slate-400", label: "가져옴" },
};

function daysLeft(notAfter: number): number {
  return Math.floor((notAfter - Date.now()) / DAY);
}

function expiryColor(days: number): string {
  if (days < 15) return "text-red-500";
  if (days < 30) return "text-amber-500";
  return "text-emerald-500";
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function Certificates() {
  const { data, refresh } = usePoll<HttpsConfig>("/api/certs", 0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/certs", {
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

  const certs = data?.certs ?? [];

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="certs" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="certs">
              <ShieldCheck className="size-3.5" /> 인증서
            </TabsTrigger>
            <TabsTrigger value="https">
              <Lock className="size-3.5" /> HTTPS 설정
            </TabsTrigger>
          </TabsList>
          {data?.isMock && (
            <Badge variant="secondary" className="text-[10px]">
              demo
            </Badge>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {/* CERTIFICATES */}
          <TabsContent value="certs" className="m-0 space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-8 gap-1" onClick={() => setDialog("letsencrypt")}>
                <Award className="size-4" /> Let&apos;s Encrypt 발급
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                onClick={() => setDialog("selfsigned")}
              >
                <Plus className="size-4" /> 자체 서명 생성
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1"
                onClick={() => setDialog("import")}
              >
                <Upload className="size-4" /> 인증서 가져오기
              </Button>
            </div>

            <div className="space-y-2">
              {certs.map((c) => {
                const ts = TYPE_STYLE[c.type];
                const days = daysLeft(c.notAfter);
                return (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-mono text-sm font-medium">{c.domain}</span>
                          <Badge className={cn("border-0 text-[10px]", ts.cls)}>{ts.label}</Badge>
                          {c.isDefault && (
                            <Badge className="gap-1 border-0 bg-primary/15 text-[10px] text-primary">
                              <Star className="size-2.5" /> 기본
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">발급자: {c.issuer}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          유효기간: {formatDate(c.notBefore)} ~ {formatDate(c.notAfter)} ·{" "}
                          <span className={cn("font-medium", expiryColor(days))}>
                            만료까지 {days}일
                          </span>
                        </p>
                        {c.san.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.san.map((s) => (
                              <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {!c.isDefault && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          disabled={busy}
                          onClick={() =>
                            act({ kind: "cert.setDefault", id: c.id }, "기본 인증서로 설정됨")
                          }
                        >
                          <Star className="size-3.5" /> 기본으로 설정
                        </Button>
                      )}
                      {c.type === "letsencrypt" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          disabled={busy}
                          onClick={() => act({ kind: "cert.renew", id: c.id }, "인증서 갱신됨")}
                        >
                          <RefreshCw className="size-3.5" /> 갱신
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs text-destructive"
                        disabled={busy || c.isDefault}
                        onClick={() => act({ kind: "cert.delete", id: c.id }, "인증서 삭제됨")}
                      >
                        <Trash2 className="size-3.5" /> 삭제
                      </Button>
                    </div>
                  </Card>
                );
              })}
              {certs.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  설치된 인증서가 없습니다.
                </p>
              )}
            </div>
          </TabsContent>

          {/* HTTPS SETTINGS */}
          <TabsContent value="https" className="m-0 space-y-3 p-4">
            {data && <HttpsSettings config={data} act={act} busy={busy} />}
          </TabsContent>
        </ScrollArea>
      </Tabs>

      <LetsEncryptDialog
        open={dialog === "letsencrypt"}
        onOpenChange={(v) => !v && setDialog(null)}
        act={act}
        busy={busy}
      />
      <SelfSignedDialog
        open={dialog === "selfsigned"}
        onOpenChange={(v) => !v && setDialog(null)}
        act={act}
        busy={busy}
      />
      <ImportDialog
        open={dialog === "import"}
        onOpenChange={(v) => !v && setDialog(null)}
        act={act}
        busy={busy}
      />
    </div>
  );
}

function HttpsSettings({
  config,
  act,
  busy,
}: {
  config: HttpsConfig;
  act: Act;
  busy: boolean;
}) {
  const [httpPort, setHttpPort] = useState(String(config.httpPort));
  const [httpsPort, setHttpsPort] = useState(String(config.httpsPort));
  const [forceHttps, setForceHttps] = useState(config.forceHttps);

  return (
    <>
      <Card className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-lg",
              config.enabled
                ? "bg-emerald-500/15 text-emerald-500"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Lock className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium">HTTPS {config.enabled ? "활성화됨" : "비활성화됨"}</p>
            <p className="text-xs text-muted-foreground">
              리버스 프록시를 통한 보안 접속을 제어합니다.
            </p>
          </div>
        </div>
        <Switch
          checked={config.enabled}
          disabled={busy}
          onCheckedChange={(v) =>
            act({ kind: "https.update", enabled: v }, v ? "HTTPS 활성화됨" : "HTTPS 비활성화됨")
          }
        />
      </Card>

      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">HTTP 포트</p>
            <Input
              value={httpPort}
              inputMode="numeric"
              onChange={(e) => setHttpPort(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="80"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">HTTPS 포트</p>
            <Input
              value={httpsPort}
              inputMode="numeric"
              onChange={(e) => setHttpsPort(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="443"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">HTTP→HTTPS 강제 전환</p>
            <p className="text-xs text-muted-foreground">
              모든 HTTP 요청을 HTTPS로 리다이렉트합니다.
            </p>
          </div>
          <Switch checked={forceHttps} disabled={busy} onCheckedChange={setForceHttps} />
        </div>

        <Button
          disabled={busy || !httpPort || !httpsPort}
          onClick={() =>
            act(
              {
                kind: "https.update",
                httpPort: Number(httpPort),
                httpsPort: Number(httpsPort),
                forceHttps,
              },
              "HTTPS 설정 저장됨",
            )
          }
        >
          저장
        </Button>
      </Card>

      <Card className="flex items-start gap-3 border-l-2 border-l-sky-500/60 p-4">
        <Globe className="mt-0.5 size-4 shrink-0 text-sky-500" />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">TLS 종료 안내</p>
          <p>
            실제 TLS 종료는 전면 리버스 프록시(Caddy)에서 처리됩니다. 위 설정과 선택된 인증서는 해당
            프록시의 HTTPS 구성을 제어하는 데 사용됩니다. 애플리케이션 자체는 TLS를 종료하지
            않습니다.
          </p>
        </div>
      </Card>
    </>
  );
}

function LetsEncryptDialog({
  open,
  onOpenChange,
  act,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  act: Act;
  busy: boolean;
}) {
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [dns, setDns] = useState(false);
  const valid = /^[A-Za-z0-9.*_-]+$/.test(domain.trim()) && /^[^\s@]+@[^\s@]+$/.test(email.trim());

  function submit() {
    act(
      { kind: "cert.requestLetsEncrypt", domain: domain.trim(), email: email.trim(), dns },
      "Let's Encrypt 인증서 발급 요청됨",
    );
    onOpenChange(false);
    setDomain("");
    setEmail("");
    setDns(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Let&apos;s Encrypt 발급</DialogTitle>
          <DialogDescription>certbot으로 무료 신뢰 인증서를 발급합니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">도메인</p>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="nas.example.com"
              autoFocus
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">이메일 (만료 알림용)</p>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">DNS 챌린지</p>
              <p className="text-xs text-muted-foreground">
                와일드카드 또는 포트 미개방 환경에서 사용합니다.
              </p>
            </div>
            <Switch checked={dns} onCheckedChange={setDns} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            발급
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SelfSignedDialog({
  open,
  onOpenChange,
  act,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  act: Act;
  busy: boolean;
}) {
  const [domain, setDomain] = useState("");
  const valid = /^[A-Za-z0-9.*_-]+$/.test(domain.trim());

  function submit() {
    act({ kind: "cert.selfSigned", domain: domain.trim() }, "자체 서명 인증서 생성됨");
    onOpenChange(false);
    setDomain("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>자체 서명 생성</DialogTitle>
          <DialogDescription>
            내부망 또는 테스트용 1년 유효 자체 서명 인증서를 생성합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">도메인 (CN)</p>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="nas-server.local"
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            생성
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  act,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  act: Act;
  busy: boolean;
}) {
  const [domain, setDomain] = useState("");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const valid =
    /^[A-Za-z0-9.*_-]+$/.test(domain.trim()) && certPem.trim().length > 0 && keyPem.trim().length > 0;

  function submit() {
    act(
      { kind: "cert.import", domain: domain.trim(), certPem: certPem.trim(), keyPem: keyPem.trim() },
      "인증서를 가져왔습니다",
    );
    onOpenChange(false);
    setDomain("");
    setCertPem("");
    setKeyPem("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>인증서 가져오기</DialogTitle>
          <DialogDescription>기존 인증서와 개인 키를 PEM 형식으로 붙여넣습니다.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">도메인</p>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="*.home.lan"
              autoFocus
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">인증서 (PEM)</p>
            <textarea
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----"
              className="h-24 w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-[11px]"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">개인 키 (PEM)</p>
            <textarea
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----"
              className="h-24 w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-[11px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !valid}>
            가져오기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
