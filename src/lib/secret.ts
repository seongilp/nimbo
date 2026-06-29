// Session-signing secret — the single source of truth shared by the Edge
// middleware and the Node auth module so the two can never drift.
//
// IMPORTANT: this file must stay Edge-safe — NO `node:` imports — because
// src/middleware.ts runs on the Edge runtime. Reference only `process.env`
// and Web-standard APIs.

/**
 * The well-known development fallback. Using this in production yields
 * forgeable sessions, so the app refuses to trust it there (see auth.ts and
 * middleware.ts, which both fail closed when this value is in effect).
 */
export const DEV_SECRET = "nimbo-dev-insecure-secret-change-me";

/** Whether the process is running in a production build. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * True when no real secret is configured (unset or equal to the dev fallback).
 * In production this is a fatal misconfiguration.
 */
export function isInsecureSecret(): boolean {
  const s = process.env.NIMBO_SECRET;
  return !s || s === DEV_SECRET;
}

/**
 * The configured secret, or the dev fallback when none is set. Callers that
 * sign/verify tokens must additionally honour {@link isInsecureSecret} so they
 * fail closed in production rather than silently trusting the known key.
 */
export function getSecret(): string {
  return process.env.NIMBO_SECRET || DEV_SECRET;
}
