import { NextResponse } from "next/server";

import { login } from "@/lib/system/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  try {
    const { username, password } = (await request.json()) as { username?: string; password?: string };
    if (!username || !password) {
      return NextResponse.json({ ok: false, error: "사용자 이름과 비밀번호를 입력하세요." }, { status: 400 });
    }
    const result = await login(username.trim(), password, clientIp(request));
    if (!result.ok || !result.token) {
      return NextResponse.json(
        { ok: false, error: result.error, lockedFor: result.lockedFor },
        { status: result.lockedFor ? 429 : 401 }
      );
    }
    const res = NextResponse.json({ ok: true, user: result.user });
    res.cookies.set("nimbo_session", result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return res;
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
