import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SetupConfig } from "@/lib/types";
import { USE_MOCK } from "./exec";

const SETUP_FILE =
  process.env.NAS_SETUP_FILE ??
  (USE_MOCK ? path.join(os.tmpdir(), "nimbo-setup.json") : "/etc/nimbo/setup.json");

function defaults(): SetupConfig {
  return {
    setupComplete: false,
    hostname: USE_MOCK ? "nas-server" : os.hostname(),
    adminUser: "admin",
    port: Number(process.env.PORT) || 3000,
    httpsEnabled: true,
    dataPath: "/volume1",
    timezone: USE_MOCK ? "Asia/Seoul" : Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// In mock/dev, default to "already set up" so the polished desktop shows
// directly. Append ?setup=1 to the URL to preview the wizard. On a real fresh
// host the setup file is absent → setupComplete:false → the wizard runs.
let mem: SetupConfig = { ...defaults(), setupComplete: USE_MOCK };

export async function getSetupConfig(): Promise<SetupConfig> {
  if (USE_MOCK) return mem;
  try {
    const raw = await readFile(SETUP_FILE, "utf8");
    return { ...defaults(), ...(JSON.parse(raw) as Partial<SetupConfig>), setupComplete: true };
  } catch {
    return defaults(); // no file yet → run setup
  }
}

export interface SetupAction {
  kind: string;
  config?: Partial<SetupConfig>;
}

export async function runSetupAction(a: SetupAction): Promise<{ ok: boolean; error?: string }> {
  switch (a.kind) {
    case "setup.save": {
      const merged: SetupConfig = { ...defaults(), ...mem, ...(a.config ?? {}), setupComplete: true };
      // basic validation
      if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(merged.hostname)) return { ok: false, error: "잘못된 호스트 이름" };
      if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(merged.adminUser)) return { ok: false, error: "잘못된 관리자 계정" };
      if (merged.port < 1 || merged.port > 65535) return { ok: false, error: "포트 범위 오류" };
      mem = merged;
      if (!USE_MOCK) {
        try {
          await mkdir(path.dirname(SETUP_FILE), { recursive: true });
          await writeFile(SETUP_FILE, JSON.stringify(merged, null, 2), "utf8");
        } catch (err) {
          return { ok: false, error: (err as Error).message + " — 설정 저장 권한이 필요합니다" };
        }
      }
      return { ok: true };
    }
    case "setup.reset":
      mem = { ...defaults(), setupComplete: false };
      return { ok: true };
    default:
      return { ok: false, error: "unknown action" };
  }
}
