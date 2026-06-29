import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Mirror login's Secure detection: behind Caddy the app hop is plain HTTP, so
// trust the proxy's x-forwarded-proto. Cleared cookie attributes must match the
// ones it was set with (path + httpOnly + secure) or the browser keeps it.
function isHttps(req: Request): boolean {
  const proto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  if (proto) return proto === "https";
  return new URL(req.url).protocol === "https:";
}

export async function POST(request: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("nimbo_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(request),
    path: "/",
    maxAge: 0,
  });
  return res;
}
