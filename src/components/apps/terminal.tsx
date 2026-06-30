"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

type Line =
  | { kind: "cmd"; prompt: string; cmd: string }
  | { kind: "out" | "err" | "sys"; text: string };

export function Terminal() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: "Nimbo 터미널 — 'help' 를 입력해 보세요. (Ctrl+L: 지우기, ↑/↓: 기록)" },
  ]);
  const [cwd, setCwd] = useState("~");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState("admin");
  const [host, setHost] = useState("nimbo");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => j.ok && setUser(j.user)).catch(() => {});
    fetch("/api/overview").then((r) => r.json()).then((j) => j.ok && setHost(j.data?.hostname || "nimbo")).catch(() => {});
    // Resolve the starting working directory from the server.
    fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "", cwd: "" }),
    })
      .then((r) => r.json())
      .then((j) => j.ok && j.cwd && setCwd(j.cwd))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  function promptStr(dir: string): string {
    return `${user}@${host}:${dir}$`;
  }

  async function runCommand(raw: string) {
    const cmd = raw.trim();
    setLines((l) => [...l, { kind: "cmd", prompt: promptStr(cwd), cmd: raw }]);
    if (cmd) setHistory((h) => [...h, cmd]);
    setHistIdx(null);
    if (cmd === "clear") {
      setLines([]);
      return;
    }
    if (!cmd) return;
    setBusy(true);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, cwd }),
      });
      const j = await res.json();
      if (!j.ok) {
        setLines((l) => [...l, { kind: "err", text: j.error || "명령 실행 실패" }]);
      } else {
        if (j.output) setLines((l) => [...l, { kind: j.code === 0 ? "out" : "err", text: j.output }]);
        if (j.cwd) setCwd(j.cwd);
      }
    } catch (err) {
      setLines((l) => [...l, { kind: "err", text: (err as Error).message }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function navHistory(dir: -1 | 1) {
    if (history.length === 0) return;
    const start = histIdx === null ? history.length : histIdx;
    const idx = Math.max(0, Math.min(history.length, start + dir));
    setHistIdx(idx);
    setInput(idx >= history.length ? "" : history[idx]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const c = input;
      setInput("");
      void runCommand(c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navHistory(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navHistory(1);
    } else if (e.key.toLowerCase() === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  }

  return (
    <div
      className="flex h-full flex-col bg-[#0a0c12] font-mono text-[13px] text-slate-200"
      onClick={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 leading-relaxed">
        {lines.map((ln, i) =>
          ln.kind === "cmd" ? (
            <div key={i} className="flex flex-wrap gap-x-2 break-all">
              <span className="text-emerald-400">{ln.prompt}</span>
              <span className="text-slate-100">{ln.cmd}</span>
            </div>
          ) : (
            <pre
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                ln.kind === "err" && "text-rose-400",
                ln.kind === "sys" && "text-sky-400/80",
                ln.kind === "out" && "text-slate-300"
              )}
            >
              {ln.text}
            </pre>
          )
        )}

        {/* live input line */}
        <div className="flex items-start gap-2 break-all">
          <span className="shrink-0 text-emerald-400">{promptStr(cwd)}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            aria-label="터미널 명령 입력"
            className="min-w-0 flex-1 bg-transparent text-slate-100 caret-emerald-400 outline-none disabled:opacity-60"
          />
        </div>
      </div>
    </div>
  );
}
