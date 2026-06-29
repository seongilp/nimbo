import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/guard";

import { containerAction, getContainers } from "@/lib/system/docker";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const data = await getContainers();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;
    const body = (await request.json()) as { id?: string; action?: string };
    if (!body.id || !body.action) {
      return NextResponse.json({ ok: false, error: "id and action are required" }, { status: 400 });
    }
    const result = await containerAction(body.id, body.action);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
