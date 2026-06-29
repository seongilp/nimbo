import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/guard";

import { getZfsOverview, runZfsAction, type ZfsAction } from "@/lib/system/zfs";
import { logAudit } from "@/lib/system/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await getZfsOverview();
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json()) as ZfsAction;
    if (!body.kind) {
      return NextResponse.json({ ok: false, error: "action kind required" }, { status: 400 });
    }
    const result = await runZfsAction(body);
    logAudit(gate.user, `ZFS: ${body.kind}`, body.name ?? body.target ?? "-", result.ok ? "success" : "failed");
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
