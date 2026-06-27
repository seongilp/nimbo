"use client";

import { useMemo, useState } from "react";
import { ScrollText, Search, CheckCircle2, XCircle, Trash2, User } from "lucide-react";
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
import { usePoll } from "@/lib/hooks/use-poll";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditEntry, AuditOverview } from "@/lib/types";

type ResultFilter = "all" | "success" | "failed";

const RESULT_FILTERS: Array<{ key: ResultFilter; label: string }> = [
  { key: "all", label: "전체" },
  { key: "success", label: "성공" },
  { key: "failed", label: "실패" },
];

export function AuditLog() {
  const { data, refresh } = usePoll<AuditOverview>("/api/audit", 5000);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/audit", {
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
      setConfirmOpen(false);
    }
  };

  const entries = useMemo(() => data?.entries ?? [], [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter !== "all" && e.result !== filter) return false;
      if (!q) return true;
      return (
        e.user.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.target.toLowerCase().includes(q)
      );
    });
  }, [entries, query, filter]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="사용자 / 작업 / 대상 검색"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {RESULT_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs text-destructive"
          disabled={busy || entries.length === 0}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-3.5" /> 기록 지우기
        </Button>
        {data?.isMock && <Badge variant="secondary" className="text-[10px]">demo</Badge>}
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ScrollText className="size-3.5" /> 전체 {entries.length.toLocaleString()}건
        </span>
        <span className="ml-auto">{filtered.length.toLocaleString()}건 표시</span>
      </div>

      {/* Table */}
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">시각</th>
              <th className="px-3 py-2 font-medium">사용자</th>
              <th className="px-3 py-2 font-medium">작업</th>
              <th className="px-3 py-2 font-medium">대상</th>
              <th className="px-3 py-2 font-medium">결과</th>
              <th className="px-3 py-2 text-right font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry, i) => (
              <AuditRow key={entry.id} entry={entry} zebra={i % 2 === 1} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  표시할 감사 기록이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>

      {/* Clear confirm */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>감사 기록 지우기</DialogTitle>
            <DialogDescription>
              모든 감사 로그 항목을 삭제합니다. 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => act({ kind: "audit.clear" }, "감사 기록을 지웠습니다")}
            >
              지우기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditRow({ entry, zebra }: { entry: AuditEntry; zebra: boolean }) {
  const ok = entry.result === "success";
  return (
    <tr
      className={cn(
        "border-b border-border/40 last:border-0 hover:bg-accent/30",
        zebra && "bg-muted/30"
      )}
    >
      <td className="px-4 py-2 align-top">
        <div className="whitespace-nowrap tabular-nums">
          {new Date(entry.ts).toLocaleString("ko-KR")}
        </div>
        <div className="text-xs text-muted-foreground">{formatRelative(entry.ts)}</div>
      </td>
      <td className="px-3 py-2 align-top">
        <Badge variant="outline" className="gap-1 text-[11px]">
          <User className="size-3" /> {entry.user}
        </Badge>
      </td>
      <td className="px-3 py-2 align-top">{entry.action}</td>
      <td className="max-w-56 truncate px-3 py-2 align-top font-mono text-xs text-muted-foreground">
        {entry.target}
      </td>
      <td className="px-3 py-2 align-top">
        <Badge
          className={cn(
            "gap-1 border-0",
            ok ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"
          )}
        >
          {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
          {ok ? "성공" : "실패"}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right align-top font-mono text-xs text-muted-foreground">
        {entry.ip}
      </td>
    </tr>
  );
}
