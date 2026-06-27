import { NextResponse } from "next/server";

import { getSharesAdminOverview, runSharesAction, type SharesAction } from "@/lib/system/shares-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await getSharesAdminOverview();
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SharesAction;
    if (!body.kind) {
      return NextResponse.json({ ok: false, error: "action kind required" }, { status: 400 });
    }
    const result = await runSharesAction(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
