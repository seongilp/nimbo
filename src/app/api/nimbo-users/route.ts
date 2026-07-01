import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAuthConfig, runAuthAdminAction, verifyToken, type AuthAdminAction } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function requireAdmin(): Promise<boolean> {
  const token = (await cookies()).get("nimbo_session")?.value;
  return verifyToken(token)?.r === "admin";
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function GET(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "관리자 권한이 필요합니다" }, { status: 403 });
  const data = await getAuthConfig();
  // Surface the caller's IP so the UI can offer "add current IP" (not persisted).
  return NextResponse.json({ ok: true, data: { ...data, currentIp: clientIp(request) } });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "관리자 권한이 필요합니다" }, { status: 403 });
  try {
    const body = (await request.json()) as AuthAdminAction;
    // Server-authoritative IP for ip.addCurrent — never trust a client-supplied value.
    if (body.kind === "ip.addCurrent") body.ip = clientIp(request);
    const result = await runAuthAdminAction(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
