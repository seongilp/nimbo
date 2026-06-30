import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/guard";
import { runTerminalCommand } from "@/lib/system/terminal";
import { logAudit } from "@/lib/system/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;

    const body = (await request.json()) as { command?: string; cwd?: string };
    const command = (body.command ?? "").trim();
    // Empty cwd lets runTerminalCommand pick the right base for the mode.
    const result = await runTerminalCommand(command, body.cwd ?? "");

    // Audit every executed command (truncated) with the real user.
    if (command) {
      logAudit(gate.user, "터미널", command.slice(0, 200), result.code === 0 ? "success" : "failed");
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
