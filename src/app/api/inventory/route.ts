import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/guard";
import { clearDiskHistory, getDiskHistory, getInventory, setDiskLocation } from "@/lib/system/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("view") === "history") {
      const data = await getDiskHistory();
      return NextResponse.json({ ok: true, data, isMock: data.isMock });
    }
    const data = await getInventory();
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

interface InventoryAction {
  kind: string;
  stableId?: string;
  label?: string;
  bay?: string;
  note?: string;
}

export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (gate instanceof NextResponse) return gate;

    const body = (await request.json()) as InventoryAction;
    switch (body.kind) {
      case "location.set": {
        const res = await setDiskLocation(body.stableId ?? "", { label: body.label, bay: body.bay, note: body.note });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      case "history.clear": {
        const res = await clearDiskHistory();
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }
      default:
        return NextResponse.json({ ok: false, error: "알 수 없는 작업입니다" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
