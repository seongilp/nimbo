import { realpathSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
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

export async function listDirectory(requested: string, ctx: FileContext): Promise<DirListing> {
  if (USE_MOCK) return mockListing(requested || ctx.home);

  const roots = allowedRoots(ctx);
  // Default to the user's home when no (or an out-of-scope empty) path is given.
  const requestedPath = path.resolve(requested || ctx.home);
  if (!isAllowed(requestedPath, roots)) {
    throw new Error("Access to this path is not permitted");
  }
  // Resolve symlinks and re-check: a symlink inside an allowed root must not be
  // a stepping stone out of it.
  let target = requestedPath;
  try {
    target = await realpath(requestedPath);
    if (!isAllowed(target, roots)) throw new Error("Access to this path is not permitted");
  } catch (err) {
    throw err instanceof Error ? err : new Error("Access to this path is not permitted");
  }

  const dirents = await readdir(target, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const d of dirents) {
    const full = path.join(target, d.name);
    try {
      const s = await stat(full);
      const type: FileEntry["type"] = d.isSymbolicLink()
        ? "symlink"
        : s.isDirectory()
          ? "directory"
          : "file";
      entries.push({
        name: d.name,
        path: full,
        type,
        sizeBytes: s.size,
        modified: s.mtimeMs,
        permissions: permString(s.mode, s.isDirectory()),
        owner: String(s.uid),
      });
    } catch {
      // Unreadable entry (broken symlink, permission denied) — skip it.
    }
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const parent = target === "/" ? null : path.dirname(target);
  return { path: target, parent: parent && isAllowed(parent, roots) ? parent : null, entries, isMock: false };
}
