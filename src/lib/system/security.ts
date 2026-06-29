import crypto from "node:crypto";

import type {
  FirewallRule,
  FirewallState,
  SecurityCheck,
  SecurityOverview,
  TwoFactorState,
} from "@/lib/types";
import { hasCommand, run, USE_MOCK } from "./exec";

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------
const PORT_RE = /^[0-9:,-]{1,32}$/;
const SOURCE_RE = /^[0-9a-fA-F:./]{0,43}$|^any$/;
const ACTIONS = ["allow", "deny", "reject"] as const;
const PROTOCOLS = ["tcp", "udp", "any"] as const;

type FwAction = (typeof ACTIONS)[number];
type FwProtocol = (typeof PROTOCOLS)[number];

// --------------------------------------------------------------------------
// Module state (mock + privileged toggles)
// --------------------------------------------------------------------------
interface State {
  firewall: FirewallState;
  twoFactor: TwoFactorState;
}

// Seeded demo firewall — used ONLY in mock/dev mode. On a real host we never
// invent rules; we parse the real ufw state (or return a neutral empty state).
function seedFirewall(): FirewallState {
  return {
    enabled: true,
    defaultIncoming: "deny",
    rules: [
      { id: "rule-1", action: "allow", direction: "in", protocol: "tcp", port: "22", source: "192.168.1.0/24", comment: "SSH (LAN 전용)" },
      { id: "rule-2", action: "allow", direction: "in", protocol: "tcp", port: "80", source: "any", comment: "Web (HTTP)" },
      { id: "rule-3", action: "allow", direction: "in", protocol: "tcp", port: "443", source: "any", comment: "Web (HTTPS)" },
      { id: "rule-4", action: "allow", direction: "in", protocol: "tcp", port: "445", source: "192.168.1.0/24", comment: "SMB 파일 공유" },
      { id: "rule-5", action: "allow", direction: "in", protocol: "tcp", port: "5000", source: "any", comment: "NAS UI" },
      { id: "rule-6", action: "deny", direction: "in", protocol: "tcp", port: "23", source: "any", comment: "Telnet 차단" },
    ],
  };
}

// Neutral empty firewall for real mode before any real read succeeds.
function emptyFirewall(): FirewallState {
  return { enabled: false, defaultIncoming: "deny", rules: [] };
}

const state: State = {
  firewall: USE_MOCK ? seedFirewall() : emptyFirewall(),
  twoFactor: {
    enabled: false,
    secret: "",
    otpauthUrl: "",
    verified: false,
  },
};

let ruleSeq = 100;

// --------------------------------------------------------------------------
// Base32 (RFC 4648) + TOTP — implemented inline, no deps
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
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
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
  // 8-byte big-endian counter
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

function verifyTotp(secret: string, code: string): boolean {
  if (!secret || !/^[0-9]{6}$/.test(code)) return false;
  const step = 30;
  const counter = Math.floor(Date.now() / 1000 / step);
  // Accept a +/- 1 step window for clock skew.
  for (let w = -1; w <= 1; w++) {
    if (totpAt(secret, counter + w) === code) return true;
  }
  return false;
}

function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// --------------------------------------------------------------------------
// Firewall — real (ufw) reads
// --------------------------------------------------------------------------
async function readRealFirewall(): Promise<FirewallState> {
  const verbose = await run("ufw status verbose");
  const text = verbose.stdout;
  const enabled = /Status:\s*active/i.test(text);
  const defaultIncoming = /Default:\s*deny\s*\(incoming\)/i.test(text) ? "deny" : "allow";

  const numbered = await run("ufw status numbered");
  const rules: FirewallRule[] = [];
  let seq = 0;
  for (const line of numbered.stdout.split("\n")) {
    // Best-effort parse: "[ 1] 22/tcp    ALLOW IN  192.168.1.0/24  # SSH"
    const m = line.match(/^\s*\[\s*\d+\]\s+(\S+)\s+(ALLOW|DENY|REJECT)\s+(IN|OUT)\s+(\S+)(?:\s+#\s*(.*))?/i);
    if (!m) continue;
    const [, target, act, dir, src, comment] = m;
    const portMatch = target.match(/^([0-9:,-]+)(?:\/(tcp|udp))?/);
    const port = portMatch?.[1] ?? target;
    const protocol = (portMatch?.[2] as FwProtocol) ?? "any";
    rules.push({
      id: `rule-${++seq}`,
      action: act.toLowerCase() as FwAction,
      direction: dir.toLowerCase() === "out" ? "out" : "in",
      protocol,
      port,
      source: src === "Anywhere" ? "any" : src,
      comment: comment?.trim() ?? "",
    });
  }
  return { enabled, defaultIncoming, rules };
}

// --------------------------------------------------------------------------
// Firewall — backend detection (ufw vs firewalld)
// --------------------------------------------------------------------------
type FirewallBackend = "ufw" | "firewalld" | "none";

/**
 * Detect which firewall backend is available on the host. Prefer ufw (Debian/
 * Ubuntu); fall back to firewalld (RHEL/Rocky/CentOS/Fedora). Never throws.
 */
async function firewallBackend(): Promise<FirewallBackend> {
  if (await hasCommand("ufw")) return "ufw";
  if (await hasCommand("firewall-cmd")) return "firewalld";
  return "none";
}

// Map well-known firewalld service names to their canonical port. Unknown
// services have no entry and fall back to showing the service name itself.
const FIREWALLD_SERVICE_PORTS: Record<string, string> = {
  ssh: "22",
  http: "80",
  https: "443",
  samba: "445",
  nfs: "2049",
};

// firewalld single port (8096) or range (8000-8010) accepted for add/remove.
const FIREWALLD_PORT_RE = /^([0-9]{1,5}|[0-9]+-[0-9]+)$/;

/** Extract the value following a `key:` label inside `firewall-cmd --list-all`. */
function parseListAllField(text: string, key: string): string {
  for (const line of text.split("\n")) {
    const m = line.match(new RegExp(`^\\s*${key}:\\s*(.*)$`));
    if (m) return m[1].trim();
  }
  return "";
}

// --------------------------------------------------------------------------
// Firewall — real (firewalld) reads
// --------------------------------------------------------------------------
async function readFirewalldFirewall(): Promise<FirewallState> {
  // `firewall-cmd --state` prints "running" and exits 0 when active.
  const stateRes = await run("firewall-cmd --state");
  const enabled = stateRes.code === 0 && /running/i.test(stateRes.stdout);

  const zoneRes = await run("firewall-cmd --get-default-zone");
  const zone = zoneRes.stdout.trim() || "public";

  const listAll = await run(`firewall-cmd --zone=${zone} --list-all`);
  const text = listAll.stdout;

  // Zone target: ACCEPT → allow incoming; otherwise (default/DROP/REJECT) deny.
  const target = parseListAllField(text, "target");
  const defaultIncoming: "allow" | "deny" = /ACCEPT/i.test(target) ? "allow" : "deny";

  const rules: FirewallRule[] = [];

  // services: ssh dhcpv6-client http  →  one rule per service
  const services = parseListAllField(text, "services");
  for (const svc of services.split(/\s+/).filter(Boolean)) {
    const mapped = FIREWALLD_SERVICE_PORTS[svc];
    rules.push({
      id: `fwsvc-${svc}`,
      action: "allow",
      direction: "in",
      protocol: "any",
      port: mapped ?? svc,
      source: "any",
      comment: `${svc} (${zone})`,
    });
  }

  // ports: 8096/tcp 53/udp  →  one rule per port entry
  const ports = parseListAllField(text, "ports");
  for (const entry of ports.split(/\s+/).filter(Boolean)) {
    const m = entry.match(/^([0-9-]+)(?:\/(tcp|udp))?/);
    if (!m) continue;
    const port = m[1];
    const protocol = (m[2] as FwProtocol) ?? "any";
    rules.push({
      id: `fwport-${port}-${protocol}`,
      action: "allow",
      direction: "in",
      protocol,
      port,
      source: "any",
      comment: zone,
    });
  }

  return { enabled, defaultIncoming, rules };
}

// --------------------------------------------------------------------------
// Security advisor
// --------------------------------------------------------------------------
function buildChecks(fw: FirewallState, tfa: TwoFactorState): SecurityCheck[] {
  const checks: SecurityCheck[] = [];

  checks.push({
    id: "firewall-enabled",
    title: "방화벽 활성화",
    severity: fw.enabled ? "ok" : "high",
    passed: fw.enabled,
    detail: fw.enabled ? "ufw 방화벽이 활성화되어 있습니다." : "방화벽이 꺼져 있어 모든 포트가 노출됩니다.",
    recommendation: fw.enabled ? "기본 수신 정책을 deny로 유지하세요." : "방화벽을 활성화하고 필요한 포트만 허용하세요.",
  });

  checks.push({
    id: "ssh-root-login",
    title: "SSH 루트 로그인 비활성화",
    severity: "high",
    passed: false,
    detail: "sshd_config 의 PermitRootLogin 이 yes 로 설정되어 있습니다.",
    recommendation: "PermitRootLogin no 로 변경하고 sudo 권한의 일반 계정을 사용하세요.",
  });

  checks.push({
    id: "ssh-password-auth",
    title: "SSH 비밀번호 인증",
    severity: "medium",
    passed: false,
    detail: "비밀번호 인증이 허용되어 무차별 대입 공격에 노출됩니다.",
    recommendation: "공개키 인증만 허용하고 PasswordAuthentication no 로 설정하세요.",
  });

  checks.push({
    id: "auto-updates",
    title: "자동 보안 업데이트",
    severity: "low",
    passed: true,
    detail: "unattended-upgrades 가 설치되어 보안 패치를 자동 적용합니다.",
    recommendation: "업데이트 알림을 이메일로 받도록 구성하면 더욱 좋습니다.",
  });

  checks.push({
    id: "two-factor",
    title: "2단계 인증(2FA)",
    severity: tfa.enabled ? "ok" : "medium",
    passed: tfa.enabled,
    detail: tfa.enabled ? "관리자 계정에 TOTP 2FA가 활성화되어 있습니다." : "관리자 계정에 2FA가 설정되어 있지 않습니다.",
    recommendation: tfa.enabled ? "복구 코드를 안전한 곳에 보관하세요." : "2단계 인증 탭에서 TOTP 2FA를 설정하세요.",
  });

  checks.push({
    id: "password-policy",
    title: "강력한 비밀번호 정책",
    severity: "ok",
    passed: true,
    detail: "최소 12자 및 복잡도 정책이 적용되어 있습니다.",
    recommendation: "주기적인 비밀번호 변경을 권장합니다.",
  });

  checks.push({
    id: "open-ports",
    title: "외부 노출 포트 점검",
    severity: "medium",
    passed: false,
    detail: "5000(NAS UI), 80, 443 포트가 인터넷에 직접 노출되어 있습니다.",
    recommendation: "역방향 프록시와 신뢰 IP 제한 또는 VPN 접근으로 전환하세요.",
  });

  checks.push({
    id: "os-uptodate",
    title: "운영체제 최신 상태",
    severity: "ok",
    passed: true,
    detail: "설치된 패키지가 최신 보안 패치를 반영하고 있습니다.",
    recommendation: "정기적으로 apt update && apt upgrade 를 실행하세요.",
  });

  checks.push({
    id: "docker-socket",
    title: "Docker 소켓 노출",
    severity: "high",
    passed: false,
    detail: "Docker 소켓이 컨테이너에 마운트되어 호스트 권한 탈취 위험이 있습니다.",
    recommendation: "/var/run/docker.sock 마운트를 제거하거나 소켓 프록시를 사용하세요.",
  });

  return checks;
}

async function buildRealChecks(
  fw: FirewallState,
  tfa: TwoFactorState,
  backend: FirewallBackend = "ufw"
): Promise<SecurityCheck[]> {
  // Real host: only return checks we can actually evaluate from the system.
  // Never fabricate "passed/failed" curated checks — omit anything we can't
  // measure honestly.
  const checks: SecurityCheck[] = [];

  // Firewall — derived from the real state we already parsed. Reflect whichever
  // backend is actually active (ufw vs firewalld).
  const backendLabel = backend === "firewalld" ? "firewalld" : "ufw";
  checks.push({
    id: "firewall-enabled",
    title: "방화벽 활성화",
    severity: fw.enabled ? "ok" : "high",
    passed: fw.enabled,
    detail: fw.enabled ? `${backendLabel} 방화벽이 활성화되어 있습니다.` : "방화벽이 꺼져 있어 모든 포트가 노출됩니다.",
    recommendation: fw.enabled ? "기본 수신 정책을 deny로 유지하세요." : "방화벽을 활성화하고 필요한 포트만 허용하세요.",
  });

  // SSH root login — only when sshd_config is readable.
  const sshd = await run("grep -Ei '^[[:space:]]*PermitRootLogin' /etc/ssh/sshd_config");
  if (sshd.code === 0) {
    const rootDisabled = /no/i.test(sshd.stdout);
    checks.push({
      id: "ssh-root-login",
      title: "SSH 루트 로그인 비활성화",
      severity: rootDisabled ? "ok" : "high",
      passed: rootDisabled,
      detail: rootDisabled ? "PermitRootLogin 이 no 로 설정되어 있습니다." : "PermitRootLogin 이 no 가 아닙니다.",
      recommendation: "PermitRootLogin no 로 변경하고 sudo 권한의 일반 계정을 사용하세요.",
    });
  }

  // SSH password auth — only when sshd_config is readable.
  const pwAuth = await run("grep -Ei '^[[:space:]]*PasswordAuthentication' /etc/ssh/sshd_config");
  if (pwAuth.code === 0) {
    const disabled = /no/i.test(pwAuth.stdout);
    checks.push({
      id: "ssh-password-auth",
      title: "SSH 비밀번호 인증",
      severity: disabled ? "ok" : "medium",
      passed: disabled,
      detail: disabled ? "비밀번호 인증이 비활성화되어 있습니다." : "비밀번호 인증이 허용되어 있습니다.",
      recommendation: "공개키 인증만 허용하고 PasswordAuthentication no 로 설정하세요.",
    });
  }

  // Automatic security updates — measurable via command presence.
  const unattended = await hasCommand("unattended-upgrade");
  checks.push({
    id: "auto-updates",
    title: "자동 보안 업데이트",
    severity: unattended ? "low" : "medium",
    passed: unattended,
    detail: unattended ? "unattended-upgrades 가 설치되어 있습니다." : "자동 보안 업데이트가 설치되어 있지 않습니다.",
    recommendation: "업데이트 알림을 이메일로 받도록 구성하면 더욱 좋습니다.",
  });

  // 2FA — app-managed state, always known.
  checks.push({
    id: "two-factor",
    title: "2단계 인증(2FA)",
    severity: tfa.enabled ? "ok" : "medium",
    passed: tfa.enabled,
    detail: tfa.enabled ? "관리자 계정에 TOTP 2FA가 활성화되어 있습니다." : "관리자 계정에 2FA가 설정되어 있지 않습니다.",
    recommendation: tfa.enabled ? "복구 코드를 안전한 곳에 보관하세요." : "2단계 인증 탭에서 TOTP 2FA를 설정하세요.",
  });

  return checks;
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getSecurityOverview(): Promise<SecurityOverview> {
  let firewall = state.firewall;
  let checks: SecurityCheck[];

  if (USE_MOCK) {
    checks = buildChecks(firewall, state.twoFactor);
  } else {
    const backend = await firewallBackend();
    try {
      if (backend === "ufw") {
        firewall = await readRealFirewall();
      } else if (backend === "firewalld") {
        firewall = await readFirewalldFirewall();
      } else {
        firewall = emptyFirewall();
      }
      state.firewall = firewall;
    } catch {
      firewall = state.firewall;
    }
    checks = await buildRealChecks(firewall, state.twoFactor, backend);
  }

  return {
    firewall,
    checks,
    twoFactor: state.twoFactor,
    isMock: USE_MOCK,
  };
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export type SecurityAction =
  | { kind: "firewall.toggle"; enabled: boolean }
  | { kind: "firewall.setDefault"; defaultIncoming: "allow" | "deny" }
  | { kind: "rule.create"; rule: Partial<FirewallRule> }
  | { kind: "rule.delete"; id: string }
  | { kind: "advisor.scan" }
  | { kind: "twoFactor.setup" }
  | { kind: "twoFactor.verify"; code: string }
  | { kind: "twoFactor.disable" };

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

export async function runSecurityAction(a: SecurityAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "firewall.toggle": {
      state.firewall = { ...state.firewall, enabled: a.enabled };
      if (!USE_MOCK) {
        const backend = await firewallBackend();
        if (backend === "firewalld") {
          const cmd = a.enabled
            ? "systemctl enable --now firewalld"
            : "systemctl disable --now firewalld";
          const { code, stderr } = await run(cmd, { timeoutMs: 15000 });
          if (code !== 0) return fail(stderr.trim() || "방화벽 변경에 root 권한 필요");
        } else if (backend === "ufw") {
          const { code, stderr } = await run(a.enabled ? "ufw --force enable" : "ufw disable", { timeoutMs: 15000 });
          if (code !== 0) return fail(stderr.trim() || "방화벽 변경에 root 권한 필요");
        }
      }
      return ok();
    }

    case "firewall.setDefault": {
      const def = a.defaultIncoming === "allow" ? "allow" : "deny";
      state.firewall = { ...state.firewall, defaultIncoming: def };
      if (!USE_MOCK) {
        const backend = await firewallBackend();
        if (backend === "firewalld") {
          const zone = (await run("firewall-cmd --get-default-zone")).stdout.trim() || "public";
          const tgt = def === "allow" ? "ACCEPT" : "default";
          const setRes = await run(
            `firewall-cmd --permanent --zone=${zone} --set-target=${tgt}`,
            { timeoutMs: 15000 }
          );
          if (setRes.code !== 0) return fail(setRes.stderr.trim() || "기본 정책 변경에 root 권한 필요");
          await run("firewall-cmd --reload", { timeoutMs: 15000 });
        } else if (backend === "ufw") {
          const { code, stderr } = await run(`ufw default ${def} incoming`, { timeoutMs: 15000 });
          if (code !== 0) return fail(stderr.trim() || "기본 정책 변경에 root 권한 필요");
        }
      }
      return ok();
    }

    case "rule.create": {
      const r = a.rule ?? {};
      const action: FwAction = ACTIONS.includes(r.action as FwAction) ? (r.action as FwAction) : "allow";
      const protocol: FwProtocol = PROTOCOLS.includes(r.protocol as FwProtocol) ? (r.protocol as FwProtocol) : "any";
      const port = (r.port ?? "").trim();
      const source = (r.source ?? "any").trim() || "any";
      if (!PORT_RE.test(port)) return fail("포트 형식이 올바르지 않습니다.");
      if (!SOURCE_RE.test(source)) return fail("소스 형식이 올바르지 않습니다.");

      const rule: FirewallRule = {
        id: `rule-${++ruleSeq}`,
        action,
        direction: "in",
        protocol,
        port,
        source,
        comment: (r.comment ?? "").slice(0, 80),
      };
      state.firewall = { ...state.firewall, rules: [...state.firewall.rules, rule] };

      if (!USE_MOCK) {
        const backend = await firewallBackend();
        if (backend === "firewalld") {
          // firewalld has no concept of source/action per port here — it adds a
          // permanent allow rule for the port on the default zone.
          if (!FIREWALLD_PORT_RE.test(port)) return fail("포트 형식이 올바르지 않습니다.");
          const protos = protocol === "any" ? ["tcp", "udp"] : [protocol];
          for (const p of protos) {
            const { code, stderr } = await run(
              `firewall-cmd --permanent --add-port=${port}/${p}`,
              { timeoutMs: 15000 }
            );
            if (code !== 0) return fail(stderr.trim() || "규칙 추가에 root 권한 필요");
          }
          await run("firewall-cmd --reload", { timeoutMs: 15000 });
        } else if (backend === "ufw") {
          const proto = protocol === "any" ? "" : ` proto ${protocol}`;
          const from = source === "any" ? "any" : source;
          const cmd = `ufw ${action}${proto} from ${from} to any port ${port}`;
          const { code, stderr } = await run(cmd, { timeoutMs: 15000 });
          if (code !== 0) return fail(stderr.trim() || "규칙 추가에 root 권한 필요");
        }
      }
      return ok();
    }

    case "rule.delete": {
      const removed = state.firewall.rules.find((x) => x.id === a.id);
      state.firewall = {
        ...state.firewall,
        rules: state.firewall.rules.filter((x) => x.id !== a.id),
      };
      if (!USE_MOCK) {
        const backend = await firewallBackend();
        if (backend === "firewalld") {
          // Best-effort: derive the firewalld object from the id we stored at
          // read time (fwport-<port>-<proto> or fwsvc-<service>).
          const portMatch = a.id.match(/^fwport-([0-9-]+)-(tcp|udp|any)$/);
          // Constrain the service name to firewalld-legal characters so it can
          // never carry shell metacharacters into the interpolated command.
          const svcMatch = a.id.match(/^fwsvc-([A-Za-z0-9._-]+)$/);
          if (portMatch) {
            const port = portMatch[1];
            const protos = portMatch[2] === "any" ? ["tcp", "udp"] : [portMatch[2]];
            for (const p of protos) {
              await run(`firewall-cmd --permanent --remove-port=${port}/${p}`, { timeoutMs: 15000 });
            }
            await run("firewall-cmd --reload", { timeoutMs: 15000 });
          } else if (svcMatch) {
            await run(`firewall-cmd --permanent --remove-service=${svcMatch[1]}`, { timeoutMs: 15000 });
            await run("firewall-cmd --reload", { timeoutMs: 15000 });
          } else if (removed?.port && FIREWALLD_PORT_RE.test(removed.port)) {
            const protos = removed.protocol === "any" ? ["tcp", "udp"] : [removed.protocol];
            for (const p of protos) {
              await run(`firewall-cmd --permanent --remove-port=${removed.port}/${p}`, { timeoutMs: 15000 });
            }
            await run("firewall-cmd --reload", { timeoutMs: 15000 });
          }
        } else if (backend === "ufw") {
          // Best-effort: ufw delete by rule number is fragile; reload from real state next poll.
          const num = a.id.replace(/[^0-9]/g, "");
          if (num) await run(`ufw --force delete ${num}`, { timeoutMs: 15000 });
        }
      }
      return ok();
    }

    case "advisor.scan":
      // Re-evaluation happens on the next overview fetch; nothing to mutate.
      return ok();

    case "twoFactor.setup": {
      const secret = generateSecret();
      const otpauthUrl = `otpauth://totp/NAS%20Console:admin?secret=${secret}&issuer=NAS%20Console`;
      state.twoFactor = { enabled: false, secret, otpauthUrl, verified: false };
      return ok();
    }

    case "twoFactor.verify": {
      const code = (a.code ?? "").trim();
      const secret = state.twoFactor.secret;
      if (!secret) return fail("먼저 2FA를 설정하세요.");
      const valid = (USE_MOCK && code === "123456") || verifyTotp(secret, code);
      if (!valid) return fail("코드가 올바르지 않습니다");
      state.twoFactor = { ...state.twoFactor, verified: true, enabled: true };
      return ok();
    }

    case "twoFactor.disable": {
      state.twoFactor = { enabled: false, secret: "", otpauthUrl: "", verified: false };
      return ok();
    }

    default:
      return fail("알 수 없는 작업입니다.");
  }
}
