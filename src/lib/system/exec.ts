import { exec } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export const IS_LINUX = os.platform() === "linux";

/**
 * Whether to serve mock data. Forced on when not running on Linux, or when
 * NAS_MOCK=1 is set (useful for local UI development on any OS).
 */
export const USE_MOCK = !IS_LINUX || process.env.NAS_MOCK === "1";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

// When the service runs as a non-root user (the dedicated `nimbo` account) with
// passwordless sudo, NIMBO_SUDO=1 makes every shell command run as root via
// `sudo bash -c`. Wrapping the whole command preserves pipes/redirects.
const USE_SUDO = process.env.NIMBO_SUDO === "1";
function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
function wrap(command: string): string {
  return USE_SUDO ? `sudo -n bash -c ${shq(command)}` : command;
}

/**
 * Run a shell command safely with a timeout. Never throws — on failure returns
 * a non-zero code and the captured stderr so callers can fall back gracefully.
 */
export async function run(
  command: string,
  opts: { timeoutMs?: number } = {}
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execAsync(wrap(command), {
      timeout: opts.timeoutMs ?? 8000,
      maxBuffer: 1024 * 1024 * 16,
      windowsHide: true,
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "command failed",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

/** Returns true if a command exists on PATH. */
export async function hasCommand(name: string): Promise<boolean> {
  const { code } = await run(`command -v ${name}`);
  return code === 0;
}
