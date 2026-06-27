"use client";

import { useState } from "react";
import {
  Activity,
  Battery,
  BatteryCharging,
  Cpu,
  Plug,
  Radio,
  Save,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { RadialGauge } from "@/components/charts/radial-gauge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePoll } from "@/lib/hooks/use-poll";
import { cn } from "@/lib/utils";
import type { HardwareOverview, SnmpConfig, UpsStatus } from "@/lib/types";

type Act = (body: Record<string, unknown>, msg: string) => void;

const UPS_STATUS: Record<
  UpsStatus["status"],
  { label: string; cls: string; gauge: string }
> = {
  online: { label: "정상", cls: "bg-emerald-500/15 text-emerald-500", gauge: "var(--chart-1)" },
  charging: { label: "충전 중", cls: "bg-sky-500/15 text-sky-500", gauge: "var(--chart-2)" },
  onbattery: { label: "배터리 모드", cls: "bg-amber-500/15 text-amber-500", gauge: "#f59e0b" },
  lowbattery: { label: "배터리 부족", cls: "bg-red-500/15 text-red-500", gauge: "#ef4444" },
  offline: { label: "오프라인", cls: "bg-muted text-muted-foreground", gauge: "var(--muted-foreground)" },
};

const UPS_MODE_LABEL: Record<HardwareOverview["upsMode"], string> = {
  standalone: "단독 (standalone)",
  netserver: "네트워크 서버 (netserver)",
  netclient: "네트워크 클라이언트 (netclient)",
};

function formatRuntime(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return `약 ${mins}분`;
}

export function Hardware() {
  const { data, refresh } = usePoll<HardwareOverview>("/api/hardware", 3000);
  const [busy, setBusy] = useState(false);

  const act: Act = async (body, msg) => {
    setBusy(true);
    try {
      const res = await fetch("/api/hardware", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(json.note ?? msg);
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

  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="ups" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <TabsList>
            <TabsTrigger value="ups">
              <BatteryCharging className="size-3.5" /> UPS
            </TabsTrigger>
            <TabsTrigger value="snmp">
              <Radio className="size-3.5" /> SNMP
            </TabsTrigger>
          </TabsList>
          {data?.isMock && (
            <Badge variant="secondary" className="text-[10px]">
              demo
            </Badge>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="ups" className="m-0 space-y-3 p-4">
            {data && <UpsPanel data={data} act={act} busy={busy} />}
          </TabsContent>
          <TabsContent value="snmp" className="m-0 p-4">
            {data && <SnmpPanel snmp={data.snmp} act={act} busy={busy} />}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function UpsPanel({ data, act, busy }: { data: HardwareOverview; act: Act; busy: boolean }) {
  const ups = data.ups;

  if (!ups.connected) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Plug className="size-6" />
        </span>
        <div>
          <p className="font-medium">UPS가 연결되지 않았습니다</p>
          <p className="mt-1 text-sm text-muted-foreground">
            NUT(upsd)에 등록된 UPS가 없습니다. USB/네트워크 UPS 연결을 확인하세요.
          </p>
        </div>
      </Card>
    );
  }

  const st = UPS_STATUS[ups.status];
  return (
    <>
      <Card className="flex flex-wrap items-center gap-5 p-5">
        <RadialGauge
          value={ups.batteryPercent}
          size={120}
          stroke={11}
          color={st.gauge}
          sublabel="배터리"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{ups.model}</span>
            <Badge className={cn("gap-1 border-0", st.cls)}>
              {ups.status === "onbattery" || ups.status === "lowbattery" ? (
                <Battery className="size-3.5" />
              ) : (
                <BatteryCharging className="size-3.5" />
              )}
              {st.label}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric icon={<Activity className="size-4" />} label="부하" value={`${ups.loadPercent}%`} />
            <Metric
              icon={<BatteryCharging className="size-4" />}
              label="예상 가동시간"
              value={formatRuntime(ups.runtimeSeconds)}
            />
            <Metric icon={<Zap className="size-4" />} label="입력 전압" value={`${ups.inputVoltage} V`} />
          </div>
        </div>
      </Card>

      <PolicyCard data={data} act={act} busy={busy} />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-medium">배터리 테스트</p>
          <p className="text-xs text-muted-foreground">
            짧은 셀프 테스트를 실행해 배터리 상태를 점검합니다.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-1.5"
          disabled={busy}
          onClick={() => act({ kind: "ups.test" }, "배터리 테스트를 시작했습니다")}
        >
          <Battery className="size-4" /> 배터리 테스트
        </Button>
      </Card>
    </>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PolicyCard({ data, act, busy }: { data: HardwareOverview; act: Act; busy: boolean }) {
  const [delay, setDelay] = useState(String(data.shutdownDelaySeconds));
  const [percent, setPercent] = useState(String(data.shutdownAtPercent));
  const [mode, setMode] = useState<HardwareOverview["upsMode"]>(data.upsMode);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Cpu className="size-4 text-muted-foreground" /> 종료 정책
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          종료 지연(초)
          <Input
            type="number"
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
            min={0}
            max={3600}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          종료 배터리(%)
          <Input
            type="number"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            min={0}
            max={100}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          모드
          <select
            className="flex h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as HardwareOverview["upsMode"])}
          >
            {(["standalone", "netserver", "netclient"] as const).map((m) => (
              <option key={m} value={m}>
                {UPS_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end">
        <Button
          className="gap-1.5"
          disabled={busy}
          onClick={() =>
            act(
              {
                kind: "ups.setPolicy",
                shutdownDelaySeconds: Number(delay),
                shutdownAtPercent: Number(percent),
                upsMode: mode,
              },
              "종료 정책을 저장했습니다"
            )
          }
        >
          <Save className="size-4" /> 저장
        </Button>
      </div>
    </Card>
  );
}

function SnmpPanel({ snmp, act, busy }: { snmp: SnmpConfig; act: Act; busy: boolean }) {
  const [enabled, setEnabled] = useState(snmp.enabled);
  const [version, setVersion] = useState<SnmpConfig["version"]>(snmp.version);
  const [community, setCommunity] = useState(snmp.community);
  const [port, setPort] = useState(String(snmp.port));
  const [location, setLocation] = useState(snmp.location);
  const [contact, setContact] = useState(snmp.contact);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-lg",
              enabled ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
            )}
          >
            <Radio className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium">SNMP 데몬 {enabled ? "활성화" : "비활성화"}</p>
            <p className="text-xs text-muted-foreground">
              Zabbix·PRTG 같은 모니터링 도구가 SNMP로 이 NAS를 폴링할 수 있습니다.
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={busy} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          버전
          <select
            className="flex h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={version}
            onChange={(e) => setVersion(e.target.value as SnmpConfig["version"])}
          >
            <option value="v2c">v2c</option>
            <option value="v3">v3</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          포트
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} min={1} max={65535} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          커뮤니티
          <Input value={community} onChange={(e) => setCommunity(e.target.value)} placeholder="public" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          위치
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="서버실 랙 A" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
          담당자
          <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="admin@nas.local" />
        </label>
      </div>

      <div className="flex justify-end">
        <Button
          className="gap-1.5"
          disabled={busy}
          onClick={() =>
            act(
              {
                kind: "snmp.update",
                enabled,
                version,
                community: community.trim(),
                port: Number(port),
                location: location.trim(),
                contact: contact.trim(),
              },
              "SNMP 설정을 저장했습니다"
            )
          }
        >
          <Save className="size-4" /> 저장
        </Button>
      </div>
    </Card>
  );
}
