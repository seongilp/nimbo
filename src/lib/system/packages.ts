import type { PackageApp, PackageOverview } from "@/lib/types";
import { hasCommand, run, USE_MOCK } from "./exec";

// --------------------------------------------------------------------------
// Catalog — a curated list of popular self-hosted apps. `installed`/`running`
// here are defaults; the real flags are resolved from `docker ps` at runtime
// and the mock flags from module state.
// --------------------------------------------------------------------------
interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  developer: string;
  image: string;
  ports: string[];
}

const CATALOG: CatalogEntry[] = [
  {
    id: "plex",
    name: "Plex",
    category: "미디어",
    description: "영화·드라마·음악을 모든 기기로 스트리밍하는 강력한 미디어 서버입니다.",
    developer: "Plex Inc.",
    image: "plexinc/pms-docker",
    ports: ["32400:32400"],
  },
  {
    id: "jellyfin",
    name: "Jellyfin",
    category: "미디어",
    description: "완전 무료 오픈소스 미디어 서버로 광고·계정 없이 미디어를 스트리밍합니다.",
    developer: "Jellyfin Project",
    image: "jellyfin/jellyfin",
    ports: ["8096:8096"],
  },
  {
    id: "nextcloud",
    name: "Nextcloud",
    category: "생산성",
    description: "파일 동기화·공유·캘린더·문서 협업을 제공하는 셀프호스팅 클라우드입니다.",
    developer: "Nextcloud GmbH",
    image: "nextcloud",
    ports: ["80:80"],
  },
  {
    id: "homeassistant",
    name: "Home Assistant",
    category: "자동화",
    description: "수천 개 기기를 연동해 집안 전체를 자동화하는 스마트홈 허브입니다.",
    developer: "Open Home Foundation",
    image: "ghcr.io/home-assistant/home-assistant",
    ports: ["8123:8123"],
  },
  {
    id: "pihole",
    name: "Pi-hole",
    category: "네트워크",
    description: "네트워크 전체에서 광고와 추적기를 차단하는 DNS 싱크홀입니다.",
    developer: "Pi-hole LLC",
    image: "pihole/pihole",
    ports: ["80:80", "53:53"],
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    category: "보안",
    description: "Bitwarden 호환 셀프호스팅 비밀번호 관리 서버로 가볍게 동작합니다.",
    developer: "Vaultwarden",
    image: "vaultwarden/server",
    ports: ["80:80"],
  },
  {
    id: "portainer",
    name: "Portainer",
    category: "관리",
    description: "컨테이너·이미지·볼륨을 웹에서 한눈에 관리하는 Docker 관리 도구입니다.",
    developer: "Portainer.io",
    image: "portainer/portainer-ce",
    ports: ["9000:9000"],
  },
  {
    id: "immich",
    name: "Immich",
    category: "사진",
    description: "Google 포토를 대체하는 고성능 셀프호스팅 사진·영상 백업 솔루션입니다.",
    developer: "Immich Team",
    image: "ghcr.io/immich-app/immich-server",
    ports: ["2283:2283"],
  },
  {
    id: "adguardhome",
    name: "AdGuard Home",
    category: "네트워크",
    description: "광고·추적 차단과 부모 제어를 제공하는 네트워크 단위 DNS 서버입니다.",
    developer: "AdGuard",
    image: "adguard/adguardhome",
    ports: ["3000:3000"],
  },
  {
    id: "gitea",
    name: "Gitea",
    category: "개발",
    description: "가볍고 빠른 셀프호스팅 Git 서비스로 코드 저장소를 직접 운영합니다.",
    developer: "Gitea",
    image: "gitea/gitea",
    ports: ["3000:3000"],
  },
  {
    id: "grafana",
    name: "Grafana",
    category: "모니터링",
    description: "지표를 아름다운 대시보드로 시각화하고 알림을 보내는 분석 플랫폼입니다.",
    developer: "Grafana Labs",
    image: "grafana/grafana",
    ports: ["3000:3000"],
  },
  {
    id: "uptimekuma",
    name: "Uptime Kuma",
    category: "모니터링",
    description: "웹사이트·서비스의 가동 상태를 감시하고 장애 시 알림을 보내는 도구입니다.",
    developer: "Louis Lam",
    image: "louislam/uptime-kuma",
    ports: ["3001:3001"],
  },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    category: "다운로드",
    description: "웹 UI를 갖춘 가볍고 광고 없는 오픈소스 BitTorrent 클라이언트입니다.",
    developer: "LinuxServer.io",
    image: "linuxserver/qbittorrent",
    ports: ["8080:8080"],
  },
  {
    id: "transmission",
    name: "Transmission",
    category: "다운로드",
    description: "리소스를 적게 쓰는 간결한 BitTorrent 클라이언트로 원격 제어를 지원합니다.",
    developer: "LinuxServer.io",
    image: "linuxserver/transmission",
    ports: ["9091:9091"],
  },
  {
    id: "paperlessngx",
    name: "Paperless-ngx",
    category: "문서",
    description: "종이 문서를 스캔·OCR·색인해 검색 가능한 디지털 아카이브로 만듭니다.",
    developer: "Paperless-ngx",
    image: "ghcr.io/paperless-ngx/paperless-ngx",
    ports: ["8000:8000"],
  },
  {
    id: "navidrome",
    name: "Navidrome",
    category: "음악",
    description: "Subsonic 호환 셀프호스팅 음악 스트리밍 서버로 개인 음악을 어디서나 듣습니다.",
    developer: "Deluan Quintão",
    image: "deluan/navidrome",
    ports: ["4533:4533"],
  },
];

const CATALOG_IDS = new Set(CATALOG.map((c) => c.id));
const ID_RE = /^[a-z0-9-]+$/;

// --------------------------------------------------------------------------
// Mock state — mutable installed/running flags keyed by app id.
// --------------------------------------------------------------------------
interface AppFlags {
  installed: boolean;
  running: boolean;
}

const mockState: Record<string, AppFlags> = Object.fromEntries(
  CATALOG.map((c) => {
    const seeded = c.id === "plex" || c.id === "qbittorrent" || c.id === "portainer";
    return [c.id, { installed: seeded, running: seeded }];
  })
);

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getPackageOverview(): Promise<PackageOverview> {
  const flags = USE_MOCK ? mockState : await resolveRealFlags();
  const catalog: PackageApp[] = CATALOG.map((c) => {
    const f = flags[c.id] ?? { installed: false, running: false };
    return { ...c, installed: f.installed, running: f.running };
  });
  return { catalog, isMock: USE_MOCK };
}

/**
 * Best-effort resolution of installed/running state from `docker ps -a`.
 * Matches container names against catalog ids. If docker is missing every
 * app is reported as not installed.
 */
async function resolveRealFlags(): Promise<Record<string, AppFlags>> {
  const flags: Record<string, AppFlags> = {};
  for (const c of CATALOG) flags[c.id] = { installed: false, running: false };

  if (!(await hasCommand("docker"))) return flags;

  const { stdout, code } = await run("docker ps -a --format '{{.Names}} {{.State}}'");
  if (code !== 0) return flags;

  for (const line of stdout.split("\n").filter(Boolean)) {
    const [name, state] = line.trim().split(/\s+/);
    if (!name) continue;
    const lname = name.toLowerCase();
    const match = CATALOG.find((c) => lname === c.id || lname.includes(c.id));
    if (!match) continue;
    flags[match.id] = {
      installed: true,
      running: (state ?? "").toLowerCase().includes("running"),
    };
  }
  return flags;
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface PackageAction {
  kind: string;
  id?: string;
}

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

export async function runPackageAction(
  a: PackageAction
): Promise<{ ok: boolean; error?: string }> {
  const id = a.id ?? "";
  if (!ID_RE.test(id) || !CATALOG_IDS.has(id)) return fail("알 수 없는 앱입니다.");
  const app = CATALOG.find((c) => c.id === id)!;

  switch (a.kind) {
    case "app.install":
      return installApp(app);
    case "app.uninstall":
      return uninstallApp(app);
    case "app.start":
      return startApp(app);
    case "app.stop":
      return stopApp(app);
    default:
      return fail("알 수 없는 작업입니다.");
  }
}

function firstPortMapping(app: CatalogEntry): string | null {
  const first = app.ports[0];
  if (!first) return null;
  const host = first.split(":")[0];
  // Keep it simple & robust: map host:host of the first declared port.
  return /^\d+$/.test(host) ? `${host}:${host}` : null;
}

async function installApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    mockState[app.id] = { installed: true, running: true };
    return ok();
  }
  const mapping = firstPortMapping(app);
  const portArg = mapping ? `-p ${mapping} ` : "";
  const cmd = `docker run -d --name ${app.id} --restart unless-stopped ${portArg}${app.image}`;
  const { code, stderr } = await run(cmd, { timeoutMs: 120_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "설치에 실패했습니다.");
}

async function uninstallApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    mockState[app.id] = { installed: false, running: false };
    return ok();
  }
  const { code, stderr } = await run(`docker rm -f ${app.id}`, { timeoutMs: 30_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "제거에 실패했습니다.");
}

async function startApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    const cur = mockState[app.id] ?? { installed: true, running: false };
    mockState[app.id] = { installed: true, running: true };
    void cur;
    return ok();
  }
  const { code, stderr } = await run(`docker start ${app.id}`, { timeoutMs: 30_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "시작에 실패했습니다.");
}

async function stopApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    mockState[app.id] = { installed: true, running: false };
    return ok();
  }
  const { code, stderr } = await run(`docker stop ${app.id}`, { timeoutMs: 30_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "중지에 실패했습니다.");
}
