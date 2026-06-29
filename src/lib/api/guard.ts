import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { verifyToken } from "@/lib/system/auth";
import type { NimboRole } from "@/lib/types";

export interface Session {
  user: string;
  role: NimboRole;
}

/** Decode + verify the session cookie. Returns null when absent/invalid. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("nimbo_session")?.value;
  const claims = verifyToken(token);
  return claims ? { user: claims.u, role: claims.r } : null;
}

function deny(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Authorization gate for route handlers. Returns the {@link Session} on success,
 * or a ready-to-return {@link NextResponse} error on failure. The middleware
 * already enforces that *a* session exists; this adds the role check the
 * middleware cannot do, and must be called by every mutating handler.
 *
 *   const gate = await requireRole("admin");
 *   if (gate instanceof NextResponse) return gate;
 *   // gate is a Session here
 */
export async function requireRole(min: NimboRole): Promise<Session | NextResponse> {
  const session = await getSession();
  if (!session) return deny(401, "인증이 필요합니다.");
  if (min === "admin" && session.role !== "admin") {
    return deny(403, "관리자 권한이 필요합니다.");
  }
  return session;
}

/** Convenience wrapper: require an authenticated admin. */
export function requireAdmin(): Promise<Session | NextResponse> {
  return requireRole("admin");
}

/** Convenience wrapper: require any authenticated user (admin or user). */
export function requireUser(): Promise<Session | NextResponse> {
  return requireRole("user");
}
