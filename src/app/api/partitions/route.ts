import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/guard";
import { logAudit } from "@/lib/system/audit";
import { getPartitionOverview, runPartitionAction } from "@/lib/system/partitions";
import type { PartitionAction } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const data = await getPartitionOverview();
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json()) as PartitionAction;
    if (!body?.kind) {
      return NextResponse.json({ ok: false, error: "작업 종류가 필요합니다." }, { status: 400 });
    }
    const result = await runPartitionAction(body);
    logAudit(gate.user, `Partition: ${body.kind}`, body.device ?? "-", result.ok ? "success" : "failed");
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
