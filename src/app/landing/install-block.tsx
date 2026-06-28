"use client";

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";

const COMMAND = "git clone https://github.com/seongilp/nimbo && cd nimbo && sudo ./deploy/install.sh";

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
      className="group block w-full overflow-hidden rounded-2xl border border-white/10 bg-background/80 text-left shadow-soft transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">install</span>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
          {copied ? (
            <>
              <Check className="size-3.5 text-emerald-500" /> 복사됨
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
          git clone https://github.com/seongilp/nimbo &amp;&amp; cd nimbo
          {"\n"}
          <span className="text-muted-foreground select-none">$ </span>
          <span className="text-primary">sudo</span> ./deploy/install.sh
        </code>
      </pre>
    </button>
  );
}
