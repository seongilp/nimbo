import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";

function req(headers: Record<string, string>): Request {
  return new Request("http://nimbo.local/api/x", { headers });
}

describe("clientIp — trusts the rightmost (proxy-appended) X-Forwarded-For", () => {
  it("returns the rightmost entry, NOT the spoofable leftmost", () => {
    // Attacker sends "X-Forwarded-For: 1.2.3.4"; the trusted proxy appends the
    // real peer → "1.2.3.4, 9.9.9.9". The real client is the rightmost.
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("handles a single XFF value", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("ignores a spoofed leftmost across multiple hops", () => {
    expect(clientIp(req({ "x-forwarded-for": "evil.spoof, 172.16.0.1, 10.0.0.1" }))).toBe("10.0.0.1");
  });

  it("trims whitespace and skips trailing empties", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1 ,  2.2.2.2 , " }))).toBe("2.2.2.2");
  });

  it("falls back to x-real-ip when there is no XFF", () => {
    expect(clientIp(req({ "x-real-ip": "192.168.1.9" }))).toBe("192.168.1.9");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    expect(clientIp(req({}))).toBe("unknown");
  });
});
