import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { PackageApp } from "@/lib/types";
import { hasCommand, run, USE_MOCK } from "./exec";

// --------------------------------------------------------------------------
// Host configuration. Where persistent app data and media live on the NAS,
// and the identity containers should run as. Overridable via env.
// --------------------------------------------------------------------------
const APPDATA = process.env.NIMBO_APPDATA ?? "/opt/appdata";
const MEDIA = process.env.NIMBO_MEDIA ?? "/srv/media";
const PUID = process.env.NIMBO_PUID ?? "1000";
const PGID = "1000";
const TZ = process.env.TZ ?? "Asia/Seoul";

// --------------------------------------------------------------------------
// Compose context handed to each catalog entry's `compose()` builder.
// `appdata` is already scoped to the app (`${APPDATA}/<id>`).
// --------------------------------------------------------------------------
export interface ComposeContext {
  appdata: string;
  media: string;
  puid: string;
  pgid: string;
  tz: string;
  dbPassword: string;
}

// --------------------------------------------------------------------------
// Catalog — a curated list of popular self-hosted apps. Each entry carries a
// real docker-compose template (volumes, env, multi-container) so a one-click
// install produces a genuinely usable, persistent stack. `installed`/`running`
// are resolved at runtime (compose file presence + `docker compose ps`) in real
// mode, and from module state in mock mode.
// --------------------------------------------------------------------------
interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  developer: string;
  image: string;
  ports: string[];
  featured?: boolean;
  tagline: string;
  webPort?: number;
  compose: (ctx: ComposeContext) => string;
}

const CATALOG: CatalogEntry[] = [
  {
    id: "jellyfin",
    name: "Jellyfin",
    category: "미디어",
    description: "완전 무료 오픈소스 미디어 서버로 광고·계정 없이 미디어를 스트리밍합니다.",
    developer: "Jellyfin Project",
    image: "jellyfin/jellyfin",
    ports: ["8096:8096"],
    featured: true,
    tagline: "광고 없는 무료 미디어 서버",
    webPort: 8096,
    compose: (c) => `services:
  jellyfin:
    image: jellyfin/jellyfin
    container_name: jellyfin
    user: "${c.puid}:${c.pgid}"
    ports:
      - "8096:8096"
    volumes:
      - ${c.appdata}/config:/config
      - ${c.appdata}/cache:/cache
      - ${c.media}:/media:ro
    environment:
      - TZ=${c.tz}
    restart: unless-stopped
`,
  },
  {
    id: "plex",
    name: "Plex",
    category: "미디어",
    description: "영화·드라마·음악을 모든 기기로 스트리밍하는 강력한 미디어 서버입니다.",
    developer: "Plex Inc.",
    image: "plexinc/pms-docker",
    ports: ["32400:32400"],
    tagline: "어디서나 즐기는 프리미엄 스트리밍",
    webPort: 32400,
    compose: (c) => `services:
  plex:
    image: plexinc/pms-docker
    container_name: plex
    ports:
      - "32400:32400"
    environment:
      - TZ=${c.tz}
      - PLEX_UID=${c.puid}
      - PLEX_GID=${c.pgid}
    volumes:
      - ${c.appdata}/config:/config
      - ${c.appdata}/transcode:/transcode
      - ${c.media}:/data:ro
    restart: unless-stopped
`,
  },
  {
    id: "immich",
    name: "Immich",
    category: "사진",
    description: "Google 포토를 대체하는 고성능 셀프호스팅 사진·영상 백업 솔루션입니다.",
    developer: "Immich Team",
    image: "ghcr.io/immich-app/immich-server",
    ports: ["2283:2283"],
    featured: true,
    tagline: "구글 포토를 대체하는 사진 백업",
    webPort: 2283,
    compose: (c) => `services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:release
    container_name: immich_server
    ports:
      - "2283:2283"
    volumes:
      - ${c.appdata}/upload:/usr/src/app/upload
      - /etc/localtime:/etc/localtime:ro
    environment:
      - UPLOAD_LOCATION=${c.appdata}/upload
      - DB_HOSTNAME=database
      - DB_USERNAME=postgres
      - DB_PASSWORD=${c.dbPassword}
      - DB_DATABASE_NAME=immich
      - REDIS_HOSTNAME=redis
      - TZ=${c.tz}
    depends_on:
      - redis
      - database
    restart: unless-stopped
  immich-machine-learning:
    image: ghcr.io/immich-app/immich-machine-learning:release
    container_name: immich_machine_learning
    volumes:
      - ${c.appdata}/model-cache:/cache
    environment:
      - DB_HOSTNAME=database
      - DB_USERNAME=postgres
      - DB_PASSWORD=${c.dbPassword}
      - DB_DATABASE_NAME=immich
      - REDIS_HOSTNAME=redis
    restart: unless-stopped
  redis:
    image: docker.io/redis:7
    container_name: immich_redis
    restart: unless-stopped
  database:
    image: ghcr.io/immich-app/postgres:14-vectorchord0.3.0-pgvectors0.2.0
    container_name: immich_postgres
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${c.dbPassword}
      - POSTGRES_DB=immich
      - POSTGRES_INITDB_ARGS=--data-checksums
    volumes:
      - ${c.appdata}/postgres:/var/lib/postgresql/data
    restart: unless-stopped
`,
  },
  {
    id: "nextcloud",
    name: "Nextcloud",
    category: "생산성",
    description: "파일 동기화·공유·캘린더·문서 협업을 제공하는 셀프호스팅 클라우드입니다.",
    developer: "Nextcloud GmbH",
    image: "nextcloud",
    ports: ["8081:80"],
    featured: true,
    tagline: "나만의 셀프호스팅 클라우드",
    webPort: 8081,
    compose: (c) => `services:
  nextcloud:
    image: nextcloud:apache
    container_name: nextcloud
    ports:
      - "8081:80"
    volumes:
      - ${c.appdata}/html:/var/www/html
      - ${c.appdata}/data:/var/www/html/data
    environment:
      - MYSQL_HOST=db
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
      - MYSQL_PASSWORD=${c.dbPassword}
      - REDIS_HOST=redis
      - TZ=${c.tz}
    depends_on:
      - db
      - redis
    restart: unless-stopped
  db:
    image: mariadb:11
    container_name: nextcloud_db
    command: --transaction-isolation=READ-COMMITTED --log-bin=binlog --binlog-format=ROW
    volumes:
      - ${c.appdata}/db:/var/lib/mysql
    environment:
      - MYSQL_ROOT_PASSWORD=${c.dbPassword}
      - MYSQL_PASSWORD=${c.dbPassword}
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
    restart: unless-stopped
  redis:
    image: redis:7
    container_name: nextcloud_redis
    restart: unless-stopped
`,
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    category: "보안",
    description: "Bitwarden 호환 셀프호스팅 비밀번호 관리 서버로 가볍게 동작합니다.",
    developer: "Vaultwarden",
    image: "vaultwarden/server",
    ports: ["8222:80"],
    featured: true,
    tagline: "내 손안의 비밀번호 금고",
    webPort: 8222,
    compose: (c) => `services:
  vaultwarden:
    image: vaultwarden/server
    container_name: vaultwarden
    ports:
      - "8222:80"
    volumes:
      - ${c.appdata}/data:/data
    environment:
      - TZ=${c.tz}
      # 관리 페이지(/admin) 를 사용하려면 아래 ADMIN_TOKEN 의 주석을 풀고 값을 설정하세요.
      # - ADMIN_TOKEN=${c.dbPassword}
    restart: unless-stopped
`,
  },
  {
    id: "pihole",
    name: "Pi-hole",
    category: "네트워크",
    description: "네트워크 전체에서 광고와 추적기를 차단하는 DNS 싱크홀입니다.",
    developer: "Pi-hole LLC",
    image: "pihole/pihole",
    ports: ["8053:80", "53:53"],
    featured: true,
    tagline: "네트워크 전체 광고 차단",
    webPort: 8053,
    compose: (c) => `services:
  pihole:
    image: pihole/pihole
    container_name: pihole
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "8053:80/tcp"
    environment:
      - TZ=${c.tz}
      - WEBPASSWORD=${c.dbPassword}
    volumes:
      - ${c.appdata}/etc-pihole:/etc/pihole
      - ${c.appdata}/etc-dnsmasq.d:/etc/dnsmasq.d
    restart: unless-stopped
`,
  },
  {
    id: "homeassistant",
    name: "Home Assistant",
    category: "자동화",
    description: "수천 개 기기를 연동해 집안 전체를 자동화하는 스마트홈 허브입니다.",
    developer: "Open Home Foundation",
    image: "ghcr.io/home-assistant/home-assistant",
    ports: ["8123:8123"],
    featured: true,
    tagline: "집안 전체를 스마트하게",
    webPort: 8123,
    compose: (c) => `services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: homeassistant
    ports:
      - "8123:8123"
    volumes:
      - ${c.appdata}/config:/config
      - /etc/localtime:/etc/localtime:ro
    environment:
      - TZ=${c.tz}
    restart: unless-stopped
`,
  },
  {
    id: "adguardhome",
    name: "AdGuard Home",
    category: "네트워크",
    description: "광고·추적 차단과 부모 제어를 제공하는 네트워크 단위 DNS 서버입니다.",
    developer: "AdGuard",
    image: "adguard/adguardhome",
    ports: ["3001:3000", "53:53"],
    tagline: "DNS 기반 광고·추적 차단",
    webPort: 3001,
    compose: (c) => `services:
  adguardhome:
    image: adguard/adguardhome
    container_name: adguardhome
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "3001:3000/tcp"
    volumes:
      - ${c.appdata}/work:/opt/adguardhome/work
      - ${c.appdata}/conf:/opt/adguardhome/conf
    environment:
      - TZ=${c.tz}
    restart: unless-stopped
`,
  },
  {
    id: "jellyseerr",
    name: "Jellyseerr",
    category: "미디어",
    description: "Jellyfin·Plex용 미디어 요청 관리 도구로 보고 싶은 콘텐츠를 손쉽게 신청합니다.",
    developer: "Fallenbagel",
    image: "fallenbagel/jellyseerr",
    ports: ["5055:5055"],
    tagline: "미디어 요청을 한곳에서",
    webPort: 5055,
    compose: (c) => `services:
  jellyseerr:
    image: fallenbagel/jellyseerr
    container_name: jellyseerr
    ports:
      - "5055:5055"
    environment:
      - TZ=${c.tz}
    volumes:
      - ${c.appdata}/config:/app/config
    restart: unless-stopped
`,
  },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    category: "다운로드",
    description: "웹 UI를 갖춘 가볍고 광고 없는 오픈소스 BitTorrent 클라이언트입니다.",
    developer: "LinuxServer.io",
    image: "linuxserver/qbittorrent",
    ports: ["8080:8080"],
    tagline: "웹에서 관리하는 토렌트",
    webPort: 8080,
    compose: (c) => `services:
  qbittorrent:
    image: linuxserver/qbittorrent
    container_name: qbittorrent
    ports:
      - "8080:8080"
      - "6881:6881/tcp"
      - "6881:6881/udp"
    environment:
      - PUID=${c.puid}
      - PGID=${c.pgid}
      - TZ=${c.tz}
      - WEBUI_PORT=8080
    volumes:
      - ${c.appdata}/config:/config
      - ${c.media}/downloads:/downloads
    restart: unless-stopped
`,
  },
  {
    id: "transmission",
    name: "Transmission",
    category: "다운로드",
    description: "리소스를 적게 쓰는 간결한 BitTorrent 클라이언트로 원격 제어를 지원합니다.",
    developer: "LinuxServer.io",
    image: "linuxserver/transmission",
    ports: ["9091:9091"],
    tagline: "가벼운 원격 토렌트 클라이언트",
    webPort: 9091,
    compose: (c) => `services:
  transmission:
    image: linuxserver/transmission
    container_name: transmission
    ports:
      - "9091:9091"
      - "51413:51413/tcp"
      - "51413:51413/udp"
    environment:
      - PUID=${c.puid}
      - PGID=${c.pgid}
      - TZ=${c.tz}
    volumes:
      - ${c.appdata}/config:/config
      - ${c.media}/downloads:/downloads
    restart: unless-stopped
`,
  },
  {
    id: "paperlessngx",
    name: "Paperless-ngx",
    category: "문서",
    description: "종이 문서를 스캔·OCR·색인해 검색 가능한 디지털 아카이브로 만듭니다.",
    developer: "Paperless-ngx",
    image: "ghcr.io/paperless-ngx/paperless-ngx",
    ports: ["8010:8000"],
    tagline: "종이 문서를 검색 가능한 아카이브로",
    webPort: 8010,
    compose: (c) => `services:
  paperless:
    image: ghcr.io/paperless-ngx/paperless-ngx
    container_name: paperless
    ports:
      - "8010:8000"
    depends_on:
      - db
      - broker
    environment:
      - PAPERLESS_REDIS=redis://broker:6379
      - PAPERLESS_DBHOST=db
      - PAPERLESS_DBNAME=paperless
      - PAPERLESS_DBUSER=paperless
      - PAPERLESS_DBPASS=${c.dbPassword}
      - PAPERLESS_SECRET_KEY=${c.dbPassword}
      - PAPERLESS_TIME_ZONE=${c.tz}
      - PAPERLESS_OCR_LANGUAGE=kor+eng
      - PAPERLESS_URL=http://localhost:8010
    volumes:
      - ${c.appdata}/data:/usr/src/paperless/data
      - ${c.appdata}/media:/usr/src/paperless/media
      - ${c.appdata}/export:/usr/src/paperless/export
      - ${c.appdata}/consume:/usr/src/paperless/consume
    restart: unless-stopped
  db:
    image: postgres:16
    container_name: paperless_db
    volumes:
      - ${c.appdata}/pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=paperless
      - POSTGRES_USER=paperless
      - POSTGRES_PASSWORD=${c.dbPassword}
    restart: unless-stopped
  broker:
    image: redis:7
    container_name: paperless_broker
    volumes:
      - ${c.appdata}/redisdata:/data
    restart: unless-stopped
`,
  },
  {
    id: "gitea",
    name: "Gitea",
    category: "개발",
    description: "가볍고 빠른 셀프호스팅 Git 서비스로 코드 저장소를 직접 운영합니다.",
    developer: "Gitea",
    image: "gitea/gitea",
    ports: ["3002:3000", "2222:22"],
    tagline: "내가 운영하는 Git 호스팅",
    webPort: 3002,
    compose: (c) => `services:
  gitea:
    image: gitea/gitea
    container_name: gitea
    ports:
      - "3002:3000"
      - "2222:22"
    environment:
      - USER_UID=${c.puid}
      - USER_GID=${c.pgid}
      - TZ=${c.tz}
      - GITEA__database__DB_TYPE=sqlite3
    volumes:
      - ${c.appdata}/data:/data
      - /etc/localtime:/etc/localtime:ro
    restart: unless-stopped
`,
  },
  {
    id: "grafana",
    name: "Grafana",
    category: "모니터링",
    description: "지표를 아름다운 대시보드로 시각화하고 알림을 보내는 분석 플랫폼입니다.",
    developer: "Grafana Labs",
    image: "grafana/grafana",
    ports: ["3003:3000"],
    tagline: "지표를 아름다운 대시보드로",
    webPort: 3003,
    compose: (c) => `services:
  grafana:
    image: grafana/grafana
    container_name: grafana
    user: "${c.puid}"
    ports:
      - "3003:3000"
    environment:
      - TZ=${c.tz}
      - GF_SECURITY_ADMIN_PASSWORD=${c.dbPassword}
    volumes:
      - ${c.appdata}/data:/var/lib/grafana
    restart: unless-stopped
`,
  },
  {
    id: "uptimekuma",
    name: "Uptime Kuma",
    category: "모니터링",
    description: "웹사이트·서비스의 가동 상태를 감시하고 장애 시 알림을 보내는 도구입니다.",
    developer: "Louis Lam",
    image: "louislam/uptime-kuma",
    ports: ["3011:3001"],
    tagline: "서비스 가동 상태 실시간 감시",
    webPort: 3011,
    compose: (c) => `services:
  uptime-kuma:
    image: louislam/uptime-kuma
    container_name: uptime-kuma
    ports:
      - "3011:3001"
    environment:
      - TZ=${c.tz}
    volumes:
      - ${c.appdata}/data:/app/data
    restart: unless-stopped
`,
  },
  {
    id: "navidrome",
    name: "Navidrome",
    category: "음악",
    description: "Subsonic 호환 셀프호스팅 음악 스트리밍 서버로 개인 음악을 어디서나 듣습니다.",
    developer: "Deluan Quintão",
    image: "deluan/navidrome",
    ports: ["4533:4533"],
    tagline: "내 음악을 어디서나 스트리밍",
    webPort: 4533,
    compose: (c) => `services:
  navidrome:
    image: deluan/navidrome
    container_name: navidrome
    user: "${c.puid}:${c.pgid}"
    ports:
      - "4533:4533"
    environment:
      - ND_SCANSCHEDULE=1h
      - TZ=${c.tz}
    volumes:
      - ${c.appdata}/data:/data
      - ${c.media}/music:/music:ro
    restart: unless-stopped
`,
  },
  {
    id: "portainer",
    name: "Portainer",
    category: "관리",
    description: "컨테이너·이미지·볼륨을 웹에서 한눈에 관리하는 Docker 관리 도구입니다.",
    developer: "Portainer.io",
    image: "portainer/portainer-ce",
    ports: ["9000:9000"],
    tagline: "도커를 웹에서 한눈에 관리",
    webPort: 9000,
    compose: (c) => `services:
  portainer:
    image: portainer/portainer-ce
    container_name: portainer
    ports:
      - "9000:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${c.appdata}/data:/data
    restart: unless-stopped
`,
  },
];

const CATALOG_IDS = new Set(CATALOG.map((c) => c.id));
const ID_RE = /^[a-z0-9-]+$/;

// --------------------------------------------------------------------------
// Public view types — the enriched objects the API returns and the UI reads.
// --------------------------------------------------------------------------
export interface PackageAppView extends PackageApp {
  featured?: boolean;
  tagline: string;
  webPort?: number;
  dataPath: string;
}

export interface PackageOverview {
  catalog: PackageAppView[];
  isMock: boolean;
}

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
// Paths & compose engine helpers.
// --------------------------------------------------------------------------
function appDir(id: string): string {
  return `${APPDATA}/${id}`;
}
function composeFile(id: string): string {
  return path.posix.join(appDir(id), "docker-compose.yml");
}
function passFile(id: string): string {
  return path.posix.join(appDir(id), ".nimbo-db-pass");
}

let composeCmdCache: string | null = null;

/** Detect the available compose engine, preferring `docker compose` (v2). */
async function composeCmd(): Promise<string> {
  if (composeCmdCache) return composeCmdCache;
  const v = await run("docker compose version", { timeoutMs: 10_000 });
  composeCmdCache = v.code === 0 ? "docker compose" : "docker-compose";
  return composeCmdCache;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reuse a per-app DB password across (re)installs so stateful stacks
 * (Postgres/MariaDB initialised with the password baked into their volume)
 * keep authenticating. Generated once and stored under the app's data dir.
 */
async function getDbPassword(id: string): Promise<string> {
  const pf = passFile(id);
  try {
    const existing = (await fs.readFile(pf, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // not yet generated
  }
  const pw = crypto.randomBytes(16).toString("hex");
  try {
    await fs.writeFile(pf, pw, { mode: 0o600 });
  } catch {
    // best-effort persistence; fall back to in-memory value
  }
  return pw;
}

// --------------------------------------------------------------------------
// Overview
// --------------------------------------------------------------------------
export async function getPackageOverview(): Promise<PackageOverview> {
  const flags = USE_MOCK ? mockState : await resolveRealFlags();
  const catalog: PackageAppView[] = CATALOG.map((c) => {
    const f = flags[c.id] ?? { installed: false, running: false };
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      description: c.description,
      developer: c.developer,
      image: c.image,
      ports: c.ports,
      installed: f.installed,
      running: f.running,
      featured: c.featured,
      tagline: c.tagline,
      webPort: c.webPort,
      dataPath: appDir(c.id),
    };
  });
  return { catalog, isMock: USE_MOCK };
}

/**
 * Best-effort resolution of installed/running state. An app is considered
 * installed when its compose file exists; running when `docker compose ps`
 * reports at least one live container. Falls back to a `docker ps -a` name
 * match so legacy `docker run` installs still surface. Never throws.
 */
async function resolveRealFlags(): Promise<Record<string, AppFlags>> {
  const flags: Record<string, AppFlags> = {};
  for (const c of CATALOG) flags[c.id] = { installed: false, running: false };

  if (!(await hasCommand("docker"))) return flags;

  const cmd = await composeCmd();
  for (const c of CATALOG) {
    const file = composeFile(c.id);
    if (await fileExists(file)) {
      flags[c.id] = { installed: true, running: await composeRunning(file, cmd) };
    }
  }

  // Legacy fallback: surface containers created via plain `docker run`.
  const { stdout, code } = await run("docker ps -a --format '{{.Names}} {{.State}}'");
  if (code === 0) {
    for (const line of stdout.split("\n").filter(Boolean)) {
      const [name, state] = line.trim().split(/\s+/);
      if (!name) continue;
      const lname = name.toLowerCase();
      const match = CATALOG.find((c) => lname === c.id || lname.includes(c.id));
      if (!match || flags[match.id].installed) continue;
      flags[match.id] = {
        installed: true,
        running: (state ?? "").toLowerCase().includes("running"),
      };
    }
  }

  return flags;
}

/** True if the compose project has at least one running container. */
async function composeRunning(file: string, cmd: string): Promise<boolean> {
  const ps = await run(`${cmd} -f "${file}" ps -q`, { timeoutMs: 15_000 });
  const ids = ps.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return false;
  const insp = await run(`docker inspect -f '{{.State.Running}}' ${ids.join(" ")}`, {
    timeoutMs: 15_000,
  });
  return insp.stdout.includes("true");
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export interface PackageAction {
  kind: string;
  id?: string;
  yaml?: string;
}

// Result objects may carry extra fields (`log`, `yaml`) so the route can
// forward log output / compose contents back to the client.
export interface PackageActionResult {
  ok: boolean;
  error?: string;
  log?: string;
  yaml?: string;
}

function ok(extra?: { log?: string; yaml?: string }): PackageActionResult {
  return { ok: true as const, ...extra };
}
function fail(error: string): PackageActionResult {
  return { ok: false as const, error };
}

export async function runPackageAction(a: PackageAction): Promise<PackageActionResult> {
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
    case "app.logs":
      return logsApp(app);
    case "app.composeGet":
      return composeGet(app);
    case "app.composeSave":
      return composeSave(app, a.yaml ?? "");
    default:
      return fail("알 수 없는 작업입니다.");
  }
}

async function installApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    mockState[app.id] = { installed: true, running: true };
    return ok();
  }

  const dir = appDir(app.id);
  const file = composeFile(app.id);

  const mk = await run(`mkdir -p "${dir}"`, { timeoutMs: 15_000 });
  if (mk.code !== 0) return fail(mk.stderr.trim() || "데이터 폴더 생성에 실패했습니다.");

  const dbPassword = await getDbPassword(app.id);
  const yaml = app.compose({
    appdata: dir,
    media: MEDIA,
    puid: PUID,
    pgid: PGID,
    tz: TZ,
    dbPassword,
  });

  try {
    await fs.writeFile(file, yaml, "utf8");
  } catch (err) {
    return fail((err as Error).message || "compose 파일 작성에 실패했습니다.");
  }

  const cmd = await composeCmd();
  const { code, stderr } = await run(`${cmd} -f "${file}" up -d`, { timeoutMs: 300_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "설치에 실패했습니다.");
}

async function uninstallApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    mockState[app.id] = { installed: false, running: false };
    return ok();
  }

  const file = composeFile(app.id);
  if (await fileExists(file)) {
    const cmd = await composeCmd();
    // Tear down containers/network but keep named/bind volumes (no `-v`).
    const { code, stderr } = await run(`${cmd} -f "${file}" down`, { timeoutMs: 120_000 });
    if (code !== 0) return fail(stderr.trim() || "제거에 실패했습니다.");
    // Drop the compose file so the app reads as uninstalled; data dir stays.
    try {
      await fs.rm(file);
    } catch {
      // ignore — already gone
    }
    return ok();
  }

  // Legacy fallback for plain `docker run` installs.
  const { code, stderr } = await run(`docker rm -f ${app.id}`, { timeoutMs: 30_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "제거에 실패했습니다.");
}

async function startApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    mockState[app.id] = { installed: true, running: true };
    return ok();
  }

  const file = composeFile(app.id);
  if (await fileExists(file)) {
    const cmd = await composeCmd();
    const { code, stderr } = await run(`${cmd} -f "${file}" start`, { timeoutMs: 120_000 });
    if (code === 0) return ok();
    return fail(stderr.trim() || "시작에 실패했습니다.");
  }

  const { code, stderr } = await run(`docker start ${app.id}`, { timeoutMs: 30_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "시작에 실패했습니다.");
}

async function stopApp(app: CatalogEntry): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK) {
    mockState[app.id] = { installed: true, running: false };
    return ok();
  }

  const file = composeFile(app.id);
  if (await fileExists(file)) {
    const cmd = await composeCmd();
    const { code, stderr } = await run(`${cmd} -f "${file}" stop`, { timeoutMs: 120_000 });
    if (code === 0) return ok();
    return fail(stderr.trim() || "중지에 실패했습니다.");
  }

  const { code, stderr } = await run(`docker stop ${app.id}`, { timeoutMs: 30_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "중지에 실패했습니다.");
}

/** Build the compose YAML for an app, reusing its per-app DB password. */
async function buildComposeYaml(app: CatalogEntry): Promise<string> {
  const dir = appDir(app.id);
  const dbPassword = USE_MOCK ? "demo-db-password" : await getDbPassword(app.id);
  return app.compose({ appdata: dir, media: MEDIA, puid: PUID, pgid: PGID, tz: TZ, dbPassword });
}

/** Tail recent container logs for an installed app. */
async function logsApp(app: CatalogEntry): Promise<PackageActionResult> {
  if (USE_MOCK) {
    const now = new Date().toISOString();
    const log = [
      `${now}  ${app.name} container starting…`,
      `${now}  [INFO] using config from ${appDir(app.id)}`,
      `${now}  [INFO] listening on port ${app.webPort ?? app.ports[0]}`,
      `${now}  [INFO] healthcheck passed`,
      `${now}  [INFO] ${app.name} ready`,
    ].join("\n");
    return ok({ log });
  }

  const file = composeFile(app.id);
  if (await fileExists(file)) {
    const cmd = await composeCmd();
    const { stdout, stderr, code } = await run(
      `${cmd} -f "${file}" logs --tail 300 --no-color`,
      { timeoutMs: 30_000 }
    );
    if (code === 0) return ok({ log: stdout || stderr || "(로그가 없습니다.)" });
    // fall through to legacy docker logs on failure
  }

  const { stdout, stderr, code } = await run(`docker logs --tail 300 ${app.id}`, {
    timeoutMs: 30_000,
  });
  if (code === 0) return ok({ log: stdout || stderr || "(로그가 없습니다.)" });
  return fail(stderr.trim() || "로그를 가져오지 못했습니다.");
}

/** Read the on-disk docker-compose.yml for an app. */
async function composeGet(app: CatalogEntry): Promise<PackageActionResult> {
  if (USE_MOCK) {
    return ok({ yaml: await buildComposeYaml(app) });
  }

  const file = composeFile(app.id);
  try {
    const yaml = await fs.readFile(file, "utf8");
    return ok({ yaml });
  } catch {
    // No compose file yet — offer the generated template as a starting point.
    return ok({ yaml: await buildComposeYaml(app) });
  }
}

/** Write a new docker-compose.yml and re-apply it with `up -d`. */
async function composeSave(app: CatalogEntry, yaml: string): Promise<PackageActionResult> {
  if (!yaml.trim()) return fail("compose 내용이 비어 있습니다.");

  if (USE_MOCK) {
    mockState[app.id] = { installed: true, running: true };
    return ok();
  }

  const dir = appDir(app.id);
  const file = composeFile(app.id);

  const mk = await run(`mkdir -p "${dir}"`, { timeoutMs: 15_000 });
  if (mk.code !== 0) return fail(mk.stderr.trim() || "데이터 폴더 생성에 실패했습니다.");

  try {
    await fs.writeFile(file, yaml, "utf8");
  } catch (err) {
    return fail((err as Error).message || "compose 파일 저장에 실패했습니다.");
  }

  const cmd = await composeCmd();
  const { code, stderr } = await run(`${cmd} -f "${file}" up -d`, { timeoutMs: 300_000 });
  return code === 0 ? ok() : fail(stderr.trim() || "적용에 실패했습니다.");
}
