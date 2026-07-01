"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plug, RotateCw } from "lucide-react";

// Interactive terminal powered by libghostty (ghostty-web WASM) over a PTY
// WebSocket bridge. Real-server only — the demo uses the sandboxed line
// terminal instead (this component is never rendered there).
//
// Override the WS endpoint for local dev with NEXT_PUBLIC_TERMINAL_WS_URL
// (e.g. ws://localhost:3001/api/terminal/ws). Empty = same-origin, proxied to
// the PTY sidecar by Caddy.
const WS_OVERRIDE = process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "";

type Status = "loading" | "connecting" | "open" | "closed" | "error";

function wsUrl(): string {
  if (WS_OVERRIDE) return WS_OVERRIDE;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/terminal/ws`;
}

export function TerminalGhostty() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let term: any = null;
    let ws: WebSocket | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fit: any = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      const mod = await import("ghostty-web");
      await mod.init();
      if (disposed || !hostRef.current) return;

      term = new mod.Terminal({
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", monospace',
        cursorBlink: true,
        scrollback: 5000,
        theme: { background: "#0a0c12", foreground: "#e2e8f0" },
      });
      fit = new mod.FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      try { fit.fit(); } catch {}

      setStatus("connecting");
      ws = new WebSocket(wsUrl());

      const sendResize = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "r", c: term.cols, r: term.rows }));
        }
      };

      ws.onopen = () => {
        if (disposed) return;
        setStatus("open");
        try { fit.fit(); } catch {}
        sendResize();
        term.focus();
      };
      ws.onmessage = (e: MessageEvent) => {
        term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
      };
      ws.onclose = () => !disposed && setStatus((s) => (s === "error" ? s : "closed"));
      ws.onerror = () => !disposed && setStatus("error");

      term.onData((d: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "i", d }));
      });
      term.onResize(() => sendResize());

      ro = new ResizeObserver(() => {
        try { fit.fit(); } catch {}
      });
      ro.observe(hostRef.current);
    })().catch(() => !disposed && setStatus("error"));

    return () => {
      disposed = true;
      try { ro?.disconnect(); } catch {}
      try { ws?.close(); } catch {}
      try { term?.dispose(); } catch {}
    };
  }, [attempt]);

  return (
    <div className="relative flex h-full flex-col bg-[#0a0c12]">
      {status !== "open" && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-[#0a0c12]/90 px-3 py-1.5 text-xs">
          {status === "loading" && (
            <>
              <Loader2 className="size-3.5 animate-spin text-sky-400" />
              <span className="text-slate-300">libghostty 로딩 중…</span>
            </>
          )}
          {status === "connecting" && (
            <>
              <Loader2 className="size-3.5 animate-spin text-sky-400" />
              <span className="text-slate-300">PTY 세션 연결 중…</span>
            </>
          )}
          {status === "closed" && (
            <>
              <Plug className="size-3.5 text-amber-400" />
              <span className="text-slate-300">세션이 종료되었습니다.</span>
              <button onClick={() => setAttempt((a) => a + 1)} className="ml-auto inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-slate-200 hover:bg-white/20">
                <RotateCw className="size-3" /> 새 세션
              </button>
            </>
          )}
          {status === "error" && (
            <>
              <Plug className="size-3.5 text-rose-400" />
              <span className="text-slate-300">터미널 서버에 연결할 수 없습니다 (리버스 프록시/터미널 서비스 확인).</span>
              <button onClick={() => setAttempt((a) => a + 1)} className="ml-auto inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-slate-200 hover:bg-white/20">
                <RotateCw className="size-3" /> 재시도
              </button>
            </>
          )}
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-1.5" onClick={() => hostRef.current?.querySelector("textarea")?.focus()} />
    </div>
  );
}
