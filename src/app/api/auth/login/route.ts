import { NextResponse } from "next/server";

import { login } from "@/lib/system/auth";
import { clientIp } from "@/lib/api/client-ip";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Behind Caddy the proxy→app hop is plain HTTP, so new URL(request.url).protocol
// is always "http:". Honour the proxy's x-forwarded-proto so the session cookie
// still gets the Secure flag on HTTPS deployments. (Only the trusted proxy may
// set this header — see deploy/nimbo.env.example / DEPLOYMENT.md.)
function isHttps(req: Request): boolean {
  const proto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  if (proto) return proto === "https";
  return new URL(req.url).protocol === "https:";
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
      secure: isHttps(request),
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return res;
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
