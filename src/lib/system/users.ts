import { readFile } from "node:fs/promises";

import type { SysGroup, SysUser, UsersOverview } from "@/lib/types";
import { run, runArgs, shq as sq, USE_MOCK } from "./exec";

// --------------------------------------------------------------------------
// Validation & shell escaping
// --------------------------------------------------------------------------
const NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const NOLOGIN_SHELLS = ["/usr/sbin/nologin", "/sbin/nologin", "/bin/false", "/usr/bin/false"];
const LOGIN_SHELL = "/bin/bash";
const NOLOGIN_SHELL = "/usr/sbin/nologin";

function validName(name: string): boolean {
  return NAME_RE.test(name);
}

function ok() {
  return { ok: true as const };
}
function fail(error: string) {
  return { ok: false as const, error };
}

// --------------------------------------------------------------------------
// Mock state (mutable)
// --------------------------------------------------------------------------
interface State {
  users: SysUser[];
  groups: SysGroup[];
}

const state: State = {
  users: [
    { name: "root", uid: 0, gid: 0, fullName: "root", home: "/root", shell: "/bin/bash", groups: ["root"], disabled: false, isSystem: true },
    { name: "daemon", uid: 1, gid: 1, fullName: "daemon", home: "/usr/sbin", shell: "/usr/sbin/nologin", groups: ["daemon"], disabled: true, isSystem: true },
    { name: "admin", uid: 1000, gid: 100, fullName: "관리자", home: "/home/admin", shell: "/bin/bash", groups: ["users", "sudo", "docker"], disabled: false, isSystem: false },
    { name: "media", uid: 1001, gid: 1001, fullName: "미디어 서비스", home: "/home/media", shell: "/bin/bash", groups: ["users", "media"], disabled: false, isSystem: false },
    { name: "plex", uid: 1002, gid: 1001, fullName: "Plex 서버", home: "/home/plex", shell: "/usr/sbin/nologin", groups: ["media"], disabled: true, isSystem: false },
    { name: "backup", uid: 1003, gid: 34, fullName: "백업 서비스", home: "/home/backup", shell: "/bin/bash", groups: ["backup"], disabled: false, isSystem: false },
    { name: "guest", uid: 1004, gid: 100, fullName: "게스트", home: "/home/guest", shell: "/usr/sbin/nologin", groups: ["users"], disabled: true, isSystem: false },
  ],
  groups: [
    { name: "users", gid: 100, members: ["media", "guest"], isSystem: false },
    { name: "sudo", gid: 27, members: ["admin"], isSystem: true },
    { name: "docker", gid: 998, members: ["admin"], isSystem: false },
    { name: "backup", gid: 34, members: [], isSystem: true },
    { name: "media", gid: 1001, members: ["media", "plex"], isSystem: false },
    { name: "nas-admins", gid: 1002, members: ["admin"], isSystem: false },
  ],
};

function snapshot(): UsersOverview {
  return {
    users: state.users.map((u) => ({ ...u, groups: [...u.groups] })),
    groups: state.groups.map((g) => ({ ...g, members: [...g.members] })),
    isMock: true,
  };
}

// --------------------------------------------------------------------------
// Real-mode parsing
// --------------------------------------------------------------------------
function isSystemUid(uid: number): boolean {
  // root (0) and any uid below 1000 are treated as system accounts.
  return uid < 1000;
}

function isNologin(shell: string): boolean {
  return NOLOGIN_SHELLS.includes(shell.trim()) || shell.trim() === "";
}

interface RawGroup {
  name: string;
  gid: number;
  members: string[];
}

function parseGroups(output: string): RawGroup[] {
  const groups: RawGroup[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split(":");
    if (parts.length < 3) continue;
    const name = parts[0];
    const gid = Number(parts[2]);
    if (!name || Number.isNaN(gid)) continue;
    const members = (parts[3] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    groups.push({ name, gid, members });
  }
  return groups;
}

function parsePasswd(output: string, rawGroups: RawGroup[]): SysUser[] {
  const gidToName = new Map<number, string>();
  for (const g of rawGroups) gidToName.set(g.gid, g.name);

  const memberOf = new Map<string, Set<string>>(); // user -> secondary group names
  for (const g of rawGroups) {
    for (const m of g.members) {
      if (!memberOf.has(m)) memberOf.set(m, new Set());
      memberOf.get(m)!.add(g.name);
    }
  }

  const users: SysUser[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split(":");
    if (parts.length < 7) continue;
    const name = parts[0];
    const uid = Number(parts[2]);
    const gid = Number(parts[3]);
    if (!name || Number.isNaN(uid) || Number.isNaN(gid)) continue;
    const gecos = (parts[4] ?? "").split(",")[0] ?? "";
    const home = parts[5] ?? "";
    const shell = parts[6] ?? "";

    const groupSet = new Set<string>();
    const primary = gidToName.get(gid);
    if (primary) groupSet.add(primary);
    for (const g of memberOf.get(name) ?? []) groupSet.add(g);

    users.push({
      name,
      uid,
      gid,
      fullName: gecos || name,
      home,
      shell,
      groups: [...groupSet],
      disabled: isNologin(shell),
      isSystem: isSystemUid(uid),
    });
  }
  return users;
}

async function readReal(): Promise<UsersOverview> {
  // getent first; fall back to reading the files directly.
  let passwdOut = "";
  let groupOut = "";

  const passwdRes = await run("getent passwd");
  passwdOut = passwdRes.code === 0 && passwdRes.stdout.trim() ? passwdRes.stdout : "";
  if (!passwdOut) {
    try {
      passwdOut = await readFile("/etc/passwd", "utf8");
    } catch {
      passwdOut = "";
    }
  }

  const groupRes = await run("getent group");
  groupOut = groupRes.code === 0 && groupRes.stdout.trim() ? groupRes.stdout : "";
  if (!groupOut) {
    try {
      groupOut = await readFile("/etc/group", "utf8");
    } catch {
      groupOut = "";
    }
  }

  const rawGroups = parseGroups(groupOut);
  const users = parsePasswd(passwdOut, rawGroups);
  const groups: SysGroup[] = rawGroups.map((g) => ({
    name: g.name,
    gid: g.gid,
    members: g.members,
    isSystem: g.gid < 1000,
  }));

  return { users, groups, isMock: false };
}

export async function getUsersOverview(): Promise<UsersOverview> {
  if (USE_MOCK) return snapshot();
  try {
    return await readReal();
  } catch {
    // Best-effort: never throw, fall back to an empty real view.
    return { users: [], groups: [], isMock: false };
  }
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------
export type UserAction =
  | { kind: "user.create"; name: string; fullName?: string; password?: string; groups?: string[] }
  | { kind: "user.delete"; name: string }
  | { kind: "user.setPassword"; name: string; password: string }
  | { kind: "user.setGroups"; name: string; groups: string[] }
  | { kind: "user.toggleDisabled"; name: string; disabled: boolean }
  | { kind: "group.create"; name: string }
  | { kind: "group.delete"; name: string };

type ActionResult = { ok: boolean; error?: string };

const PRIV_ERROR = "권한이 부족합니다. root 권한이 필요합니다.";

function privFail(stderr: string): ActionResult {
  const msg = stderr.trim();
  return fail(msg ? `${msg} — ${PRIV_ERROR}` : PRIV_ERROR);
}

export async function runUserAction(a: UserAction): Promise<ActionResult> {
  switch (a.kind) {
    case "user.create":
      return createUser(a);
    case "user.delete":
      return deleteUser(a.name);
    case "user.setPassword":
      return setPassword(a.name, a.password);
    case "user.setGroups":
      return setGroups(a.name, a.groups);
    case "user.toggleDisabled":
      return toggleDisabled(a.name, a.disabled);
    case "group.create":
      return createGroup(a.name);
    case "group.delete":
      return deleteGroup(a.name);
    default:
      return fail("알 수 없는 작업입니다.");
  }
}

async function createUser(a: Extract<UserAction, { kind: "user.create" }>): Promise<ActionResult> {
  if (!validName(a.name)) return fail("잘못된 사용자 이름입니다.");
  const fullName = a.fullName ?? "";
  const password = a.password ?? "";
  const groups = (a.groups ?? []).filter((g) => validName(g));

  if (USE_MOCK) {
    if (state.users.some((u) => u.name === a.name)) return fail("이미 존재하는 사용자입니다.");
    const uid = Math.max(1000, ...state.users.map((u) => u.uid)) + 1;
    const usersGroup = state.groups.find((g) => g.name === "users");
    const gid = usersGroup ? usersGroup.gid : 100;
    const groupList = [...new Set(["users", ...groups])];
    state.users.push({
      name: a.name,
      uid,
      gid,
      fullName: fullName || a.name,
      home: `/home/${a.name}`,
      shell: LOGIN_SHELL,
      groups: groupList,
      disabled: false,
      isSystem: false,
    });
    for (const gName of groups) {
      const g = state.groups.find((x) => x.name === gName);
      if (g && !g.members.includes(a.name)) g.members = [...g.members, a.name];
    }
    return ok();
  }

  const create = await run(`useradd -m -c ${sq(fullName)} -s ${sq(LOGIN_SHELL)} ${sq(a.name)}`, { timeoutMs: 15000 });
  if (create.code !== 0) return privFail(create.stderr);

  if (password) {
    if (/[\r\n\0]/.test(password)) return fail("비밀번호에 줄바꿈 문자를 포함할 수 없습니다.");
    // Feed `user:password` to chpasswd over stdin so a newline in the password
    // can never inject an extra account record (e.g. root:attacker).
    const pw = await runArgs("chpasswd", [], { input: `${a.name}:${password}\n`, timeoutMs: 15000 });
    if (pw.code !== 0) return privFail(pw.stderr);
  }
  if (groups.length > 0) {
    const ug = await run(`usermod -aG ${sq(groups.join(","))} ${sq(a.name)}`, { timeoutMs: 15000 });
    if (ug.code !== 0) return privFail(ug.stderr);
  }
  return ok();
}

async function deleteUser(name: string): Promise<ActionResult> {
  if (!validName(name)) return fail("잘못된 사용자 이름입니다.");
  if (USE_MOCK) {
    const target = state.users.find((u) => u.name === name);
    if (!target) return fail("사용자를 찾을 수 없습니다.");
    if (target.isSystem || target.uid === 0) return fail("시스템 사용자는 삭제할 수 없습니다.");
    state.users = state.users.filter((u) => u.name !== name);
    state.groups = state.groups.map((g) => ({ ...g, members: g.members.filter((m) => m !== name) }));
    return ok();
  }
  const res = await run(`userdel -r ${sq(name)}`, { timeoutMs: 15000 });
  if (res.code !== 0) return privFail(res.stderr);
  return ok();
}

async function setPassword(name: string, password: string): Promise<ActionResult> {
  if (!validName(name)) return fail("잘못된 사용자 이름입니다.");
  if (!password) return fail("비밀번호를 입력하세요.");
  if (/[\r\n\0]/.test(password)) return fail("비밀번호에 줄바꿈 문자를 포함할 수 없습니다.");
  if (USE_MOCK) {
    if (!state.users.some((u) => u.name === name)) return fail("사용자를 찾을 수 없습니다.");
    return ok();
  }
  const res = await runArgs("chpasswd", [], { input: `${name}:${password}\n`, timeoutMs: 15000 });
  if (res.code !== 0) return privFail(res.stderr);
  return ok();
}

async function setGroups(name: string, groups: string[]): Promise<ActionResult> {
  if (!validName(name)) return fail("잘못된 사용자 이름입니다.");
  const valid = groups.filter((g) => validName(g));
  if (USE_MOCK) {
    const user = state.users.find((u) => u.name === name);
    if (!user) return fail("사용자를 찾을 수 없습니다.");
    user.groups = [...new Set(valid)];
    state.groups = state.groups.map((g) => ({
      ...g,
      members: valid.includes(g.name)
        ? [...new Set([...g.members, name])]
        : g.members.filter((m) => m !== name),
    }));
    return ok();
  }
  const res = await run(`usermod -G ${sq(valid.join(","))} ${sq(name)}`, { timeoutMs: 15000 });
  if (res.code !== 0) return privFail(res.stderr);
  return ok();
}

async function toggleDisabled(name: string, disabled: boolean): Promise<ActionResult> {
  if (!validName(name)) return fail("잘못된 사용자 이름입니다.");
  if (USE_MOCK) {
    const user = state.users.find((u) => u.name === name);
    if (!user) return fail("사용자를 찾을 수 없습니다.");
    if (user.isSystem || user.uid === 0) return fail("시스템 사용자는 변경할 수 없습니다.");
    user.disabled = disabled;
    user.shell = disabled ? NOLOGIN_SHELL : LOGIN_SHELL;
    return ok();
  }
  const shell = disabled ? NOLOGIN_SHELL : LOGIN_SHELL;
  const res = await run(`usermod -s ${sq(shell)} ${sq(name)}`, { timeoutMs: 15000 });
  if (res.code !== 0) return privFail(res.stderr);
  return ok();
}

async function createGroup(name: string): Promise<ActionResult> {
  if (!validName(name)) return fail("잘못된 그룹 이름입니다.");
  if (USE_MOCK) {
    if (state.groups.some((g) => g.name === name)) return fail("이미 존재하는 그룹입니다.");
    const gid = Math.max(1000, ...state.groups.map((g) => g.gid)) + 1;
    state.groups.push({ name, gid, members: [], isSystem: false });
    return ok();
  }
  const res = await run(`groupadd ${sq(name)}`, { timeoutMs: 15000 });
  if (res.code !== 0) return privFail(res.stderr);
  return ok();
}

async function deleteGroup(name: string): Promise<ActionResult> {
  if (!validName(name)) return fail("잘못된 그룹 이름입니다.");
  if (USE_MOCK) {
    const target = state.groups.find((g) => g.name === name);
    if (!target) return fail("그룹을 찾을 수 없습니다.");
    if (target.isSystem) return fail("시스템 그룹은 삭제할 수 없습니다.");
    state.groups = state.groups.filter((g) => g.name !== name);
    state.users = state.users.map((u) => ({ ...u, groups: u.groups.filter((g) => g !== name) }));
    return ok();
  }
  const res = await run(`groupdel ${sq(name)}`, { timeoutMs: 15000 });
  if (res.code !== 0) return privFail(res.stderr);
  return ok();
}
