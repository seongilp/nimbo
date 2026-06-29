import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/guard";

import { run, USE_MOCK } from "@/lib/system/exec";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Privileged OS actions. On a real host these require root or a sudoers rule
// (e.g. allow the service user to run `systemctl reboot`/`poweroff` only).
const COMMANDS: Record<string, string> = {
  restart: "systemctl reboot",
  shutdown: "systemctl poweroff",
};

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json()) as { action?: string };
    const cmd = body.action ? COMMANDS[body.action] : undefined;
    if (!cmd) {
      return NextResponse.json({ ok: false, error: "Unknown power action" }, { status: 400 });
    }
    if (USE_MOCK) {
      // Demo mode — never actually power off the dev machine.
      return NextResponse.json({ ok: true, isMock: true });
    }
    const { code, stderr } = await run(cmd, { timeoutMs: 10000 });
    return code === 0
      ? NextResponse.json({ ok: true })
      : NextResponse.json(
          { ok: false, error: stderr.trim() || "Permission denied — needs root/sudoers" },
          { status: 403 }
        );
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
