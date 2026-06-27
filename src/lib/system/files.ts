import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { DirListing, FileEntry } from "@/lib/types";
import { USE_MOCK } from "./exec";
import { mockListing } from "./mock";

/**
 * Roots the file browser is allowed to read. In a real deployment this would be
 * the configured share volumes. Anything outside is rejected to avoid traversal.
 */
const ALLOWED_ROOTS = (process.env.NAS_FILE_ROOTS ?? "/").split(":").filter(Boolean);

function isAllowed(target: string): boolean {
  const resolved = path.resolve(target);
  return ALLOWED_ROOTS.some(
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

export async function listDirectory(requested: string): Promise<DirListing> {
  if (USE_MOCK) return mockListing(requested);

  const target = path.resolve(requested || "/");
  if (!isAllowed(target)) {
    throw new Error("Access to this path is not permitted");
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
  return { path: target, parent: parent && isAllowed(parent) ? parent : null, entries, isMock: false };
}
