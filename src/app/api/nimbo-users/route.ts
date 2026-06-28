import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAuthConfig, runAuthAdminAction, verifyToken, type AuthAdminAction } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function requireAdmin(): Promise<boolean> {
  const token = (await cookies()).get("nimbo_session")?.value;
  return verifyToken(token)?.r === "admin";
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "관리자 권한이 필요합니다" }, { status: 403 });
  const data = await getAuthConfig();
  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "관리자 권한이 필요합니다" }, { status: 403 });
  try {
    const body = (await request.json()) as AuthAdminAction;
    const result = await runAuthAdminAction(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
