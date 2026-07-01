"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// Demo terminal: the SAME libghostty (ghostty-web) renderer as the real
// terminal, but with no PTY. A tiny client-side line editor echoes input and,
// on Enter, runs the line through the sandboxed /api/terminal mock. Purely for
// show — nothing is ever executed on a real shell.

const GREEN = "\x1b[1;32m";
const BLUE = "\x1b[1;34m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function TerminalDemoGhostty() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let term: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fit: any = null;
    let ro: ResizeObserver | null = null;

    let cwd = "/home/admin";
    let user = "admin";
    let host = "nimbo-demo";
    let line = "";
    let busy = false;
    const history: string[] = [];
    let hidx: number | null = null;

    const prompt = () => `${GREEN}${user}@${host}${RESET}:${BLUE}${cwd}${RESET}$ `;
    const writePrompt = () => term.write("\r\n" + prompt());

    async function runLine() {
      const cmd = line;
      line = "";
      term.write("\r\n");
      const trimmed = cmd.trim();
      if (trimmed === "clear") {
        term.clear();
        term.write(prompt());
        return;
      }
      if (trimmed) history.push(trimmed);
      hidx = null;
      if (!trimmed) {
        term.write(prompt());
        return;
      }
      busy = true;
      try {
        const res = await fetch("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: trimmed, cwd }),
        });
        const j = await res.json();
        if (j.ok) {
          if (j.output) term.write(j.output.replace(/\r?\n/g, "\r\n") + "\r\n");
          if (j.cwd) cwd = j.cwd;
        } else {
          term.write(`${RED}${j.error || "요청 실패"}${RESET}\r\n`);
        }
      } catch (err) {
        term.write(`${RED}${(err as Error).message}${RESET}\r\n`);
      } finally {
        busy = false;
        term.write(prompt());
      }
    }

    function replaceLine(next: string) {
      if (line.length) term.write("\b".repeat(line.length) + " ".repeat(line.length) + "\b".repeat(line.length));
      line = next;
      term.write(next);
    }

    function onData(d: string) {
      if (busy) return;
      if (d === "\r") return void runLine();
      if (d === "\x7f") {
        if (line.length) {
          line = line.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }
      if (d === "\x03") {
        // Ctrl+C
        line = "";
        term.write("^C");
        writePrompt();
        return;
      }
      if (d === "\x0c") {
        // Ctrl+L
        term.clear();
        term.write(prompt() + line);
        return;
      }
      if (d === "\x1b[A") {
        // Up
        if (history.length) {
          hidx = hidx === null ? history.length - 1 : Math.max(0, hidx - 1);
          replaceLine(history[hidx]);
        }
        return;
      }
      if (d === "\x1b[B") {
        // Down
        if (hidx !== null) {
          hidx = hidx + 1;
          if (hidx >= history.length) { hidx = null; replaceLine(""); }
          else replaceLine(history[hidx]);
        }
        return;
      }
      // ignore other escape sequences (arrows left/right, etc.)
      if (d.charCodeAt(0) === 0x1b) return;
      // printable (handles pastes too)
      const clean = d.replace(/[\x00-\x1f]/g, "");
      if (clean) {
        line += clean;
        term.write(clean);
      }
    }

    (async () => {
      const [mod] = await Promise.all([
        import("ghostty-web"),
        fetch("/api/auth/me").then((r) => r.json()).then((j) => j.ok && (user = j.user)).catch(() => {}),
      ]);
      await fetch("/api/overview").then((r) => r.json()).then((j) => j.ok && (host = j.data?.hostname || host)).catch(() => {});
      await mod.init();
      if (disposed || !hostRef.current) return;

      term = new mod.Terminal({
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", monospace',
        cursorBlink: true,
        scrollback: 2000,
        theme: { background: "#0a0c12", foreground: "#e2e8f0" },
      });
      fit = new mod.FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      try { fit.fit(); } catch {}
      setStatus("ready");

      term.write(`${DIM}Nimbo 데모 터미널 · libghostty 렌더러 (샌드박스 — 실제 실행 없음). 'help' 입력.${RESET}\r\n`);
      term.write(prompt());
      term.focus();
      term.onData(onData);

      ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
      ro.observe(hostRef.current);
    })().catch(() => !disposed && setStatus("error"));

    return () => {
      disposed = true;
      try { ro?.disconnect(); } catch {}
      try { term?.dispose(); } catch {}
    };
  }, []);

  return (
    <div className="relative flex h-full flex-col bg-[#0a0c12]">
      {status !== "ready" && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-[#0a0c12]/90 px-3 py-1.5 text-xs">
          {status === "loading" ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-sky-400" />
              <span className="text-slate-300">libghostty 로딩 중…</span>
            </>
          ) : (
            <span className="text-rose-400">터미널을 초기화할 수 없습니다.</span>
          )}
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden p-1.5" onClick={() => hostRef.current?.querySelector("textarea")?.focus()} />
    </div>
  );
}
