import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/guard";
import { getAcl, runAclAction } from "@/lib/system/acl";
import { logAudit } from "@/lib/system/audit";
import type { AclAction } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const target = new URL(request.url).searchParams.get("path") ?? "";
    if (!target) return NextResponse.json({ ok: false, error: "경로가 필요합니다." }, { status: 400 });
    const data = await getAcl(target);
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json()) as AclAction;
    if (!body?.kind) {
      return NextResponse.json({ ok: false, error: "작업 종류가 필요합니다." }, { status: 400 });
    }
    const result = await runAclAction(body);
    logAudit(gate.user, `ACL: ${body.kind}`, body.path ?? "-", result.ok ? "success" : "failed");
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
