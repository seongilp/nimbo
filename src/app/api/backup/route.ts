import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/guard";

import { getBackupOverview, runBackupAction, type BackupAction } from "@/lib/system/rsync";
import { logAudit } from "@/lib/system/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await getBackupOverview();
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json()) as BackupAction;
    if (!body.kind) {
      return NextResponse.json({ ok: false, error: "action kind required" }, { status: 400 });
    }
    const result = await runBackupAction(body);
    logAudit(gate.user, `Backup: ${body.kind}`, body.name ?? body.id ?? "-", result.ok ? "success" : "failed");
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
