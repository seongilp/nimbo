import { readFile } from "node:fs/promises";
import os from "node:os";

import type { ProcessInfo, SystemOverview } from "@/lib/types";
import { runArgs, USE_MOCK } from "./exec";
import { mockOverview, mockProcesses } from "./mock";

// --- CPU usage via /proc/stat sampling -----------------------------------
let lastCpu: { idle: number; total: number } | null = null;

async function readCpuUsage(): Promise<number> {
  try {
    const stat = await readFile("/proc/stat", "utf8");
    const line = stat.split("\n").find((l) => l.startsWith("cpu "));
    if (!line) return 0;
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] ?? 0);
    const total = parts.reduce((a, b) => a + b, 0);
    if (lastCpu) {
      const idleDelta = idle - lastCpu.idle;
      const totalDelta = total - lastCpu.total;
      lastCpu = { idle, total };
      if (totalDelta <= 0) return 0;
      return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
    }
    lastCpu = { idle, total };
    // No baseline yet — approximate with a short-window load snapshot.
    return Math.min(100, (os.loadavg()[0] / os.cpus().length) * 100);
  } catch {
    return 0;
  }
}

// --- Network rate via /proc/net/dev sampling ------------------------------
let lastNet: { time: number; rx: number; tx: number } | null = null;

async function readNetwork() {
  try {
    const data = await readFile("/proc/net/dev", "utf8");
    const interfaces: { name: string; rxBytes: number; txBytes: number }[] = [];
    let totalRx = 0;
    let totalTx = 0;
    for (const line of data.split("\n")) {
      const m = line.match(/^\s*([\w.-]+):\s+(.*)$/);
      if (!m) continue;
      const name = m[1];
      if (name === "lo") continue;
      const cols = m[2].trim().split(/\s+/).map(Number);
      const rx = cols[0];
      const tx = cols[8];
      interfaces.push({ name, rxBytes: rx, txBytes: tx });
      totalRx += rx;
      totalTx += tx;
    }
    const now = Date.now();
    let rxRate = 0;
    let txRate = 0;
    if (lastNet) {
      const dt = (now - lastNet.time) / 1000;
      if (dt > 0) {
        rxRate = Math.max(0, (totalRx - lastNet.rx) / dt);
        txRate = Math.max(0, (totalTx - lastNet.tx) / dt);
      }
    }
    lastNet = { time: now, rx: totalRx, tx: totalTx };
    return { rxBytesPerSec: Math.floor(rxRate), txBytesPerSec: Math.floor(txRate), interfaces };
  } catch {
    return { rxBytesPerSec: 0, txBytesPerSec: 0, interfaces: [] };
  }
}

async function readMemory() {
  try {
    const data = await readFile("/proc/meminfo", "utf8");
    const map: Record<string, number> = {};
    for (const line of data.split("\n")) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) map[m[1]] = Number(m[2]) * 1024;
    }
    const memTotal = map.MemTotal ?? 0;
    const memFree = map.MemFree ?? 0;
    const memAvail = map.MemAvailable ?? memFree;
    const buffCache = (map.Buffers ?? 0) + (map.Cached ?? 0) + (map.SReclaimable ?? 0);
    const appUsed = Math.max(0, memTotal - memFree - buffCache);
    const swapTotal = map.SwapTotal ?? 0;
    const swapFree = map.SwapFree ?? 0;
    return {
      memory: {
        totalBytes: memTotal,
        usedBytes: memTotal - memAvail, // keep for the radial gauge
        freeBytes: memFree,
        buffCacheBytes: buffCache,
        appUsedBytes: appUsed,
      },
      swap: { totalBytes: swapTotal, usedBytes: swapTotal - swapFree, freeBytes: swapFree },
    };
  } catch {
    // Non-Linux (e.g. macOS) fallback: no buffer/cache breakdown available.
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      memory: {
        totalBytes: total,
        usedBytes: used,
        freeBytes: free,
        buffCacheBytes: 0,
        appUsedBytes: used,
      },
      swap: { totalBytes: 0, usedBytes: 0, freeBytes: 0 },
    };
  }
}

async function readTemperature(): Promise<number | null> {
  const { stdout, code } = await runArgs("cat", [
    "/sys/class/thermal/thermal_zone0/temp",
  ]);
  if (code === 0 && stdout.trim()) {
    const raw = Number(stdout.trim());
    if (!Number.isNaN(raw)) return Number((raw / 1000).toFixed(1));
  }
  return null;
}

async function readDistro(): Promise<string> {
  const { stdout, code } = await runArgs("cat", ["/etc/os-release"]);
  if (code === 0) {
    const m = stdout.match(/PRETTY_NAME="?([^"\n]+)"?/);
    if (m) return m[1];
  }
  return `${os.type()} ${os.release()}`;
}

export async function getOverview(): Promise<SystemOverview> {
  if (USE_MOCK) return mockOverview();
  const [usagePercent, network, mem, temperatureC, distro] = await Promise.all([
    readCpuUsage(),
    readNetwork(),
    readMemory(),
    readTemperature(),
    readDistro(),
  ]);
  const cpus = os.cpus();
  const load = os.loadavg() as [number, number, number];
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    distro,
    kernel: os.release(),
    uptimeSeconds: Math.floor(os.uptime()),
    loadAvg: [Number(load[0].toFixed(2)), Number(load[1].toFixed(2)), Number(load[2].toFixed(2))],
    cpu: {
      model: cpus[0]?.model?.trim() ?? "Unknown CPU",
      cores: cpus.length,
      usagePercent: Number(usagePercent.toFixed(1)),
    },
    memory: mem.memory,
    swap: mem.swap,
    network,
    temperatureC,
    isMock: false,
  };
}

export async function getProcesses(): Promise<ProcessInfo[]> {
  if (USE_MOCK) return mockProcesses();
  const { stdout, code } = await runArgs("ps", [
    "-eo",
    "pid,user,%cpu,%mem,comm",
    "--sort=-%cpu",
    "--no-headers",
  ]);
  if (code !== 0) return mockProcesses();
  const procs: ProcessInfo[] = [];
  // Equivalent of the former `| head -n 30`: take the first 30 output lines.
  for (const line of stdout.split("\n").slice(0, 30)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [pid, user, cpu, mem, ...rest] = parts;
    procs.push({
      pid: Number(pid),
      user,
      cpuPercent: Number(cpu),
      memPercent: Number(mem),
      command: rest.join(" "),
    });
  }
  return procs;
}
