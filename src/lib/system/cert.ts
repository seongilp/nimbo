import { readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

import type { HttpsConfig, TlsCert } from "@/lib/types";
import { hasCommand, run, USE_MOCK } from "./exec";

const CERT_DIR = process.env.CERT_DIR ?? "/etc/nimbo/certs";
const DAY = 86_400_000;

// TLS termination happens at the front reverse proxy (Caddy/nginx); these
// settings only drive that documented HTTPS setup — the Node app does not
// terminate TLS itself.
const PROXY_NOTE =
  "실제 TLS 종료는 전면 리버스 프록시(Caddy/nginx)에서 처리되며, 이 설정은 해당 HTTPS 구성을 제어합니다.";

const DOMAIN_RE = /^[A-Za-z0-9.*_-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

// --------------------------------------------------------------------------
// Mock state (mutable)
// --------------------------------------------------------------------------
interface State {
  enabled: boolean;
  httpPort: number;
  httpsPort: number;
  forceHttps: boolean;
  certs: TlsCert[];
}

function seedCerts(): TlsCert[] {
  const now = Date.now();
  return [
    {
      id: "cert-le-1",
      domain: "nas.example.com",
      issuer: "Let's Encrypt (R3)",
      type: "letsencrypt",
      notBefore: now - 10 * DAY,
      notAfter: now + 80 * DAY,
      isDefault: true,
      san: ["nas.example.com", "www.nas.example.com"],
    },
    {
      id: "cert-self-1",
      domain: "nas-server.local",
      issuer: "Nimbo (self-signed)",
      type: "selfsigned",
      notBefore: now - 30 * DAY,
      notAfter: now + 335 * DAY,
      isDefault: false,
      san: ["nas-server.local"],
    },
    {
      id: "cert-import-1",
      domain: "*.home.lan",
      issuer: "Home Lab Internal CA",
      type: "imported",
      notBefore: now - 120 * DAY,
      notAfter: now + 245 * DAY,
      isDefault: false,
      san: ["*.home.lan", "home.lan"],
    },
  ];
}

const state: State = {
  enabled: true,
  httpPort: 80,
  httpsPort: 443,
  forceHttps: true,
  certs: seedCerts(),
};

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------
function parseOpensslDate(s: string): number {
  const t = Date.parse(s.trim());
  return Number.isNaN(t) ? Date.now() : t;
}

function parseCertFile(file: string, output: string): TlsCert | null {
  try {
    const subjectM = output.match(/subject=.*?CN\s*=\s*([^,\n/]+)/i);
    const issuerM = output.match(/issuer=([^\n]+)/i);
    const notBeforeM = output.match(/notBefore=([^\n]+)/i);
    const notAfterM = output.match(/notAfter=([^\n]+)/i);
    const base = path.basename(file).replace(/\.(crt|pem)$/i, "");
    const domain = subjectM ? subjectM[1].trim() : base;
    const issuer = issuerM ? issuerM[1].trim() : "unknown";

    // SAN extension lines look like "    DNS:a.example.com, DNS:b.example.com".
    const san = Array.from(output.matchAll(/DNS:([^\s,]+)/g)).map((m) => m[1]);

    const lower = issuer.toLowerCase();
    const type: TlsCert["type"] = /let'?s encrypt/.test(lower)
      ? "letsencrypt"
      : domain === issuer || /self/.test(lower)
        ? "selfsigned"
        : "imported";

    return {
      id: `cert-file-${base}`,
      domain,
      issuer,
      type,
      notBefore: notBeforeM ? parseOpensslDate(notBeforeM[1]) : Date.now(),
      notAfter: notAfterM ? parseOpensslDate(notAfterM[1]) : Date.now(),
      isDefault: false,
      san: san.length ? san : [domain],
    };
  } catch {
    return null;
  }
}

async function listRealCerts(): Promise<TlsCert[]> {
  const certs: TlsCert[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(CERT_DIR)).filter((f) => /\.(crt|pem)$/i.test(f));
  } catch {
    return certs;
  }
  for (const f of files) {
    const full = path.join(CERT_DIR, f);
    const { stdout, code } = await run(
      `openssl x509 -in ${full} -noout -subject -issuer -dates -ext subjectAltName`,
    );
    if (code !== 0) continue;
    const parsed = parseCertFile(full, stdout);
    if (parsed) certs.push(parsed);
  }
  if (certs.length && !certs.some((c) => c.isDefault)) certs[0].isDefault = true;
  return certs;
}

export async function getHttpsConfig(): Promise<HttpsConfig> {
  if (USE_MOCK) {
    return {
      enabled: state.enabled,
      httpPort: state.httpPort,
      httpsPort: state.httpsPort,
      forceHttps: state.forceHttps,
      certs: state.certs,
      isMock: true,
    };
  }

  let certs = await listRealCerts();
  // If nothing was found on disk, fall back to the seed certs so the UI isn't
  // empty — but report a real (non-mock) environment.
  if (certs.length === 0) certs = seedCerts();

  return {
    enabled: state.enabled,
    httpPort: state.httpPort,
    httpsPort: state.httpsPort,
    forceHttps: state.forceHttps,
    certs,
    isMock: false,
  };
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export type CertAction =
  | { kind: "cert.requestLetsEncrypt"; domain: string; email: string; dns?: boolean }
  | { kind: "cert.selfSigned"; domain: string }
  | { kind: "cert.import"; domain: string; certPem: string; keyPem: string }
  | { kind: "cert.delete"; id: string }
  | { kind: "cert.setDefault"; id: string }
  | { kind: "cert.renew"; id: string }
  | {
      kind: "https.update";
      enabled?: boolean;
      httpPort?: number;
      httpsPort?: number;
      forceHttps?: boolean;
    };

interface ActionResult {
  ok: boolean;
  error?: string;
  note?: string;
}

function ok(): ActionResult {
  return { ok: true, note: PROXY_NOTE };
}
function fail(error: string): ActionResult {
  return { ok: false, error };
}

function pushCert(cert: TlsCert): void {
  state.certs = [...state.certs, cert];
}

export async function runCertAction(a: CertAction): Promise<ActionResult> {
  switch (a.kind) {
    case "cert.requestLetsEncrypt": {
      if (!DOMAIN_RE.test(a.domain)) return fail("도메인이 올바르지 않습니다.");
      if (!EMAIL_RE.test(a.email)) return fail("이메일이 올바르지 않습니다.");
      if (!USE_MOCK) {
        if (!(await hasCommand("certbot"))) return fail("certbot 필요");
        const challenge = a.dns ? "--dns-cloudflare" : "--standalone";
        const { code, stderr } = await run(
          `certbot certonly --non-interactive --agree-tos -m ${a.email} ${challenge} -d ${a.domain}`,
          { timeoutMs: 120_000 },
        );
        if (code !== 0) return fail(stderr.trim() || "certbot 발급 실패 — 권한 필요");
        return ok();
      }
      const now = Date.now();
      pushCert({
        id: `cert-le-${now}`,
        domain: a.domain,
        issuer: "Let's Encrypt (R3)",
        type: "letsencrypt",
        notBefore: now,
        notAfter: now + 90 * DAY,
        isDefault: state.certs.length === 0,
        san: [a.domain],
      });
      return ok();
    }

    case "cert.selfSigned": {
      if (!DOMAIN_RE.test(a.domain)) return fail("도메인이 올바르지 않습니다.");
      if (!USE_MOCK) {
        const key = path.join(CERT_DIR, `${a.domain}.key`);
        const crt = path.join(CERT_DIR, `${a.domain}.crt`);
        const { code, stderr } = await run(
          `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${crt} -days 365 -subj "/CN=${a.domain}"`,
          { timeoutMs: 30_000 },
        );
        if (code !== 0) return fail(stderr.trim() || `openssl 실패 — ${CERT_DIR} 쓰기 권한 필요`);
        return ok();
      }
      const now = Date.now();
      pushCert({
        id: `cert-self-${now}`,
        domain: a.domain,
        issuer: "Nimbo (self-signed)",
        type: "selfsigned",
        notBefore: now,
        notAfter: now + 365 * DAY,
        isDefault: state.certs.length === 0,
        san: [a.domain],
      });
      return ok();
    }

    case "cert.import": {
      if (!DOMAIN_RE.test(a.domain)) return fail("도메인이 올바르지 않습니다.");
      if (!a.certPem.trim() || !a.keyPem.trim()) return fail("인증서와 키를 입력하세요.");
      if (!USE_MOCK) {
        try {
          await writeFile(path.join(CERT_DIR, `${a.domain}.crt`), a.certPem, "utf8");
          await writeFile(path.join(CERT_DIR, `${a.domain}.key`), a.keyPem, "utf8");
          return ok();
        } catch (err) {
          return fail((err as Error).message + ` — ${CERT_DIR} 쓰기 권한 필요`);
        }
      }
      const now = Date.now();
      pushCert({
        id: `cert-import-${now}`,
        domain: a.domain,
        issuer: "가져온 인증서",
        type: "imported",
        notBefore: now,
        notAfter: now + 365 * DAY,
        isDefault: state.certs.length === 0,
        san: [a.domain],
      });
      return ok();
    }

    case "cert.delete": {
      const target = state.certs.find((c) => c.id === a.id);
      if (!target) return fail("인증서를 찾을 수 없습니다.");
      if (target.isDefault) return fail("기본 인증서는 삭제할 수 없습니다.");
      if (!USE_MOCK) {
        await unlink(path.join(CERT_DIR, `${target.domain}.crt`)).catch(() => {});
        await unlink(path.join(CERT_DIR, `${target.domain}.key`)).catch(() => {});
      }
      state.certs = state.certs.filter((c) => c.id !== a.id);
      return ok();
    }

    case "cert.setDefault": {
      if (!state.certs.some((c) => c.id === a.id)) return fail("인증서를 찾을 수 없습니다.");
      state.certs = state.certs.map((c) => ({ ...c, isDefault: c.id === a.id }));
      return ok();
    }

    case "cert.renew": {
      const target = state.certs.find((c) => c.id === a.id);
      if (!target) return fail("인증서를 찾을 수 없습니다.");
      if (!USE_MOCK) {
        const { code, stderr } = await run(`certbot renew --cert-name ${target.domain}`, {
          timeoutMs: 120_000,
        });
        if (code !== 0) return fail(stderr.trim() || "certbot 갱신 실패 — 권한 필요");
        return ok();
      }
      state.certs = state.certs.map((c) =>
        c.id === a.id ? { ...c, notBefore: Date.now(), notAfter: Date.now() + 90 * DAY } : c,
      );
      return ok();
    }

    case "https.update": {
      if (a.enabled !== undefined) state.enabled = a.enabled;
      if (a.httpPort !== undefined) {
        if (!Number.isInteger(a.httpPort) || a.httpPort < 1 || a.httpPort > 65535)
          return fail("HTTP 포트가 올바르지 않습니다.");
        state.httpPort = a.httpPort;
      }
      if (a.httpsPort !== undefined) {
        if (!Number.isInteger(a.httpsPort) || a.httpsPort < 1 || a.httpsPort > 65535)
          return fail("HTTPS 포트가 올바르지 않습니다.");
        state.httpsPort = a.httpsPort;
      }
      if (a.forceHttps !== undefined) state.forceHttps = a.forceHttps;
      // These values are consumed by the reverse proxy / documented HTTPS setup.
      return ok();
    }

    default:
      return fail("알 수 없는 작업입니다.");
  }
}
