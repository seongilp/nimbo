import { run, shq, USE_MOCK } from "./exec";

export interface TerminalResult {
  /** Combined stdout + stderr to print. */
  output: string;
  /** Working directory after the command (tracks `cd`). */
  cwd: string;
  /** Process exit code (0 = success). */
  code: number;
}

export const TERMINAL_HOME = "/root";

// ---------------------------------------------------------------------------
// Real execution (admin-only; gated in the route). Each command runs in the
// caller-tracked working directory via the app's privileged shell. `cd` is
// resolved by echoing `pwd` so the client can follow directory changes.
// ---------------------------------------------------------------------------
async function realCommand(command: string, cwd: string): Promise<TerminalResult> {
  const safeCwd = cwd.startsWith("/") ? cwd : TERMINAL_HOME;
  const isCd = /^cd(\s|$)/.test(command);
  const script = isCd
    ? `cd ${shq(safeCwd)} && ${command} && pwd`
    : `cd ${shq(safeCwd)} && ${command}`;
  const { stdout, stderr, code } = await run(script, { timeoutMs: 30_000 });

  if (isCd) {
    if (code === 0) {
      const lines = stdout.replace(/\n$/, "").split("\n");
      return { output: "", cwd: lines[lines.length - 1] || safeCwd, code: 0 };
    }
    return { output: (stderr || "cd: 디렉터리를 변경할 수 없습니다").replace(/\n$/, ""), cwd: safeCwd, code };
  }
  const joined = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr;
  return { output: joined.replace(/\n$/, ""), cwd: safeCwd, code };
}

// ---------------------------------------------------------------------------
// Mock shell — used in the public demo. NEVER touches a real shell; it walks a
// tiny in-memory tree and answers a handful of read-only commands so the
// terminal feels live without any execution.
// ---------------------------------------------------------------------------
const MOCK_TREE: Record<string, string[]> = {
  "/": ["bin", "etc", "home", "opt", "var", "volume1"],
  "/home": ["admin"],
  "/home/admin": [".bashrc", "docs", "photos"],
  "/opt": ["nimbo"],
  "/volume1": ["Movies", "Photos", "Backups", "Public"],
  "/etc": ["nimbo", "samba", "fstab", "os-release"],
};

const MOCK_HELP = [
  "지원 명령(데모): help, pwd, ls, cd, whoami, hostname, uname, date, uptime,",
  "  echo, df, free, clear",
  "데모 환경에서는 실제 셸이 실행되지 않습니다 — 실제 서버 콘솔에서만 동작합니다.",
].join("\n");

function resolvePath(cwd: string, arg: string): string {
  if (arg === "~") return "/home/admin";
  const raw = !arg ? cwd : arg.startsWith("/") ? arg : `${cwd}/${arg}`;
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.length ? "/" + parts.join("/") : "/";
}

function mockCommand(command: string, cwd: string): TerminalResult {
  const [cmd, ...args] = command.split(/\s+/);
  const arg = args.join(" ");
  const ok = (output: string): TerminalResult => ({ output, cwd, code: 0 });

  switch (cmd) {
    case "help":
      return ok(MOCK_HELP);
    case "pwd":
      return ok(cwd);
    case "whoami":
      return ok("admin");
    case "hostname":
      return ok("nimbo-demo");
    case "uname":
      return ok("Linux nimbo-demo 6.1.0-demo #1 SMP x86_64 GNU/Linux");
    case "date":
      return ok("Tue Jul  1 00:00:00 KST 2026");
    case "uptime":
      return ok(" 00:00:00 up 12 days,  3:21,  1 user,  load average: 0.08, 0.10, 0.09");
    case "df":
      return ok("Filesystem      Size  Used Avail Use% Mounted on\ntank             22T  9.9T   12T  46% /volume1");
    case "free":
      return ok("               total        used        free\nMem:            31Gi        12Gi        19Gi");
    case "echo":
      return ok(arg);
    case "ls": {
      const target = args.find((a) => !a.startsWith("-"));
      const path = target ? resolvePath(cwd, target) : cwd;
      const entries = MOCK_TREE[path];
      if (!entries) return { output: `ls: '${target || cwd}'에 접근할 수 없음`, cwd, code: 2 };
      return ok(entries.join("  "));
    }
    case "cd": {
      const path = !arg ? "/home/admin" : resolvePath(cwd, arg);
      if (!MOCK_TREE[path]) {
        return { output: `cd: ${arg}: 그런 파일이나 디렉터리가 없습니다`, cwd, code: 1 };
      }
      return { output: "", cwd: path, code: 0 };
    }
    case "cat":
      return { output: "cat: 데모에서는 파일 내용을 표시하지 않습니다", cwd, code: 1 };
    case "":
      return ok("");
    default:
      return { output: `${cmd}: command not found (데모에서는 일부 명령만 지원합니다 — help)`, cwd, code: 127 };
  }
}

export async function runTerminalCommand(commandRaw: string, cwd: string): Promise<TerminalResult> {
  const command = (commandRaw ?? "").trim();
  const base = cwd || (USE_MOCK ? "/home/admin" : TERMINAL_HOME);
  if (!command) return { output: "", cwd: base, code: 0 };
  return USE_MOCK ? mockCommand(command, base) : realCommand(command, base);
}
