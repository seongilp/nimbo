"use client";

import { useEffect, useState } from "react";
import {
  SlidersHorizontal,
  Palette,
  Network,
  FolderCog,
  Power,
  Info,
  Moon,
  Sun,
  Check,
  RotateCcw,
  Lock,
  Users,
  ShieldCheck,
  KeyRound,
  Copy,
  Trash2,
  Plus,
  Plug,
  Clock,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { usePoll } from "@/lib/hooks/use-poll";
import { useTheme } from "@/lib/hooks/use-theme";
import { ACCENTS, useAccent } from "@/lib/hooks/use-accent";
import { formatBytes, formatUptime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HostConfig, NetInterfaceConfig, ShareInfo, SshOverview, SystemOverview } from "@/lib/types";

type SectionId = "general" | "appearance" | "network" | "time" | "shares" | "ssh" | "power" | "about";

const SECTIONS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "일반", icon: SlidersHorizontal },
  { id: "appearance", label: "외관", icon: Palette },
  { id: "network", label: "네트워크", icon: Network },
  { id: "time", label: "시간", icon: Clock },
  { id: "shares", label: "공유 폴더", icon: FolderCog },
  { id: "ssh", label: "SSH 키", icon: KeyRound },
  { id: "power", label: "전원", icon: Power },
  { id: "about", label: "정보", icon: Info },
];

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="text-right text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

function Panel({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

async function postHost(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function HostnameRow() {
  const { data: host, refresh } = usePoll<HostConfig>("/api/host", 0);
  const [name, setName] = useState("");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (host && !edited) setName(host.hostname);
  }, [host, edited]);

  async function save() {
    setBusy(true);
    try {
      const json = await postHost({ kind: "host.setHostname", hostname: name.trim() });
      if (json.ok) {
        toast.success("호스트 이름을 변경했습니다");
        setEdited(false);
        refresh();
      } else {
        toast.error(json.error ?? "요청 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/50 py-3">
      <div>
        <p className="text-sm font-medium">호스트 이름</p>
        <p className="text-xs text-muted-foreground">시스템 식별 이름입니다.</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setEdited(true);
          }}
          className="h-8 w-48"
          placeholder="nas-server"
        />
        <Button size="sm" disabled={busy || !name.trim()} onClick={save}>
          <Save className="size-4" /> 저장
        </Button>
      </div>
    </div>
  );
}

function TimeSection() {
  const { data: host, refresh } = usePoll<HostConfig>("/api/host", 0);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [tz, setTz] = useState("");
  const [tzEdited, setTzEdited] = useState(false);
  const [ntpServer, setNtpServer] = useState("");
  const [serverEdited, setServerEdited] = useState(false);
  const [manual, setManual] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!host) return;
    if (!tzEdited) setTz(host.timezone);
    if (!serverEdited) setNtpServer(host.ntpServer);
  }, [host, tzEdited, serverEdited]);

  async function runHost(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const json = await postHost(body);
      if (json.ok) {
        toast.success(successMsg);
        refresh();
      } else {
        toast.error(json.error ?? "요청 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  let clockLabel = now.toLocaleString();
  if (host?.timezone) {
    try {
      clockLabel = now.toLocaleString("ko-KR", { timeZone: host.timezone, hour12: false });
    } catch {
      clockLabel = now.toLocaleString();
    }
  }

  return (
    <Panel title="시간" desc="시간대와 시각 동기화를 설정합니다.">
      {host?.isMock && (
        <Badge variant="secondary" className="gap-1">
          <Info className="size-3" /> 데모 데이터 (리눅스 호스트에서 실제 값 표시)
        </Badge>
      )}

      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">현재 시각</p>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{clockLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">{host?.timezone ?? "—"}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">시간대</h3>
        <div className="flex gap-2">
          <select
            value={tz}
            onChange={(e) => {
              setTz(e.target.value);
              setTzEdited(true);
            }}
            className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            {(host?.timezones ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <Button
            disabled={busy || !tz}
            onClick={async () => {
              await runHost({ kind: "time.setTimezone", timezone: tz }, "시간대를 변경했습니다");
              setTzEdited(false);
            }}
          >
            <Save className="size-4" /> 저장
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-xl border bg-card p-4">
          <div>
            <p className="text-sm font-medium">NTP 자동 동기화</p>
            <p className="text-xs text-muted-foreground">시간 서버와 시각을 자동으로 맞춥니다.</p>
          </div>
          <Switch
            checked={host?.ntpEnabled ?? false}
            disabled={busy}
            onCheckedChange={(v) =>
              runHost(
                { kind: "time.setNtp", ntpEnabled: v, ntpServer: ntpServer.trim() || undefined },
                v ? "NTP를 활성화했습니다" : "NTP를 비활성화했습니다"
              )
            }
          />
        </div>
        <div className="flex gap-2">
          <Input
            value={ntpServer}
            onChange={(e) => {
              setNtpServer(e.target.value);
              setServerEdited(true);
            }}
            placeholder="pool.ntp.org"
          />
          <Button
            variant="outline"
            disabled={busy || !ntpServer.trim()}
            onClick={async () => {
              await runHost(
                {
                  kind: "time.setNtp",
                  ntpEnabled: host?.ntpEnabled ?? false,
                  ntpServer: ntpServer.trim(),
                },
                "NTP 서버를 저장했습니다"
              );
              setServerEdited(false);
            }}
          >
            <Save className="size-4" /> 서버 저장
          </Button>
        </div>
      </div>

      {!host?.ntpEnabled && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">수동 시각 설정</h3>
          <p className="text-xs text-muted-foreground">NTP가 꺼져 있을 때만 적용됩니다.</p>
          <div className="flex gap-2">
            <Input
              type="datetime-local"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || !manual}
              onClick={() => {
                const d = new Date(manual);
                if (Number.isNaN(d.getTime())) {
                  toast.error("유효하지 않은 시각입니다");
                  return;
                }
                runHost(
                  { kind: "time.setManual", datetimeIso: d.toISOString() },
                  "시각을 설정했습니다"
                );
              }}
            >
              적용
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function InterfaceEditor({
  iface,
  busy,
  onSave,
}: {
  iface: NetInterfaceConfig;
  busy: boolean;
  onSave: (body: Record<string, unknown>, msg: string) => void;
}) {
  const [mode, setMode] = useState<"dhcp" | "static">(iface.mode);
  const [ipv4, setIpv4] = useState(iface.ipv4);
  const [netmask, setNetmask] = useState(iface.netmask);
  const [gateway, setGateway] = useState(iface.gateway);
  const [dns, setDns] = useState(iface.dns.join(", "));

  function save() {
    onSave(
      {
        kind: "network.setInterface",
        iface: {
          name: iface.name,
          mode,
          ipv4: ipv4.trim(),
          netmask: netmask.trim(),
          gateway: gateway.trim(),
          dns: dns
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean),
        },
      },
      `${iface.name} 설정을 저장했습니다`
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Network className="size-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{iface.name}</p>
              <Badge variant={iface.up ? "secondary" : "outline"} className="text-[10px]">
                {iface.up ? "활성" : "비활성"}
              </Badge>
              {iface.speedMbps > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {iface.speedMbps} Mbps
                </Badge>
              )}
            </div>
            <p className="font-mono text-xs text-muted-foreground">{iface.mac || "—"}</p>
          </div>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border">
          {(["dhcp", "static"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              )}
            >
              {m === "dhcp" ? "DHCP" : "고정 IP"}
            </button>
          ))}
        </div>
      </div>

      {mode === "static" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">IPv4 주소</p>
            <Input value={ipv4} onChange={(e) => setIpv4(e.target.value)} placeholder="192.168.1.10" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">넷마스크</p>
            <Input value={netmask} onChange={(e) => setNetmask(e.target.value)} placeholder="255.255.255.0" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">게이트웨이</p>
            <Input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="192.168.1.1" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">DNS (쉼표 구분)</p>
            <Input value={dns} onChange={(e) => setDns(e.target.value)} placeholder="1.1.1.1, 8.8.8.8" />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" disabled={busy} onClick={save}>
          <Save className="size-4" /> 저장
        </Button>
      </div>
    </div>
  );
}

function NetworkSection() {
  const { data: host, refresh } = usePoll<HostConfig>("/api/host", 0);
  const [busy, setBusy] = useState(false);

  async function runHost(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const json = await postHost(body);
      if (json.ok) {
        toast.success(successMsg);
        refresh();
      } else {
        toast.error(json.error ?? "요청 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="네트워크" desc="네트워크 인터페이스를 설정합니다.">
      {host?.isMock && (
        <Badge variant="secondary" className="gap-1">
          <Info className="size-3" /> 데모 데이터 (리눅스 호스트에서 실제 값 표시)
        </Badge>
      )}
      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <span>네트워크 변경은 서버에서 root 또는 sudoers 권한이 필요하며, 데모 모드에서는 실제로 적용되지 않습니다.</span>
      </div>
      <div className="space-y-3">
        {(host?.interfaces ?? []).map((iface) => (
          <InterfaceEditor key={iface.name} iface={iface} busy={busy} onSave={runHost} />
        ))}
        {!host?.interfaces.length && (
          <p className="text-sm text-muted-foreground">인터페이스 정보가 없습니다.</p>
        )}
      </div>
    </Panel>
  );
}

function SshSection() {
  const { data: ssh, refresh } = usePoll<SshOverview>("/api/ssh", 0);
  const [busy, setBusy] = useState(false);

  // Dialog / form state
  const [keyDialog, setKeyDialog] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyComment, setKeyComment] = useState("");
  const [newHost, setNewHost] = useState("");
  const [remoteDialog, setRemoteDialog] = useState(false);
  const [rLabel, setRLabel] = useState("");
  const [rUser, setRUser] = useState("");
  const [rHost, setRHost] = useState("");
  const [rPort, setRPort] = useState("22");
  const [rKeyName, setRKeyName] = useState("");

  async function runSsh(body: Record<string, unknown>, successMsg: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(successMsg);
        refresh();
        return true;
      }
      toast.error(json.error ?? "요청 실패");
      return false;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function copyPublicKey(publicKey: string) {
    navigator.clipboard
      .writeText(publicKey)
      .then(() => toast.success("공개 키를 클립보드에 복사했습니다"))
      .catch(() => toast.error("복사에 실패했습니다"));
  }

  async function generateKey() {
    const okDone = await runSsh(
      { kind: "key.generate", name: keyName.trim(), comment: keyComment.trim() },
      "키를 생성했습니다"
    );
    if (okDone) {
      setKeyDialog(false);
      setKeyName("");
      setKeyComment("");
    }
  }

  async function addHost() {
    const host = newHost.trim();
    if (!host) return;
    const okDone = await runSsh({ kind: "knownhost.add", host }, "호스트를 추가했습니다");
    if (okDone) setNewHost("");
  }

  async function createRemote() {
    const okDone = await runSsh(
      {
        kind: "remote.create",
        remote: {
          label: rLabel.trim(),
          user: rUser.trim(),
          host: rHost.trim(),
          port: Number(rPort) || 22,
          keyName: rKeyName.trim(),
        },
      },
      "원격 서버를 추가했습니다"
    );
    if (okDone) {
      setRemoteDialog(false);
      setRLabel("");
      setRUser("");
      setRHost("");
      setRPort("22");
      setRKeyName("");
    }
  }

  return (
    <Panel title="SSH 키" desc="SSH 키, 알려진 호스트, 원격 서버 연결을 관리합니다.">
      {ssh?.isMock && (
        <Badge variant="secondary" className="gap-1">
          <Info className="size-3" /> 데모 데이터 (리눅스 호스트에서 실제 값 표시)
        </Badge>
      )}

      {/* Keys */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">SSH 키</h3>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setKeyDialog(true)}>
            <Plus className="size-4" /> 키 생성
          </Button>
        </div>
        {(ssh?.keys ?? []).map((k) => (
          <div key={k.name} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <KeyRound className="size-4" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{k.name}</p>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {k.type} {k.bits}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{k.fingerprint}</p>
                  {k.comment && <p className="text-xs text-muted-foreground">{k.comment}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => copyPublicKey(k.publicKey)}
                >
                  <Copy className="size-4" /> 공개 키 복사
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => runSsh({ kind: "key.delete", name: k.name }, "키를 삭제했습니다")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {!ssh?.keys.length && <p className="text-sm text-muted-foreground">등록된 키가 없습니다.</p>}
      </div>

      {/* Known hosts */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">알려진 호스트</h3>
        <div className="flex gap-2">
          <Input
            placeholder="호스트 (예: nas2.local)"
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addHost()}
          />
          <Button variant="outline" disabled={busy || !newHost.trim()} onClick={addHost}>
            <Plus className="size-4" /> 호스트 추가
          </Button>
        </div>
        <div className="space-y-2">
          {(ssh?.knownHosts ?? []).map((h) => (
            <div
              key={`${h.host}-${h.type}`}
              className="flex items-center justify-between rounded-xl border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <p className="font-mono text-sm">{h.host}</p>
                <Badge variant="outline" className="text-[10px]">
                  {h.type}
                </Badge>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() =>
                  runSsh({ kind: "knownhost.remove", host: h.host }, "호스트를 제거했습니다")
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {!ssh?.knownHosts.length && (
            <p className="text-sm text-muted-foreground">알려진 호스트가 없습니다.</p>
          )}
        </div>
      </div>

      {/* Remotes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">원격 서버</h3>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoteDialog(true)}>
            <Plus className="size-4" /> 원격 추가
          </Button>
        </div>
        {(ssh?.remotes ?? []).map((r) => (
          <div key={r.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Plug className="size-4" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{r.label}</p>
                    {r.reachable === true && (
                      <Badge variant="secondary" className="text-[10px] text-emerald-600">
                        연결됨
                      </Badge>
                    )}
                    {r.reachable === false && (
                      <Badge variant="secondary" className="text-[10px] text-destructive">
                        연결 안 됨
                      </Badge>
                    )}
                    {r.reachable === null && (
                      <Badge variant="outline" className="text-[10px]">
                        미확인
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {r.user}@{r.host}:{r.port}
                  </p>
                  {r.keyName && <p className="text-xs text-muted-foreground">키: {r.keyName}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => runSsh({ kind: "remote.test", id: r.id }, "연결 테스트 완료")}
                >
                  <Plug className="size-4" /> 연결 테스트
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => runSsh({ kind: "remote.delete", id: r.id }, "원격을 삭제했습니다")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {!ssh?.remotes.length && (
          <p className="text-sm text-muted-foreground">등록된 원격 서버가 없습니다.</p>
        )}
      </div>

      {/* Generate key dialog */}
      <Dialog open={keyDialog} onOpenChange={(o) => !o && setKeyDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SSH 키 생성</DialogTitle>
            <DialogDescription>ed25519 키 쌍을 새로 생성합니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">키 이름</p>
              <Input
                placeholder="id_ed25519"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">설명 (comment)</p>
              <Input
                placeholder="admin@nas-server"
                value={keyComment}
                onChange={(e) => setKeyComment(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyDialog(false)} disabled={busy}>
              취소
            </Button>
            <Button onClick={generateKey} disabled={busy || !keyName.trim()}>
              생성
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add remote dialog */}
      <Dialog open={remoteDialog} onOpenChange={(o) => !o && setRemoteDialog(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>원격 서버 추가</DialogTitle>
            <DialogDescription>SSH로 접속할 원격 서버를 등록합니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">레이블</p>
              <Input placeholder="오프사이트 백업" value={rLabel} onChange={(e) => setRLabel(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">사용자</p>
                <Input placeholder="backup" value={rUser} onChange={(e) => setRUser(e.target.value)} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">포트</p>
                <Input
                  type="number"
                  placeholder="22"
                  value={rPort}
                  onChange={(e) => setRPort(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">호스트</p>
              <Input placeholder="nas2.local" value={rHost} onChange={(e) => setRHost(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">키 이름 (선택)</p>
              <Input placeholder="id_ed25519" value={rKeyName} onChange={(e) => setRKeyName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoteDialog(false)} disabled={busy}>
              취소
            </Button>
            <Button
              onClick={createRemote}
              disabled={busy || !rLabel.trim() || !rUser.trim() || !rHost.trim()}
            >
              추가
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

export function Settings() {
  const [section, setSection] = useState<SectionId>("general");
  const { data: overview } = usePoll<SystemOverview>("/api/overview", 4000);
  const { data: shares } = usePoll<ShareInfo[]>("/api/shares", 0);
  const { theme, toggle } = useTheme();
  const { accent, setAccent } = useAccent();

  const [shareState, setShareState] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<null | "restart" | "shutdown">(null);
  const [busy, setBusy] = useState(false);

  async function runPower(action: "restart" | "shutdown") {
    setBusy(true);
    try {
      const res = await fetch("/api/power", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(
          json.isMock
            ? `데모 모드: ${action === "restart" ? "재시작" : "종료"} 시뮬레이션`
            : `시스템 ${action === "restart" ? "재시작" : "종료"} 명령 전송됨`
        );
      } else {
        toast.error(json.error ?? "전원 명령 실패");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <div className="flex h-full bg-background">
      {/* Section nav */}
      <div className="w-48 shrink-0 border-r bg-muted/20 p-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
              section === s.id ? "bg-primary/10 font-medium text-primary" : "hover:bg-accent"
            )}
          >
            <s.icon className="size-4" />
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-6">
          {section === "general" && (
            <Panel title="일반" desc="시스템 기본 정보입니다.">
              <div className="rounded-xl border bg-card px-4">
                <HostnameRow />
                <Row label="운영체제" value={overview?.distro ?? "—"} />
                <Row label="커널" value={overview?.kernel ?? "—"} />
                <Row label="가동 시간" value={overview ? formatUptime(overview.uptimeSeconds) : "—"} />
                <Row label="CPU" value={overview?.cpu.model ?? "—"} hint={`${overview?.cpu.cores ?? 0} 코어`} />
                <Row
                  label="메모리"
                  value={overview ? `${formatBytes(overview.memory.totalBytes)}` : "—"}
                />
              </div>
              {overview?.isMock && (
                <Badge variant="secondary" className="gap-1">
                  <Info className="size-3" /> 데모 데이터 (리눅스 호스트에서 실제 값 표시)
                </Badge>
              )}
            </Panel>
          )}

          {section === "appearance" && (
            <Panel title="외관" desc="테마와 강조 색상을 설정합니다.">
              <div>
                <p className="mb-2 text-sm font-medium">테마</p>
                <div className="grid grid-cols-2 gap-3">
                  {(["light", "dark"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => theme !== t && toggle()}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                        theme === t ? "border-primary ring-1 ring-primary" : "hover:bg-accent"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 items-center justify-center rounded-lg",
                          t === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-100 text-slate-900"
                        )}
                      >
                        {t === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
                      </span>
                      <span className="text-sm font-medium">{t === "dark" ? "다크" : "라이트"}</span>
                      {theme === t && <Check className="ml-auto size-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">강조 색상</p>
                <div className="flex flex-wrap gap-3">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAccent(a.id)}
                      title={a.label}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                        accent === a.id ? "ring-foreground" : "ring-transparent"
                      )}
                      style={{ backgroundColor: a.swatch }}
                    >
                      {accent === a.id && <Check className="size-4 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {section === "network" && <NetworkSection />}

          {section === "time" && <TimeSection />}

          {section === "shares" && (
            <Panel title="공유 폴더" desc="SMB / NFS 공유를 관리합니다.">
              <div className="space-y-2">
                {(shares ?? []).map((s) => {
                  const enabled = shareState[s.name] ?? s.enabled;
                  return (
                    <div key={`${s.protocol}-${s.name}`} className="flex items-center justify-between rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          {s.guestOk ? <Users className="size-4" /> : s.readOnly ? <Lock className="size-4" /> : <FolderCog className="size-4" />}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{s.name}</p>
                            <Badge variant="outline" className="text-[10px] uppercase">{s.protocol}</Badge>
                            {s.readOnly && <Badge variant="secondary" className="text-[10px]">읽기 전용</Badge>}
                            {s.guestOk && <Badge variant="secondary" className="text-[10px]">게스트</Badge>}
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">{s.path}</p>
                        </div>
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(v) => {
                          setShareState((prev) => ({ ...prev, [s.name]: v }));
                          toast.message(`${s.name} ${v ? "활성화" : "비활성화"}`, {
                            description: "변경 적용은 권한 있는 백엔드 연결이 필요합니다.",
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {section === "ssh" && <SshSection />}

          {section === "power" && (
            <Panel title="전원" desc="시스템 전원을 제어합니다. root 또는 sudoers 권한이 필요합니다.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  onClick={() => setConfirm("restart")}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                    <RotateCcw className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">재시작</p>
                    <p className="text-xs text-muted-foreground">systemctl reboot</p>
                  </div>
                </button>
                <button
                  onClick={() => setConfirm("shutdown")}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-destructive/40 hover:bg-accent"
                >
                  <span className="flex size-10 items-center justify-center rounded-lg bg-red-500/15 text-red-500">
                    <Power className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">종료</p>
                    <p className="text-xs text-muted-foreground">systemctl poweroff</p>
                  </div>
                </button>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <span>
                  브라우저가 아니라 서버의 Node 프로세스가 명령을 실행합니다. 권한이 없으면 거부되며,
                  데모 모드에서는 실제로 실행되지 않습니다.
                </span>
              </div>
            </Panel>
          )}

          {section === "about" && (
            <Panel title="정보">
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="flex size-16 items-center justify-center rounded-[26%] bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white ring-1 ring-white/10">
                  <SlidersHorizontal className="size-7" />
                </div>
                <div>
                  <p className="text-lg font-semibold">Nimbo</p>
                  <p className="text-sm text-muted-foreground">버전 0.1.0</p>
                </div>
                <p className="max-w-xs text-xs text-muted-foreground">
                  리눅스 서버를 NAS처럼 관리하는 웹 콘솔. Next.js · 서버 사이드에서 OS 명령을 실행합니다.
                </p>
              </div>
            </Panel>
          )}
        </div>
      </ScrollArea>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "restart" ? "시스템 재시작" : "시스템 종료"}</DialogTitle>
            <DialogDescription>
              {confirm === "restart"
                ? "서버를 재시작합니다. 진행 중인 작업과 연결이 모두 중단됩니다."
                : "서버를 종료합니다. 물리적으로 다시 켜야 접속할 수 있습니다."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
              취소
            </Button>
            <Button
              variant={confirm === "shutdown" ? "destructive" : "default"}
              onClick={() => confirm && runPower(confirm)}
              disabled={busy}
            >
              {confirm === "restart" ? "재시작" : "종료"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
