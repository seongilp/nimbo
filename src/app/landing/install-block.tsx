"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";

import { cn } from "@/lib/utils";

const COMMAND = "curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | sudo bash";

export function InstallBlock() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = COMMAND;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="클릭하면 복사됩니다"
      className={cn(
        "group block w-full overflow-hidden rounded-2xl border text-left shadow-soft transition-colors",
        copied
          ? "border-emerald-500/60 bg-emerald-500/10"
          : "border-white/10 bg-background/80 hover:border-primary/40"
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b px-4 py-2.5 transition-colors",
          copied ? "border-emerald-500/30" : "border-white/10"
        )}
      >
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">install</span>
        <span
          className={cn(
            "ml-auto flex items-center gap-1 text-xs font-medium transition-colors",
            copied ? "text-emerald-500" : "text-muted-foreground group-hover:text-foreground"
          )}
        >
          {copied ? (
            <>
              <Check className="size-3.5" /> 복사됨!
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> 복사
            </>
          )}
        </span>
      </div>
      <pre className="overflow-x-auto p-5 text-[13px] leading-relaxed">
        <code className="font-mono">
          <span className="text-muted-foreground select-none">$ </span>
          curl -fsSL https://raw.githubusercontent.com/seongilp/nimbo/main/deploy/bootstrap.sh | <span className="text-primary">sudo</span> bash
        </code>
      </pre>
    </button>
  );
}
