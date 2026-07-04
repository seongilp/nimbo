import { realpathSync } from "node:fs";
import path from "node:path";

import type { DirListing, FileContext, FileEntry } from "@/lib/types";
import { runArgs, USE_MOCK } from "./exec";
import { mockListing } from "./mock";

// Canonicalise a root through realpath so a root that is itself a symlink
// (e.g. /volume1 -> /mnt/pool/volume1) still matches the realpath'd request
// path below. Falls back to the resolved path when the root does not exist.
function canonicalRoot(r: string): string {
  const resolved = path.resolve(r);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Extra roots an ADMIN may browse (beyond their own home). Configured via
 * NAS_FILE_ROOTS (colon-separated); defaults to "/" so an admin can manage the
 * whole box. Regular users are always scoped to their home only, so this never
 * widens a non-admin's access.
 */
const ADMIN_ROOTS = (process.env.NAS_FILE_ROOTS ?? "/")
  .split(":")
  .filter(Boolean)
  .map(canonicalRoot);

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

// The user's home directory (from /etc/passwd), or a safe fallback.
async function resolveHome(user: string): Promise<string> {
  if (USE_MOCK) return `/home/${user}`;
  if (!USER_RE.test(user)) return "/tmp";
  try {
    const { stdout, code } = await runArgs("getent", ["passwd", user]);
    const home = code === 0 ? stdout.split(":")[5]?.trim() : "";
    if (home) return canonicalRoot(home);
  } catch {
    // fall through
  }
  return `/home/${user}`;
}

/**
 * The File Station context for a given session: the user's home (the default
 * location), whether they're an admin, and the roots to show in the sidebar.
 * Non-admins get their home only; admins additionally get the ADMIN_ROOTS.
 */
export async function getFileContext(user: string, isAdmin: boolean): Promise<FileContext> {
  const home = await resolveHome(user);
  const roots: FileContext["roots"] = [{ label: `홈 (${user})`, path: home }];
  if (isAdmin) {
    for (const r of ADMIN_ROOTS) {
      if (r !== home) roots.push({ label: r === "/" ? "Root (/)" : r, path: r });
    }
  }
  return { user, isAdmin, home, roots };
}

// Roots a request is allowed to touch: home for everyone, + ADMIN_ROOTS for admins.
function allowedRoots(ctx: FileContext): string[] {
  return ctx.isAdmin ? [ctx.home, ...ADMIN_ROOTS] : [ctx.home];
}

function isAllowed(target: string, roots: string[]): boolean {
  const resolved = path.resolve(target);
  return roots.some(
    (root) => resolved === root || resolved.startsWith(root.endsWith("/") ? root : root + "/")
  );
}

function permString(mode: number, isDir: boolean): string {
  const chars = ["r", "w", "x"];
  let out = isDir ? "d" : "-";
  for (let i = 8; i >= 0; i--) {
    out += mode & (1 << i) ? chars[2 - (i % 3)] : "-";
  }
  return out;
}

// Directory listing that runs with the RIGHT identity — the service account
// (nimbo) can't read a user's 0700 home. Admins list as root; regular users list
// as themselves (both via the existing passwordless sudo), so a user sees their
// own files and can never read another user's private files even if the path
// check let them. Returns the realpath + a stat of each entry as JSON.
const LIST_SCRIPT = `
const fs=require("fs"),path=require("path");
const rp=fs.realpathSync(process.argv[1]);
const entries=fs.readdirSync(rp,{withFileTypes:true}).map(function(d){
  var full=path.join(rp,d.name);
  try{
    var ls=fs.lstatSync(full), isLink=ls.isSymbolicLink();
    var s=isLink?fs.statSync(full):ls;
    return {name:d.name,type:isLink?"symlink":s.isDirectory()?"directory":"file",
            size:s.size,mtime:s.mtimeMs,mode:s.mode,uid:s.uid};
  }catch(e){return null;}
}).filter(Boolean);
process.stdout.write(JSON.stringify({path:rp,entries:entries}));
`;

interface RawEntry { name: string; type: FileEntry["type"]; size: number; mtime: number; mode: number; uid: number }

export async function listDirectory(requested: string, ctx: FileContext): Promise<DirListing> {
  if (USE_MOCK) return mockListing(requested || ctx.home);

  const roots = allowedRoots(ctx);
  // Default to the user's home when no (or an out-of-scope empty) path is given.
  const requestedPath = path.resolve(requested || ctx.home);
  if (!isAllowed(requestedPath, roots)) {
    throw new Error("Access to this path is not permitted");
  }

  // Read as root (admin) or as the user (non-admin) — never as the nimbo account.
  const sudo = ctx.isAdmin ? ["-n"] : ["-n", "-u", ctx.user];
  const { stdout, code, stderr } = await runArgs("sudo", [...sudo, "node", "-e", LIST_SCRIPT, requestedPath]);
  if (code !== 0) {
    throw new Error(/EACCES|permission/i.test(stderr) ? "이 폴더를 읽을 권한이 없습니다." : "폴더를 열 수 없습니다.");
  }

  let parsed: { path: string; entries: RawEntry[] };
  try {
    parsed = JSON.parse(stdout) as { path: string; entries: RawEntry[] };
  } catch {
    throw new Error("폴더 목록을 해석할 수 없습니다.");
  }
  // Re-check the resolved realpath: a symlink must not escape the allowed roots.
  const target = parsed.path;
  if (!isAllowed(target, roots)) throw new Error("Access to this path is not permitted");

  const entries: FileEntry[] = parsed.entries.map((e) => ({
    name: e.name,
    path: path.join(target, e.name),
    type: e.type,
    sizeBytes: e.size,
    modified: e.mtime,
    permissions: permString(e.mode, e.type === "directory"),
    owner: String(e.uid),
  }));
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const parent = target === "/" ? null : path.dirname(target);
  return { path: target, parent: parent && isAllowed(parent, roots) ? parent : null, entries, isMock: false };
}
