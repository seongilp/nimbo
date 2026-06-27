// Shared domain types for the NAS management UI.

export interface SystemOverview {
  hostname: string;
  platform: string;
  distro: string;
  kernel: string;
  uptimeSeconds: number;
  loadAvg: [number, number, number];
  cpu: CpuStat;
  memory: MemoryStat;
  swap: MemoryStat;
  network: NetworkStat;
  temperatureC: number | null;
  isMock: boolean;
}

export interface CpuStat {
  model: string;
  cores: number;
  usagePercent: number; // 0-100
}

export interface MemoryStat {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export interface NetworkStat {
  rxBytesPerSec: number;
  txBytesPerSec: number;
  interfaces: { name: string; rxBytes: number; txBytes: number }[];
}

export interface ProcessInfo {
  pid: number;
  user: string;
  command: string;
  cpuPercent: number;
  memPercent: number;
}

export interface DiskInfo {
  device: string; // /dev/sda
  model: string;
  sizeBytes: number;
  type: "hdd" | "ssd" | "nvme" | "unknown";
  temperatureC: number | null;
  smartStatus: "passed" | "warning" | "failed" | "unknown";
  partitions: PartitionInfo[];
}

export interface PartitionInfo {
  device: string; // /dev/sda1
  mountpoint: string | null;
  filesystem: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usePercent: number;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  sizeBytes: number;
  modified: number; // epoch ms
  permissions: string;
  owner: string;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  isMock: boolean;
}

export interface ShareInfo {
  name: string;
  path: string;
  protocol: "smb" | "nfs";
  readOnly: boolean;
  guestOk: boolean;
  enabled: boolean;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: "running" | "exited" | "paused" | "restarting" | "created" | "dead";
  status: string;
  ports: string[];
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  createdAt: number;
}

// ---- ZFS ----------------------------------------------------------------

export type ZfsHealth =
  | "ONLINE"
  | "DEGRADED"
  | "FAULTED"
  | "OFFLINE"
  | "UNAVAIL"
  | "REMOVED";

export type VdevType =
  | "disk"
  | "mirror"
  | "raidz1"
  | "raidz2"
  | "raidz3"
  | "spare"
  | "log"
  | "cache"
  | "special";

export interface Vdev {
  name: string;
  type: VdevType;
  state: ZfsHealth;
  readErrors: number;
  writeErrors: number;
  cksumErrors: number;
  sizeBytes?: number;
  children?: Vdev[];
}

export interface ScanStatus {
  state: "none" | "scrubbing" | "resilvering" | "finished" | "canceled";
  progressPercent: number;
  repairedBytes: number;
  errors: number;
  speedBytesPerSec: number;
  finishedAt: number | null;
}

export interface ZpoolInfo {
  name: string;
  health: ZfsHealth;
  sizeBytes: number;
  allocBytes: number;
  freeBytes: number;
  capacityPercent: number;
  fragPercent: number;
  dedupRatio: number;
  readErrors: number;
  writeErrors: number;
  cksumErrors: number;
  autotrim: boolean;
  scan: ScanStatus;
  vdevs: Vdev[];
}

export interface ZfsDataset {
  name: string;
  type: "filesystem" | "volume";
  usedBytes: number;
  availBytes: number;
  referBytes: number;
  mountpoint: string;
  compression: string;
  compressRatio: number;
  dedup: string;
  recordsize: string;
  quotaBytes: number | null;
  reservationBytes: number | null;
  atime: boolean;
  readonly: boolean;
  encrypted: boolean;
  snapshotCount: number;
}

export interface ZfsSnapshot {
  name: string; // pool/dataset@snap
  dataset: string;
  snap: string;
  usedBytes: number;
  referBytes: number;
  creation: number; // epoch ms
}

export interface ArcStats {
  sizeBytes: number;
  targetBytes: number;
  maxBytes: number;
  hits: number;
  misses: number;
  hitRatio: number;
  mfuBytes: number;
  mruBytes: number;
  l2SizeBytes: number | null;
}

export interface ZfsDevice {
  path: string; // stable id, e.g. /dev/disk/by-id/ata-...
  name: string; // short display name
  sizeBytes: number;
  model: string;
  inUse: boolean;
}

export type ScheduleInterval = "hourly" | "daily" | "weekly";

export interface SnapshotSchedule {
  id: string;
  dataset: string;
  interval: ScheduleInterval;
  keep: number;
  recursive: boolean;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number;
}

export interface ZfsOverview {
  available: boolean;
  pools: ZpoolInfo[];
  datasets: ZfsDataset[];
  snapshots: ZfsSnapshot[];
  arc: ArcStats | null;
  availableDevices: ZfsDevice[];
  schedules: SnapshotSchedule[];
  isMock: boolean;
}

// ---- Backup & Sync (rsync) ----------------------------------------------

export type SyncDirection = "pull" | "push";
export type SyncStatus = "idle" | "running" | "success" | "failed";
export type SyncSchedule = "manual" | "hourly" | "daily" | "weekly";

export interface RsyncJob {
  id: string;
  name: string;
  direction: SyncDirection; // pull = remote→local, push = local→remote
  remote: string; // user@host:/path or rsync://host/module
  localPath: string;
  archive: boolean;
  compress: boolean;
  deleteExtra: boolean;
  schedule: SyncSchedule;
  lastRun: number | null;
  lastStatus: SyncStatus;
  lastBytes: number;
  lastFiles: number;
  lastError?: string;
  lastLog?: string;
  history?: RunRecord[];
  nextRun: number | null;
}

export interface RsyncModule {
  name: string;
  path: string;
  readOnly: boolean;
  comment: string;
  hostsAllow: string;
}

export interface RsyncServer {
  enabled: boolean;
  port: number;
  modules: RsyncModule[];
  generatedConf: string;
}

export interface RunRecord {
  ts: number;
  status: SyncStatus;
  bytes: number;
  files: number;
  durationMs: number;
}

export interface BackupOverview {
  jobs: RsyncJob[];
  server: RsyncServer;
  rsyncAvailable: boolean;
  hostname: string;
  isMock: boolean;
}

// ---- Cloud sync (rclone) -------------------------------------------------

export type RcloneType =
  | "s3"
  | "drive"
  | "dropbox"
  | "b2"
  | "onedrive"
  | "sftp"
  | "gcs"
  | "mega"
  | "webdav";

export interface RcloneRemote {
  name: string;
  type: RcloneType;
  usedBytes: number | null;
  totalBytes: number | null;
}

export interface CloudJob {
  id: string;
  name: string;
  direction: SyncDirection; // pull = cloud→local, push = local→cloud
  remote: string; // remoteName:path
  localPath: string;
  operation: "sync" | "copy";
  schedule: SyncSchedule;
  lastRun: number | null;
  lastStatus: SyncStatus;
  lastBytes: number;
  lastFiles: number;
  lastError?: string;
  nextRun: number | null;
}

export interface CloudOverview {
  remotes: RcloneRemote[];
  jobs: CloudJob[];
  rcloneAvailable: boolean;
  isMock: boolean;
}

// ---- Time Machine (SMB/afp targets) --------------------------------------

export interface TimeMachineTarget {
  id: string;
  name: string;
  path: string;
  quotaBytes: number | null;
  usedBytes: number;
  enabled: boolean;
}

export interface TimeMachineOverview {
  enabled: boolean;
  targets: TimeMachineTarget[];
  generatedConf: string;
  hostname: string;
  isMock: boolean;
}

// ---- SSH credentials & keys ----------------------------------------------

export interface SshKey {
  name: string; // file name, e.g. id_ed25519
  type: string; // ed25519 / rsa
  bits: number;
  fingerprint: string;
  publicKey: string;
  comment: string;
}

export interface KnownHost {
  host: string;
  type: string;
}

export interface SshRemote {
  id: string;
  label: string;
  user: string;
  host: string;
  port: number;
  keyName: string;
  lastTested: number | null;
  reachable: boolean | null;
}

export interface SshOverview {
  keys: SshKey[];
  knownHosts: KnownHost[];
  remotes: SshRemote[];
  isMock: boolean;
}

// ---- Notifications (Slack / Telegram / Discord) --------------------------

export type NotifyChannel = "slack" | "telegram" | "discord" | "webhook";
export type NotifyLevel = "info" | "warning" | "critical";
export type NotifyEventType =
  | "pool.degraded"
  | "disk.health"
  | "scrub.finished"
  | "backup.failed"
  | "backup.success"
  | "container.down"
  | "cpu.high"
  | "storage.full"
  | "login";

export interface NotifyTarget {
  id: string;
  channel: NotifyChannel;
  label: string;
  webhookUrl: string; // Slack/Discord/webhook URL, or Telegram bot endpoint
  chatId: string; // Telegram chat id (unused for others)
  enabled: boolean;
}

export interface NotifyRule {
  event: NotifyEventType;
  enabled: boolean;
}

export interface NotifyEvent {
  id: string;
  ts: number;
  type: NotifyEventType;
  level: NotifyLevel;
  title: string;
  message: string;
  delivered: string[]; // labels of targets it was sent to
}

export interface NotifyOverview {
  targets: NotifyTarget[];
  rules: NotifyRule[];
  events: NotifyEvent[];
  isMock: boolean;
}

// ---- System administration (services / cron / logs) ----------------------

export interface ServiceUnit {
  name: string;
  description: string;
  active: "active" | "inactive" | "failed" | "activating";
  enabled: boolean;
  memoryBytes: number;
}

export interface CronJob {
  id: string;
  schedule: string; // cron expression
  command: string;
  user: string;
  enabled: boolean;
  comment: string;
}

export interface LogEntry {
  ts: number;
  unit: string;
  level: "info" | "warning" | "error" | "debug";
  message: string;
}

export interface SystemAdminOverview {
  services: ServiceUnit[];
  cron: CronJob[];
  logs: LogEntry[];
  isMock: boolean;
}

// ---- Host / time / network configuration ---------------------------------

export interface NetInterfaceConfig {
  name: string;
  mac: string;
  mode: "dhcp" | "static";
  ipv4: string;
  netmask: string;
  gateway: string;
  dns: string[];
  up: boolean;
  speedMbps: number;
}

export interface HostConfig {
  hostname: string;
  timezone: string;
  timezones: string[];
  ntpEnabled: boolean;
  ntpServer: string;
  datetimeIso: string;
  interfaces: NetInterfaceConfig[];
  isMock: boolean;
}

// ---- Users & groups ------------------------------------------------------

export interface SysUser {
  name: string;
  uid: number;
  gid: number;
  fullName: string;
  home: string;
  shell: string;
  groups: string[];
  disabled: boolean;
  isSystem: boolean;
}

export interface SysGroup {
  name: string;
  gid: number;
  members: string[];
  isSystem: boolean;
}

export interface UsersOverview {
  users: SysUser[];
  groups: SysGroup[];
  isMock: boolean;
}

// ---- Security: firewall / advisor / 2FA ----------------------------------

export interface FirewallRule {
  id: string;
  action: "allow" | "deny" | "reject";
  direction: "in" | "out";
  protocol: "tcp" | "udp" | "any";
  port: string;
  source: string;
  comment: string;
}

export interface FirewallState {
  enabled: boolean;
  defaultIncoming: "allow" | "deny";
  rules: FirewallRule[];
}

export interface SecurityCheck {
  id: string;
  title: string;
  severity: "ok" | "low" | "medium" | "high";
  passed: boolean;
  detail: string;
  recommendation: string;
}

export interface TwoFactorState {
  enabled: boolean;
  secret: string;
  otpauthUrl: string;
  verified: boolean;
}

export interface SecurityOverview {
  firewall: FirewallState;
  checks: SecurityCheck[];
  twoFactor: TwoFactorState;
  isMock: boolean;
}

// ---- Shared folders & file services --------------------------------------

export interface SharedFolder {
  name: string;
  path: string;
  description: string;
  smbEnabled: boolean;
  nfsEnabled: boolean;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string;
  usedBytes: number;
}

export interface FileServices {
  smb: boolean;
  nfs: boolean;
  afp: boolean;
}

export interface SharesAdminOverview {
  folders: SharedFolder[];
  services: FileServices;
  smbConf: string;
  exportsConf: string;
  isMock: boolean;
}

// ---- Package Center ------------------------------------------------------

export interface PackageApp {
  id: string;
  name: string;
  category: string;
  description: string;
  developer: string;
  image: string; // docker image
  ports: string[];
  installed: boolean;
  running: boolean;
}

export interface PackageOverview {
  catalog: PackageApp[];
  isMock: boolean;
}

// ---- HTTPS / TLS certificates --------------------------------------------

export interface TlsCert {
  id: string;
  domain: string;
  issuer: string;
  type: "letsencrypt" | "selfsigned" | "imported";
  notBefore: number;
  notAfter: number;
  isDefault: boolean;
  san: string[];
}

export interface HttpsConfig {
  enabled: boolean;
  httpPort: number;
  httpsPort: number;
  forceHttps: boolean;
  certs: TlsCert[];
  isMock: boolean;
}

// ---- UPS (NUT) & SNMP ----------------------------------------------------

export interface UpsStatus {
  connected: boolean;
  model: string;
  status: "online" | "onbattery" | "lowbattery" | "charging" | "offline";
  batteryPercent: number;
  loadPercent: number;
  runtimeSeconds: number;
  inputVoltage: number;
}

export interface SnmpConfig {
  enabled: boolean;
  version: "v2c" | "v3";
  community: string;
  location: string;
  contact: string;
  port: number;
}

export interface HardwareOverview {
  ups: UpsStatus;
  shutdownDelaySeconds: number;
  shutdownAtPercent: number;
  upsMode: "standalone" | "netserver" | "netclient";
  snmp: SnmpConfig;
  isMock: boolean;
}

// ---- Audit log -----------------------------------------------------------

export interface AuditEntry {
  id: string;
  ts: number;
  user: string;
  action: string;
  target: string;
  result: "success" | "failed";
  ip: string;
}

export interface AuditOverview {
  entries: AuditEntry[];
  isMock: boolean;
}

// ---- First-run setup -----------------------------------------------------

export interface SetupConfig {
  setupComplete: boolean;
  hostname: string;
  adminUser: string;
  port: number;
  httpsEnabled: boolean;
  dataPath: string;
  timezone: string;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  isMock?: boolean;
}
