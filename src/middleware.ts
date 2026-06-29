import { NextResponse, type NextRequest } from "next/server";

import { getSecret, isInsecureSecret, isProduction } from "@/lib/secret";

// Paths reachable without authentication.
const PUBLIC_PREFIXES = [
  "/login",
  "/landing",
  "/api/auth/login",
  "/api/auth/logout",
  "/icon.svg",
  "/logo.svg",
  "/screenshots",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  // Exact match or a real path-segment boundary — never a bare prefix, so
  // "/login" does not whitelist "/loginbackdoor".
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Constant-time string comparison (the Edge runtime has no crypto.timingSafeEqual).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(token: string | undefined): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(getSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    if (!timingSafeEqual(b64url(mac), sig)) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" && json.exp > Date.now();
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Fail closed: in production without a real secret, every session is forgeable,
  // so treat all requests as unauthenticated until NIMBO_SECRET is configured.
  const ok =
    isProduction() && isInsecureSecret()
      ? false
      : await verify(req.cookies.get("nimbo_session")?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "인증이 필요합니다." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
