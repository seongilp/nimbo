// IP allow-list helpers for the login ACL. Supports IPv4 and IPv6, exact
// addresses and CIDR ranges. Pure (no Node APIs, no BigInt) so it is safe to
// import anywhere and easy to unit-test. IPv4 is held as a 32-bit unsigned
// number; IPv6 as eight 16-bit segments.

function stripZone(ip: string): string {
  return ip.split("%")[0].trim();
}

// ::ffff:192.168.0.1 → 192.168.0.1 so a v4 client arriving over a v6 socket
// matches v4 allow-list rules.
function unmapV4(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : ip;
}

export function normalizeIp(ip: string): string {
  return unmapV4(stripZone(ip));
}

function isV4(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function v6ToSegments(ip: string): number[] | null {
  if (!/^[0-9a-fA-F:]+$/.test(ip) || (ip.match(/::/g) || []).length > 1) return null;
  const hasGap = ip.includes("::");
  let head = ip;
  let tail = "";
  if (hasGap) {
    const [h, t] = ip.split("::");
    head = h;
    tail = t;
  }
  const hp = head ? head.split(":") : [];
  const tp = tail ? tail.split(":") : [];
  const missing = 8 - (hp.length + tp.length);
  if (missing < 0 || (!hasGap && missing !== 0)) return null;
  const groups = [...hp, ...Array(hasGap ? missing : 0).fill("0"), ...tp];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

interface Parsed {
  kind: "v4" | "v6";
  v4?: number;
  v6?: number[];
  bits: number;
}

function parse(ip: string): Parsed | null {
  const n = normalizeIp(ip);
  if (isV4(n)) {
    const x = v4ToInt(n);
    return x === null ? null : { kind: "v4", v4: x, bits: 32 };
  }
  const seg = v6ToSegments(n);
  return seg === null ? null : { kind: "v6", v6: seg, bits: 128 };
}

/** True when the string is a valid bare IP or CIDR (e.g. "10.0.0.0/8", "192.168.1.5"). */
export function isValidCidrOrIp(s: string): boolean {
  const [addr, prefix] = s.trim().split("/");
  const a = parse(addr);
  if (!a) return false;
  if (prefix === undefined) return true;
  const p = Number(prefix);
  return Number.isInteger(p) && p >= 0 && p <= a.bits;
}

function v6PrefixMatch(a: number[], b: number[], prefix: number): boolean {
  let bits = prefix;
  for (let i = 0; i < 8; i++) {
    if (bits <= 0) break;
    const take = Math.min(16, bits);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if ((a[i] & mask) !== (b[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [addr, prefix] = cidr.trim().split("/");
  const target = parse(ip);
  const base = parse(addr);
  if (!target || !base || target.kind !== base.kind) return false;
  const p = prefix === undefined ? base.bits : Number(prefix);
  if (!Number.isInteger(p) || p < 0 || p > base.bits) return false;
  if (p === 0) return true;
  if (target.kind === "v4") {
    const shift = 32 - p; // 0..31
    return (target.v4! >>> shift) === (base.v4! >>> shift);
  }
  return v6PrefixMatch(target.v6!, base.v6!, p);
}

export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  return cidrs.some((c) => ipInCidr(ip, c));
}

/**
 * The /24 (v4) or /64 (v6) subnet that contains `ip`, used to pin a "trusted
 * network" on first login. Returns null for unparseable input (e.g. "unknown")
 * so callers can choose not to pin anything.
 */
export function deriveSubnet(ip: string): string | null {
  const p = parse(ip);
  if (!p) return null;
  if (p.kind === "v4") {
    const parts = normalizeIp(ip).split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  const seg = p.v6!;
  const masked = [seg[0], seg[1], seg[2], seg[3], 0, 0, 0, 0];
  return `${masked.map((s) => s.toString(16)).join(":")}/64`;
}
