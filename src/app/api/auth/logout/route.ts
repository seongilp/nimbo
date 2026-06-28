import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("nimbo_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
