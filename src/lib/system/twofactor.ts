import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import type { TwoFactorState } from "@/lib/types";
import { USE_MOCK } from "./exec";

// Persistent admin-login 2FA (TOTP). Lives in ONE module shared by the Security
// app (setup/verify/disable) AND the login path (enforcement) so the second
// factor is actually checked — and it is written to disk so it survives service
// restarts. Previously the 2FA secret lived only in security.ts's in-memory
// state: it was lost on every restart and the login flow never consulted it, so
// enabling 2FA protected nothing.
const TFA_FILE = process.env.NIMBO_2FA_FILE ?? "/etc/nimbo/2fa.json";

function empty(): TwoFactorState {
  return { enabled: false, secret: "", otpauthUrl: "", verified: false };
}

// --------------------------------------------------------------------------
// Base32 (RFC 4648) + TOTP (RFC 6238) — implemented inline, no deps
// --------------------------------------------------------------------------
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** Verify a 6-digit TOTP code against `secret`, allowing ±1 step for clock skew. */
export function verifyTotp(secret: string, code: string): boolean {
  if (!secret || !/^[0-9]{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if (totpAt(secret, counter + w) === code) return true;
  }
  return false;
}

function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// --------------------------------------------------------------------------
// Persistence — real mode reads the file on every call (no stale cache across
// route handlers / restarts); mock keeps it in memory (dev, ephemeral).
// --------------------------------------------------------------------------
let mockState: TwoFactorState | null = null;

async function load(): Promise<TwoFactorState> {
  if (USE_MOCK) return mockState ?? empty();
  try {
    const parsed = JSON.parse(await readFile(TFA_FILE, "utf8"));
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

async function persist(next: TwoFactorState): Promise<void> {
  if (USE_MOCK) {
    mockState = next;
    return;
  }
  try {
    await mkdir(nodePath.dirname(TFA_FILE), { recursive: true });
    await writeFile(TFA_FILE, JSON.stringify(next), { mode: 0o600 });
  } catch {
    // best-effort; a failed write leaves 2FA in its prior on-disk state
  }
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * UI-facing view. The raw secret + provisioning URL are exposed ONLY while
 * setting up (not yet enabled) so the app can render the QR / manual key; once
 * enabled they are withheld from the client.
 */
export async function getTwoFactorView(): Promise<TwoFactorState> {
  const s = await load();
  if (s.enabled) return { enabled: true, verified: s.verified, secret: "", otpauthUrl: "" };
  return { enabled: false, verified: s.verified, secret: s.secret, otpauthUrl: s.otpauthUrl };
}

export async function isTwoFactorEnabled(): Promise<boolean> {
  return (await load()).enabled;
}

/** Begin setup: generate a fresh secret (not yet enabled until a code verifies). */
export async function setupTwoFactor(): Promise<void> {
  const secret = generateSecret();
  const otpauthUrl = `otpauth://totp/Nimbo:admin?secret=${secret}&issuer=Nimbo`;
  await persist({ enabled: false, secret, otpauthUrl, verified: false });
}

/** Confirm setup by verifying a code against the pending secret → enables 2FA. */
export async function verifyAndEnableTwoFactor(code: string): Promise<boolean> {
  const s = await load();
  if (!s.secret) return false;
  const valid = (USE_MOCK && code === "123456") || verifyTotp(s.secret, code);
  if (valid) await persist({ ...s, enabled: true, verified: true });
  return valid;
}

export async function disableTwoFactor(): Promise<void> {
  await persist(empty());
}

/** Login gate: passes when 2FA is off (nothing to check) OR the code verifies. */
export async function verifyLoginTwoFactor(code: string): Promise<boolean> {
  const s = await load();
  if (!s.enabled || !s.secret) return true;
  return (USE_MOCK && code === "123456") || verifyTotp(s.secret, code);
}
