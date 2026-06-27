"use client";

import { useState } from "react";
import { Box, Play, Square, RotateCcw, Network, Cpu, MemoryStick } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContainerInfo } from "@/lib/types";

const STATE_DOT: Record<ContainerInfo["state"], string> = {
  running: "bg-emerald-500",
  exited: "bg-muted-foreground",
  paused: "bg-amber-500",
  restarting: "bg-sky-500 animate-pulse",
  created: "bg-sky-400",
  dead: "bg-red-500",
};

export function ContainerManager() {
  const { data: containers, loading, refresh } = usePoll<ContainerInfo[]>("/api/docker", 3000);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: string, name: string) {
    setBusy(id + action);
    try {
      const res = await fetch("/api/docker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`${name}: ${action} succeeded`);
        refresh();
      } else {
        toast.error(`${name}: ${json.error ?? "failed"}`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const running = containers?.filter((c) => c.state === "running").length ?? 0;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="secondary" className="gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" />
            {running} running
          </Badge>
          <span className="text-muted-foreground">{containers?.length ?? 0} total</span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
          {loading && !containers
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)
            : containers?.map((c) => {
                const memPct = c.memLimitBytes > 0 ? (c.memUsageBytes / c.memLimitBytes) * 100 : 0;
                const isRunning = c.state === "running";
                return (
                  <Card key={c.id} className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Box className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[c.state])} />
                            <span className="truncate font-medium">{c.name}</span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground" title={c.image}>
                            {c.image}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                        {c.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                        <p className="flex items-center gap-1 text-muted-foreground">
                          <Cpu className="size-3" /> CPU
                        </p>
                        <p className="font-medium tabular-nums">{c.cpuPercent.toFixed(1)}%</p>
                      </div>
                      <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                        <p className="flex items-center gap-1 text-muted-foreground">
                          <MemoryStick className="size-3" /> Memory
                        </p>
                        <p className="font-medium tabular-nums">
                          {formatBytes(c.memUsageBytes)}
                          {c.memLimitBytes > 0 && (
                            <span className="text-muted-foreground"> · {memPct.toFixed(0)}%</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {c.ports.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Network className="size-3.5 text-muted-foreground" />
                        {c.ports.map((p) => (
                          <Badge key={p} variant="secondary" className="font-mono text-[10px] font-normal">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-muted-foreground">
                        created {formatRelative(c.createdAt)}
                      </span>
                      <div className="flex gap-1.5">
                        {isRunning ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              disabled={busy === c.id + "restart"}
                              onClick={() => act(c.id, "restart", c.name)}
                            >
                              <RotateCcw className="size-3.5" /> Restart
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-600"
                              disabled={busy === c.id + "stop"}
                              onClick={() => act(c.id, "stop", c.name)}
                            >
                              <Square className="size-3.5" /> Stop
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-emerald-600 hover:text-emerald-600"
                            disabled={busy === c.id + "start"}
                            onClick={() => act(c.id, "start", c.name)}
                          >
                            <Play className="size-3.5" /> Start
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
        </div>
      </ScrollArea>
    </div>
  );
}
