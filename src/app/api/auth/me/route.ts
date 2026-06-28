import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { verifyToken } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const token = (await cookies()).get("nimbo_session")?.value;
  const session = verifyToken(token);
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, user: session.u });
}
