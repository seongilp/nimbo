import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { CRYPT_PROBE_PY } from "./auth";

// Regression guard for the OS-password check. verifyOsPassword used to depend on
// Python's stdlib `crypt` module, which was REMOVED in Python 3.13 (PEP 594) —
// that silently broke EVERY login on modern distros (Fedora 41+, Ubuntu 25.04+,
// Arch, Debian 13). The fix verifies through the SYSTEM libcrypt via ctypes,
// which works on every Python version. This test runs the exact probe string the
// app ships against a known hash, on the real interpreter (CI pins Python 3.13),
// so a "crypt regression" can never sneak past the mocked integration tests.
//
// A deterministic sha512-crypt ($6$, fixed salt) hash of "nimbo-ci-secret".
// Stable on any libcrypt supporting $6$.
const KNOWN_PW = "nimbo-ci-secret";
const KNOWN_HASH =
  "$6$nimbociabc$BwMg9.Rpd3SZphL/YXh8HmJvlHi4jk3lPIE2tx/ERElMr1bgDVSZJsB2ZD5SlowQEwym0vOKDs7SS9m.PYEmK1";

function hasPython3(): boolean {
  try {
    return spawnSync("python3", ["--version"]).status === 0;
  } catch {
    return false;
  }
}

function probe(password: string, hash: string): string {
  const r = spawnSync("python3", ["-c", CRYPT_PROBE_PY, hash], { input: `${password}\n`, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

// libcrypt.so.1 only exists on Linux; skip on dev macOS/Windows where the probe
// can't load it (the mocked integration tests cover the logic there).
const canRun = process.platform === "linux" && hasPython3();

describe.skipIf(!canRun)("verifyOsPassword crypt probe (system libcrypt via ctypes, no stdlib crypt)", () => {
  it("returns OK for the correct password", () => {
    expect(probe(KNOWN_PW, KNOWN_HASH)).toBe("OK");
  });

  it("returns NO for a wrong password", () => {
    expect(probe("definitely-wrong", KNOWN_HASH)).toBe("NO");
  });
});
