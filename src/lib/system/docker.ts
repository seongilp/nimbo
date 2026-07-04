import type { ContainerInfo } from "@/lib/types";
import { hasCommand, runArgs, USE_MOCK } from "./exec";
import { mockContainers } from "./mock";

function parseSize(text: string): number {
  // e.g. "1.5GiB", "512MiB", "0B"
  const m = text.trim().match(/([\d.]+)\s*([KMGT]?i?B)?/i);
  if (!m) return 0;
  const val = Number(m[1]);
  const unit = (m[2] ?? "B").toUpperCase();
  const factor: Record<string, number> = {
    B: 1,
    KB: 1e3, KIB: 1024,
    MB: 1e6, MIB: 1024 ** 2,
    GB: 1e9, GIB: 1024 ** 3,
    TB: 1e12, TIB: 1024 ** 4,
  };
  return Math.floor(val * (factor[unit] ?? 1));
}

function normalizeState(raw: string): ContainerInfo["state"] {
  const s = raw.toLowerCase();
  if (s.includes("running") || s.includes("up")) return "running";
  if (s.includes("paused")) return "paused";
  if (s.includes("restart")) return "restarting";
  if (s.includes("created")) return "created";
  if (s.includes("dead")) return "dead";
  return "exited";
}

export async function getContainers(): Promise<ContainerInfo[]> {
  if (USE_MOCK) return mockContainers();
  if (!(await hasCommand("docker"))) return mockContainers();

  const fmt =
    '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","state":"{{.State}}","status":"{{.Status}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}"}';
  const { stdout, code } = await runArgs("docker", ["ps", "-a", "--no-trunc", "--format", fmt]);
  if (code !== 0) return mockContainers();

  // Live resource stats (no-stream snapshot).
  const statsMap = new Map<string, { cpu: number; mem: number; limit: number }>();
  const { stdout: statsOut, code: statsCode } = await runArgs("docker", [
    "stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}",
  ]);
  if (statsCode === 0) {
    for (const line of statsOut.split("\n").filter(Boolean)) {
      const [name, cpu, memUsage] = line.split("|");
      const [used, limit] = (memUsage ?? "0B / 0B").split("/");
      statsMap.set(name?.trim(), {
        cpu: Number((cpu ?? "0").replace("%", "")) || 0,
        mem: parseSize(used ?? "0B"),
        limit: parseSize(limit ?? "0B"),
      });
    }
  }

  const containers: ContainerInfo[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    try {
      const obj = JSON.parse(line);
      const live = statsMap.get(obj.name);
      containers.push({
        id: String(obj.id).slice(0, 12),
        name: obj.name,
        image: obj.image,
        state: normalizeState(obj.state || obj.status),
        status: obj.status,
        ports: String(obj.ports || "")
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean),
        cpuPercent: live?.cpu ?? 0,
        memUsageBytes: live?.mem ?? 0,
        memLimitBytes: live?.limit ?? 0,
        createdAt: Date.parse(obj.created) || Date.now(),
      });
    } catch {
      // skip malformed line
    }
  }
  return containers;
}

const VALID_ACTIONS = new Set(["start", "stop", "restart", "pause", "unpause"]);

export async function containerAction(
  id: string,
  action: string
): Promise<{ ok: boolean; error?: string }> {
  if (!VALID_ACTIONS.has(action)) return { ok: false, error: "Invalid action" };
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) return { ok: false, error: "Invalid container id" };
  if (USE_MOCK) return { ok: true };
  const { code, stderr } = await runArgs("docker", [action, id], { timeoutMs: 20000 });
  return code === 0 ? { ok: true } : { ok: false, error: stderr.trim() || "Action failed" };
}
