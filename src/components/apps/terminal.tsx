"use client";

import dynamic from "next/dynamic";

// Both terminals use the libghostty (ghostty-web) renderer, loaded client-only
// (WASM must not run during SSR). They differ only in the data source:
//   - demo (Vercel): sandboxed mock via a client-side line editor (no PTY).
//   - real server: an interactive PTY streamed over a WebSocket.
const DEMO = process.env.NEXT_PUBLIC_NIMBO_DEMO === "1";

const loading = () => <div className="h-full bg-[#0a0c12]" />;

const TerminalGhostty = dynamic(
  () => import("./terminal-ghostty").then((m) => m.TerminalGhostty),
  { ssr: false, loading }
);
const TerminalDemoGhostty = dynamic(
  () => import("./terminal-demo-ghostty").then((m) => m.TerminalDemoGhostty),
  { ssr: false, loading }
);

export function Terminal() {
  return DEMO ? <TerminalDemoGhostty /> : <TerminalGhostty />;
}
