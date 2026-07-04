import { describe, expect, it } from "vitest";

import { deriveSubnet, ipInCidr, ipInCidrs, isValidCidrOrIp, normalizeIp } from "./ipacl";

describe("ipacl — login IP allow-list matching", () => {
  it("derives the /24 subnet for an IPv4 first-login pin", () => {
    expect(deriveSubnet("192.168.123.45")).toBe("192.168.123.0/24");
  });

  it("matches an address inside a /24 and rejects one outside", () => {
    expect(ipInCidr("192.168.123.99", "192.168.123.0/24")).toBe(true);
    expect(ipInCidr("192.168.124.1", "192.168.123.0/24")).toBe(false);
  });

  it("matches a bare IP exactly", () => {
    expect(ipInCidr("10.0.0.5", "10.0.0.5")).toBe(true);
    expect(ipInCidr("10.0.0.6", "10.0.0.5")).toBe(false);
  });

  it("normalizes IPv4-mapped IPv6 so a v4 client over a v6 socket still matches", () => {
    expect(normalizeIp("::ffff:192.168.1.5")).toBe("192.168.1.5");
    expect(ipInCidr("::ffff:192.168.123.7", "192.168.123.0/24")).toBe(true);
  });

  it("respects /16 and /8 boundaries", () => {
    expect(ipInCidr("10.5.9.9", "10.5.0.0/16")).toBe(true);
    expect(ipInCidr("10.6.0.1", "10.5.0.0/16")).toBe(false);
    expect(ipInCidr("10.255.255.255", "10.0.0.0/8")).toBe(true);
  });

  it("ipInCidrs matches when ANY root contains the address", () => {
    expect(ipInCidrs("172.16.0.4", ["192.168.1.0/24", "172.16.0.0/24"])).toBe(true);
    expect(ipInCidrs("8.8.8.8", ["192.168.1.0/24", "172.16.0.0/24"])).toBe(false);
    expect(ipInCidrs("10.0.0.1", [])).toBe(false); // empty list = no match
  });

  it("handles IPv6 /64 derivation and matching", () => {
    expect(deriveSubnet("fd7a:115c:a1e0:1234:5678::1")).toBe("fd7a:115c:a1e0:1234:0:0:0:0/64");
    expect(ipInCidr("fd7a:115c:a1e0:1234:ffff::9", "fd7a:115c:a1e0:1234:0:0:0:0/64")).toBe(true);
    expect(ipInCidr("fd7a:115c:a1e0:9999::1", "fd7a:115c:a1e0:1234:0:0:0:0/64")).toBe(false);
  });

  it("never matches across address families", () => {
    expect(ipInCidr("10.0.0.1", "fd00::/8")).toBe(false);
    expect(ipInCidr("fd00::1", "10.0.0.0/8")).toBe(false);
  });

  it("validates CIDR/IP input (rejects bad octets and prefixes)", () => {
    expect(isValidCidrOrIp("192.168.0.0/24")).toBe(true);
    expect(isValidCidrOrIp("10.0.0.5")).toBe(true);
    expect(isValidCidrOrIp("300.1.1.1")).toBe(false);
    expect(isValidCidrOrIp("10.0.0.0/33")).toBe(false);
    expect(isValidCidrOrIp("nonsense")).toBe(false);
  });

  it("returns null subnet for unparseable input (e.g. 'unknown') so nothing is pinned", () => {
    expect(deriveSubnet("unknown")).toBeNull();
    expect(deriveSubnet("")).toBeNull();
  });
});
