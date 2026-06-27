import { readFile } from "node:fs/promises";

import type { ShareInfo } from "@/lib/types";
import { USE_MOCK } from "./exec";
import { mockShares } from "./mock";

function parseSmbConf(text: string): ShareInfo[] {
  const shares: ShareInfo[] = [];
  let current: Partial<ShareInfo> & { name?: string } | null = null;
  const flush = () => {
    if (current?.name && current.path) {
      shares.push({
        name: current.name,
        path: current.path,
        protocol: "smb",
        readOnly: current.readOnly ?? false,
        guestOk: current.guestOk ?? false,
        enabled: current.enabled ?? true,
      });
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      flush();
      const name = section[1];
      current = name.toLowerCase() === "global" ? null : { name, enabled: true };
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^([\w ]+)=(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const value = kv[2].trim();
    if (key === "path") current.path = value;
    if (key === "read only") current.readOnly = /yes|true/i.test(value);
    if (key === "writable" || key === "writeable") current.readOnly = !/yes|true/i.test(value);
    if (key === "guest ok" || key === "public") current.guestOk = /yes|true/i.test(value);
    if (key === "available") current.enabled = /yes|true/i.test(value);
  }
  flush();
  return shares;
}

function parseExports(text: string): ShareInfo[] {
  const shares: ShareInfo[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s+(.*)$/);
    if (!m) continue;
    const path = m[1];
    const opts = m[2];
    shares.push({
      name: path.split("/").filter(Boolean).pop() || path,
      path,
      protocol: "nfs",
      readOnly: /\bro\b/.test(opts),
      guestOk: /no_root_squash|all_squash/.test(opts),
      enabled: true,
    });
  }
  return shares;
}

export async function getShares(): Promise<ShareInfo[]> {
  if (USE_MOCK) return mockShares();
  const shares: ShareInfo[] = [];
  try {
    const smb = await readFile("/etc/samba/smb.conf", "utf8");
    shares.push(...parseSmbConf(smb));
  } catch {
    // samba not configured
  }
  try {
    const exp = await readFile("/etc/exports", "utf8");
    shares.push(...parseExports(exp));
  } catch {
    // nfs not configured
  }
  return shares.length ? shares : mockShares();
}
