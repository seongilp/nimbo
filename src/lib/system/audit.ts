import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AuditEntry, AuditOverview } from "@/lib/types";
import { runArgs, USE_MOCK } from "./exec";

const MAX_ENTRIES = 500;

// Persist Nimbo's own audit events (logins, ZFS/backup actions) to disk so they
// survive a service restart. OS login history is already durable via wtmp.
const AUDIT_FILE =
  process.env.NIMBO_AUDIT_FILE ??
  path.join(path.dirname(process.env.NIMBO_AUTH_FILE ?? "/etc/nimbo/users.json"), "audit.jsonl");

let counter = 0;

function nextId(): string {
  return `audit-${Date.now()}-${counter++}`;
}

// Seed timestamps descending over the last few days.
const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 86_400_000;

function buildSeed(): AuditEntry[] {
  const now = Date.now();
  // Each tuple: [offset from now, user, action, target, result, ip]
  const rows: Array<[number, string, string, string, AuditEntry["result"], string]> = [
    [3 * MIN, "admin", "로그인", "웹 콘솔 (관리자)", "success", "192.168.1.20"],
    [12 * MIN, "media", "컨테이너 재시작", "docker/plex", "success", "192.168.1.51"],
    [38 * MIN, "root", "풀 스크럽 시작", "zpool: tank", "success", "10.0.0.5"],
    [52 * MIN, "admin", "스냅샷 생성", "tank/photos@manual-0627", "success", "192.168.1.20"],
    [1 * HOUR + 8 * MIN, "plex", "로그인", "Plex 미디어 서버", "success", "192.168.1.51"],
    [1 * HOUR + 40 * MIN, "admin", "방화벽 규칙 변경", "ufw: allow 32400/tcp", "success", "192.168.1.20"],
    [2 * HOUR + 5 * MIN, "root", "사용자 추가", "user: backup-svc", "success", "10.0.0.5"],
    [2 * HOUR + 33 * MIN, "media", "공유 폴더 생성", "/volume1/Downloads", "success", "192.168.1.51"],
    [3 * HOUR + 1 * MIN, "unknown", "로그인", "SSH (sshd)", "failed", "10.0.0.88"],
    [3 * HOUR + 2 * MIN, "unknown", "로그인", "SSH (sshd)", "failed", "10.0.0.88"],
    [3 * HOUR + 4 * MIN, "unknown", "로그인", "SSH (sshd)", "failed", "10.0.0.88"],
    [3 * HOUR + 47 * MIN, "admin", "백업 작업 실행", "rsync: 사진 원격 백업", "success", "192.168.1.20"],
    [4 * HOUR + 15 * MIN, "root", "SSH 키 생성", "id_ed25519 (backup-svc)", "success", "10.0.0.5"],
    [5 * HOUR + 9 * MIN, "admin", "설정 변경", "network: static IP 192.168.1.10", "success", "192.168.1.20"],
    [6 * HOUR + 22 * MIN, "media", "백업 작업 실행", "rsync: 미디어 → 콜드 스토리지", "failed", "192.168.1.51"],
    [7 * HOUR + 50 * MIN, "admin", "데이터셋 삭제", "tank/tmp/scratch", "success", "192.168.1.20"],
    [9 * HOUR + 3 * MIN, "root", "방화벽 규칙 변경", "ufw: deny 23/tcp", "success", "10.0.0.5"],
    [11 * HOUR + 18 * MIN, "plex", "컨테이너 재시작", "docker/tautulli", "success", "192.168.1.51"],
    [13 * HOUR + 41 * MIN, "admin", "스냅샷 생성", "tank/docs@daily-0626", "success", "192.168.1.20"],
    [16 * HOUR + 6 * MIN, "root", "설정 변경", "smb.conf: vfs_recycle 활성화", "success", "10.0.0.5"],
    [19 * HOUR + 27 * MIN, "admin", "사용자 추가", "user: guest", "failed", "192.168.1.20"],
    [22 * HOUR + 12 * MIN, "media", "공유 폴더 생성", "/volume1/Series", "success", "192.168.1.51"],
    [1 * DAY + 1 * HOUR, "admin", "로그인", "웹 콘솔 (관리자)", "success", "192.168.1.20"],
    [1 * DAY + 4 * HOUR, "root", "풀 스크럽 시작", "zpool: backup", "success", "10.0.0.5"],
    [1 * DAY + 7 * HOUR, "admin", "백업 작업 실행", "rsync: 문서 백업", "success", "192.168.1.20"],
    [1 * DAY + 12 * HOUR, "media", "컨테이너 재시작", "docker/qbittorrent", "failed", "192.168.1.51"],
    [1 * DAY + 18 * HOUR, "root", "SSH 키 생성", "id_rsa (admin-laptop)", "success", "10.0.0.5"],
    [2 * DAY + 2 * HOUR, "admin", "데이터셋 삭제", "tank/old/2024-archive", "success", "192.168.1.20"],
    [2 * DAY + 9 * HOUR, "admin", "설정 변경", "system: 시간대 Asia/Seoul", "success", "192.168.1.20"],
    [2 * DAY + 15 * HOUR, "root", "방화벽 규칙 변경", "ufw: allow 22/tcp from 192.168.1.0/24", "success", "10.0.0.5"],
    [3 * DAY + 5 * HOUR, "admin", "스냅샷 생성", "tank/media@weekly-0624", "success", "192.168.1.20"],
  ];
  return rows.map(([offset, user, action, target, result, ip]): AuditEntry => ({
    id: nextId(),
    ts: now - offset,
    user,
    action,
    target,
    result,
    ip,
  }));
}

// Module-level mutable log, newest first. Demo entries are only seeded in
// mock/dev mode; on a real deployment the log starts empty and is populated
// solely by real logAudit() calls.
let entries: AuditEntry[] = USE_MOCK ? buildSeed() : [];

// --------------------------------------------------------------------------
// Real system login history (from wtmp via `last`)
// --------------------------------------------------------------------------
// Parses one `last -F -i` row, e.g.:
//   zihado  pts/0  192.168.1.5  Sat Jun 28 18:00:00 2026   still logged in
//   root    pts/1  0.0.0.0      Sat Jun 28 12:00:00 2026 - 12:30 (00:30)
const LAST_RE = /^(\S+)\s+(\S+)\s+(\S*)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})/;

async function readLoginHistory(): Promise<AuditEntry[]> {
  const { stdout, code } = await runArgs("last", ["-F", "-i", "-n", "40"]);
  if (code !== 0 || !stdout.trim()) return [];
  const out: AuditEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim() || /^(wtmp|reboot|shutdown|runlevel)/.test(line)) continue;
    const m = line.match(LAST_RE);
    if (!m) continue;
    const [, user, tty, from, dateStr] = m;
    const ts = Date.parse(dateStr);
    if (Number.isNaN(ts)) continue;
    const ip = /^\d+\.\d+\.\d+\.\d+$/.test(from) && from !== "0.0.0.0" ? from : "로컬";
    out.push({
      id: `login-${ts}-${user}-${tty}`,
      ts,
      user,
      action: "로그인 세션",
      target: tty,
      result: "success",
      ip,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Persistence (real mode only) — append-only JSONL so concurrent writers and
// restarts never clobber prior history.
// --------------------------------------------------------------------------
async function readPersisted(): Promise<AuditEntry[]> {
  try {
    const raw = await readFile(AUDIT_FILE, "utf8");
    const rows = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEntry => e !== null);
    return rows;
  } catch {
    return [];
  }
}

async function persistEntry(entry: AuditEntry): Promise<void> {
  if (USE_MOCK) return;
  try {
    await mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    await appendFile(AUDIT_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // best-effort; the in-memory copy still serves this session
  }
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getAuditOverview(): Promise<AuditOverview> {
  if (USE_MOCK) return { entries, isMock: true };
  // Merge the durable on-disk Nimbo log + this session's in-memory entries with
  // real OS login history, newest first, de-duplicated by id.
  const [persisted, history] = await Promise.all([
    readPersisted().catch(() => []),
    readLoginHistory().catch(() => []),
  ]);
  const merged = new Map<string, AuditEntry>();
  for (const e of [...persisted, ...entries, ...history]) merged.set(e.id, e);
  const all = [...merged.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_ENTRIES);
  return { entries: all, isMock: false };
}

// --------------------------------------------------------------------------
// Recording (used by other modules)
// --------------------------------------------------------------------------
export function logAudit(
  user: string,
  action: string,
  target: string,
  result: "success" | "failed",
  ip = "127.0.0.1"
): void {
  const entry: AuditEntry = {
    id: nextId(),
    ts: Date.now(),
    user,
    action,
    target,
    result,
    ip,
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  void persistEntry(entry);
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface AuditAction {
  kind: string;
}

export async function runAuditAction(a: AuditAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "audit.clear": {
      entries = [];
      if (!USE_MOCK) {
        await mkdir(path.dirname(AUDIT_FILE), { recursive: true }).catch(() => {});
        await writeFile(AUDIT_FILE, "", "utf8").catch(() => {});
      }
      return { ok: true };
    }
    default:
      return { ok: false, error: "알 수 없는 작업" };
  }
}
