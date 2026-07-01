"use client";

import dynamic from "next/dynamic";

import { TerminalDemo } from "./terminal-demo";

// Public demo (Vercel serverless) can't hold a PTY/WebSocket, so it uses the
// sandboxed line terminal. The real server uses the libghostty (ghostty-web)
// interactive PTY terminal, loaded client-only (WASM must not run during SSR).
const DEMO = process.env.NEXT_PUBLIC_NIMBO_DEMO === "1";

const TerminalGhostty = dynamic(
  () => import("./terminal-ghostty").then((m) => m.TerminalGhostty),
  { ssr: false, loading: () => <div className="h-full bg-[#0a0c12]" /> }
);

export function Terminal() {
  return DEMO ? <TerminalDemo /> : <TerminalGhostty />;
}
