import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

// A real secret so tokens are signable/verifiable. NODE_ENV=test (vitest) is not
// "production", so verifyToken doesn't fail-closed on the secret value.
const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
process.env.NIMBO_SECRET = SECRET;

import { signToken, verifyToken } from "./auth";

// Mirror of auth.ts's token encoding, to forge specific test tokens.
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function forge(payload: object, secret = SECRET): string {
  const p = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(p).digest());
  return `${p}.${sig}`;
}

describe("session tokens — sign/verify", () => {
  it("round-trips a valid admin token", () => {
    const v = verifyToken(signToken("alice", "admin"));
    expect(v).not.toBeNull();
    expect(v!.u).toBe("alice");
    expect(v!.r).toBe("admin");
  });

  it("carries the user role", () => {
    expect(verifyToken(signToken("bob", "user"))!.r).toBe("user");
  });

  it("normalizes an unknown role to 'user'", () => {
    // A forged-but-correctly-signed token with a bogus role must not become admin.
    const v = verifyToken(forge({ u: "eve", r: "superuser", exp: Date.now() + 60_000 }));
    expect(v!.r).toBe("user");
  });

  it("rejects a tampered signature", () => {
    const [p] = signToken("alice", "admin").split(".");
    expect(verifyToken(`${p}.deadbeefdeadbeef`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    expect(verifyToken(forge({ u: "alice", r: "admin", exp: Date.now() + 60_000 }, "wrong-secret"))).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifyToken(forge({ u: "alice", r: "admin", exp: Date.now() - 1000 }))).toBeNull();
  });

  it("rejects garbage / missing tokens", () => {
    expect(verifyToken(undefined)).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("no-dot-here")).toBeNull();
  });

  it("does NOT throw on a multibyte-sig cookie and returns null (DoS regression)", () => {
    // A sig with the same UTF-16 char length as the real one but multibyte bytes
    // used to make timingSafeEqual throw a RangeError (crash-looped the sidecar).
    const forged = `a.${"A".repeat(42)}é`;
    expect(() => verifyToken(forged)).not.toThrow();
    expect(verifyToken(forged)).toBeNull();
  });
});
