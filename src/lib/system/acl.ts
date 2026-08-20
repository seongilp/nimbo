import path from "node:path";

import type { AclAction, AclEntry, AclInfo, AclTag } from "@/lib/types";
import { hasCommand, runArgs, USE_MOCK } from "./exec";

// ---------------------------------------------------------------------------
// Validation — every value below is interpolated into an argv passed to
// setfacl/getfacl. runArgs() never spawns a shell, so metacharacters are inert;
// these checks additionally block *argument* injection (a leading "-" turning a
// path into a flag) and nonsense input that would otherwise reach the tool.
// ---------------------------------------------------------------------------

/** A POSIX user/group name, or a bare numeric uid/gid. */
const QUALIFIER_RE = /^(?:[0-9]{1,10}|[a-z_][a-z0-9_-]{0,31}\$?)$/;

const TAGS: readonly AclTag[] = ["user", "group", "mask", "other"];

/** Roots ACLs may be edited under. Defaults to "/" (admin-only API). */
const ACL_ROOTS = (process.env.NIMBO_ACL_ROOTS ?? "/")
  .split(":")
  .filter(Boolean)
  .map((r) => path.resolve(r));

/**
 * Normalise a caller-supplied path, or return null when it is unusable.
 * Rejects relative paths, NUL bytes, "-"-prefixed values (argv injection) and
 * anything outside {@link ACL_ROOTS}.
 */
export function normalizeAclPath(input: string): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.includes("\0") || raw.startsWith("-")) return null;
  if (!raw.startsWith("/")) return null;
  const resolved = path.resolve(raw);
  const inRoot = ACL_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root.endsWith("/") ? root : root + "/")
  );
  return inRoot ? resolved : null;
}

/** Normalise a permission string to exactly "rwx"-style 3 chars, or null. */
export function normalizePerms(input: string): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (s === "" || s === "-" || s === "---") return "---";
  if (!/^[rwx-]{1,3}$/.test(s)) return null;
  const set = new Set(s.split("").filter((c) => c !== "-"));
  return (set.has("r") ? "r" : "-") + (set.has("w") ? "w" : "-") + (set.has("x") ? "x" : "-");
}

function validTag(tag: unknown): tag is AclTag {
  return typeof tag === "string" && (TAGS as readonly string[]).includes(tag);
}

/**
 * Build the `<tag>:<qualifier>[:<perms>]` spec setfacl expects, or null when
 * the entry is invalid. `perms` is omitted for -x (removal) specs.
 */
export function buildAclSpec(
  entry: { tag?: unknown; qualifier?: unknown; isDefault?: boolean },
  perms: string | null
): string | null {
  if (!validTag(entry.tag)) return null;
  const qualifier = typeof entry.qualifier === "string" ? entry.qualifier.trim() : "";
  // Only user/group entries take a qualifier; mask/other are always bare.
  if (entry.tag === "mask" || entry.tag === "other") {
    if (qualifier) return null;
  } else if (qualifier && !QUALIFIER_RE.test(qualifier)) {
    return null;
  }
  const prefix = entry.isDefault ? "default:" : "";
  const base = `${prefix}${entry.tag}:${qualifier}`;
  return perms === null ? base : `${base}:${perms}`;
}

// ---------------------------------------------------------------------------
// getfacl output parsing
// ---------------------------------------------------------------------------

/**
 * Parse `getfacl` text output into structured entries. Comment lines
 * (`# file:`, `# owner:`, `# group:`, `# flags:`) and the "#effective:" suffix
 * are ignored — the effective perms are derived from the mask by the UI.
 */
export function parseGetfacl(text: string): AclEntry[] {
  const entries: AclEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const isDefault = line.startsWith("default:");
    const body = isDefault ? line.slice("default:".length) : line;
    const parts = body.split(":");
    if (parts.length < 3) continue;
    const tag = parts[0];
    if (!validTag(tag)) continue;
    const qualifier = parts[1];
    const perms = normalizePerms(parts[2]);
    if (perms === null) continue;
    entries.push({ tag, qualifier, perms, isDefault });
  }
  return entries;
}

interface StatInfo {
  mode: string;
  owner: string;
  group: string;
  isDirectory: boolean;
}

async function statPath(target: string): Promise<StatInfo | null> {
  const { stdout, code } = await runArgs("stat", ["-c", "%a|%U|%G|%F", target]);
  if (code !== 0) return null;
  const [mode, owner, group, kind] = stdout.trim().split("|");
  if (!mode) return null;
  return {
    mode: mode.padStart(4, "0"),
    owner: owner || "?",
    group: group || "?",
    isDirectory: /directory/i.test(kind ?? ""),
  };
}

function mockAcl(target: string): AclInfo {
  return {
    path: target,
    owner: "root",
    group: "nimbo-users",
    mode: "0775",
    isDirectory: true,
    entries: [
      { tag: "user", qualifier: "", perms: "rwx", isDefault: false },
      { tag: "user", qualifier: "alice", perms: "rwx", isDefault: false },
      { tag: "group", qualifier: "", perms: "rwx", isDefault: false },
      { tag: "group", qualifier: "media", perms: "r-x", isDefault: false },
      { tag: "mask", qualifier: "", perms: "rwx", isDefault: false },
      { tag: "other", qualifier: "", perms: "r--", isDefault: false },
      { tag: "user", qualifier: "", perms: "rwx", isDefault: true },
      { tag: "group", qualifier: "media", perms: "r-x", isDefault: true },
      { tag: "other", qualifier: "", perms: "---", isDefault: true },
    ],
    supported: true,
    toolInstalled: true,
    isMock: true,
  };
}

/** Read the full ACL of a path. Throws only on an invalid/blocked path. */
export async function getAcl(requested: string): Promise<AclInfo> {
  const target = normalizeAclPath(requested);
  if (!target) throw new Error("허용되지 않은 경로입니다.");
  if (USE_MOCK) return mockAcl(target);

  const toolInstalled = await hasCommand("getfacl");
  const stat = await statPath(target);
  if (!stat) throw new Error("경로를 찾을 수 없습니다.");

  const base: AclInfo = {
    path: target,
    owner: stat.owner,
    group: stat.group,
    mode: stat.mode,
    isDirectory: stat.isDirectory,
    entries: [],
    supported: false,
    toolInstalled,
    isMock: false,
  };
  if (!toolInstalled) return base;

  const { stdout, stderr, code } = await runArgs("getfacl", ["-p", "--", target]);
  if (code !== 0) {
    // "Operation not supported" = filesystem mounted without ACL support.
    if (/not supported/i.test(stderr)) return base;
    throw new Error("ACL을 읽을 수 없습니다.");
  }
  return { ...base, entries: parseGetfacl(stdout), supported: true };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Translate an {@link AclAction} into the exact setfacl argv, or an error.
 * Pure so the argument construction is unit-testable without touching a host.
 */
export function buildSetfaclArgs(action: AclAction, target: string): string[] | { error: string } {
  const recursive = "recursive" in action && action.recursive ? ["-R"] : [];
  switch (action.kind) {
    case "entry.set": {
      const perms = normalizePerms(action.entry?.perms ?? "");
      if (perms === null) return { error: "권한 값이 올바르지 않습니다." };
      const spec = buildAclSpec(action.entry ?? {}, perms);
      if (!spec) return { error: "ACL 항목이 올바르지 않습니다." };
      return [...recursive, "-m", spec, "--", target];
    }
    case "entry.remove": {
      const entry: { tag?: unknown; qualifier?: unknown; isDefault?: boolean } = action.entry ?? {};
      // The three base entries (user::, group::, other::) are mandatory in every
      // ACL — setfacl -x cannot drop them. Reject with a clear message instead
      // of surfacing setfacl's cryptic error.
      const bare = !(typeof entry.qualifier === "string" && entry.qualifier.trim());
      if (entry.tag === "other" || (bare && (entry.tag === "user" || entry.tag === "group"))) {
        return { error: "기본 항목(소유자·소유그룹·other)은 삭제할 수 없습니다." };
      }
      const spec = buildAclSpec(entry, null);
      if (!spec) return { error: "ACL 항목이 올바르지 않습니다." };
      return [...recursive, "-x", spec, "--", target];
    }
    case "clear":
      return [...recursive, "-b", "--", target];
    case "clear.default":
      return [...recursive, "-k", "--", target];
    default:
      return { error: "알 수 없는 작업입니다." };
  }
}

export async function runAclAction(action: AclAction): Promise<{ ok: boolean; error?: string }> {
  const target = normalizeAclPath(action?.path ?? "");
  if (!target) return fail("허용되지 않은 경로입니다.");

  const built = buildSetfaclArgs(action, target);
  if ("error" in built) return fail(built.error);
  if (USE_MOCK) return { ok: true };

  if (!(await hasCommand("setfacl"))) {
    return fail("setfacl이 설치되어 있지 않습니다. (acl 패키지를 설치하세요)");
  }
  const { code, stderr } = await runArgs("setfacl", built, { timeoutMs: 30_000 });
  if (code !== 0) {
    return fail(/not supported/i.test(stderr) ? "이 파일시스템은 ACL을 지원하지 않습니다." : stderr.trim() || "ACL 적용에 실패했습니다.");
  }
  return { ok: true };
}
