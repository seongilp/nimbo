// The trustworthy client IP is the value the SINGLE trusted reverse proxy
// (Caddy/nginx) appended — the RIGHTMOST X-Forwarded-For entry. The leftmost
// entries are client-supplied and therefore spoofable: proxies APPEND the real
// peer IP to whatever the client sent, producing "<attacker>, <realIP>".
//
// Taking [0] would let an unauthenticated caller forge their IP to bypass the
// login allow-list, evade the brute-force lockout, or get an arbitrary IP
// firewall-banned via fail2ban. The rightmost entry is the one Caddy/nginx set.
//
// Defense in depth: the installer also configures Caddy to OVERWRITE the header
// with the real remote host, so leftmost == rightmost in the default deployment.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip") || "unknown";
}
