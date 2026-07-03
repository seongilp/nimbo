import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { verifyToken } from "@/lib/system/auth";
import { USE_MOCK } from "@/lib/system/exec";
import { getFileContext, listDirectory } from "@/lib/system/files";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Resolve the File Station context (home + roots) for the logged-in session.
// The middleware guarantees a valid session on the real host; the demo (mock)
// has none, so we fall back to an admin-like demo context for the showcase.
async function sessionContext() {
  const token = (await cookies()).get("nimbo_session")?.value;
  const s = verifyToken(token);
  const user = s?.u || (USE_MOCK ? "demo" : "nobody");
  const isAdmin = s ? s.r === "admin" : USE_MOCK;
  return getFileContext(user, isAdmin);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const ctx = await sessionContext();
    if (searchParams.get("view") === "context") {
      return NextResponse.json({ ok: true, data: ctx });
    }
    // Empty path → the user's home (handled inside listDirectory).
    const data = await listDirectory(searchParams.get("path") || "", ctx);
    return NextResponse.json({ ok: true, data, isMock: data.isMock });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
