import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/guard";
import { logAudit } from "@/lib/system/audit";
import { getMountOverview, runMountAction } from "@/lib/system/mounts";
import type { MountAction } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const data = await getMountOverview();
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json()) as MountAction;
    if (!body?.kind) {
      return NextResponse.json({ ok: false, error: "작업 종류가 필요합니다." }, { status: 400 });
    }
    const result = await runMountAction(body);
    // Never log the credential fields — only the target being acted on.
    const target = "mountpoint" in body ? body.mountpoint : "-";
    logAudit(gate.user, `Mount: ${body.kind}`, target ?? "-", result.ok ? "success" : "failed");
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
