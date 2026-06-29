import { exec, spawn } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_BUFFER = 1024 * 1024 * 16;

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

/**
 * Single-quote a value for safe interpolation into a `bash -c` string. Exported
 * so every call site uses one audited copy instead of re-deriving the escaper.
 * NOTE: prefer {@link runArgs} (no shell at all) for anything taking user input;
 * `shq` only defends against shell metacharacters, not argument injection.
 */
export function shq(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
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
      maxBuffer: MAX_BUFFER,
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

/**
 * Run a command WITHOUT a shell — `file` and each element of `args` are passed
 * to the kernel verbatim, so shell metacharacters in user-supplied arguments
 * (`;`, `|`, `$()`, backticks, newlines, spaces) are inert. This is the safe
 * path for every privileged action that interpolates user input; prefer it over
 * {@link run} + string templates.
 *
 * Under sudo the wrapper becomes `sudo -n <file> <args...>` (still no shell).
 * `opts.input`, when provided, is written to the child's stdin (use this to pass
 * secrets/passwords/passphrases instead of putting them on the command line).
 */
export async function runArgs(
  file: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string } = {}
): Promise<RunResult> {
  const spawnFile = USE_SUDO ? "sudo" : file;
  const spawnArgs = USE_SUDO ? ["-n", file, ...args] : args;

  return new Promise<RunResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(spawnFile, spawnArgs, { windowsHide: true });

    const finish = (res: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ stdout, stderr: stderr || "command timed out", code: 124 });
    }, opts.timeoutMs ?? 8000);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_BUFFER) child.kill("SIGKILL");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > MAX_BUFFER) child.kill("SIGKILL");
    });
    child.on("error", (e: Error) => finish({ stdout, stderr: stderr || e.message, code: 1 }));
    child.on("close", (code: number | null) => finish({ stdout, stderr, code: code ?? 1 }));

    // Guard against EPIPE if the child closes stdin early (e.g. large input to a
    // command that stops reading) — an unhandled stream error would crash the process.
    child.stdin.on("error", () => {});
    if (opts.input != null) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/** Returns true if a command exists on PATH. */
export async function hasCommand(name: string): Promise<boolean> {
  const { code } = await run(`command -v ${name}`);
  return code === 0;
}
