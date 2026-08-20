import { describe, expect, it } from "vitest";

import { buildAclSpec, buildSetfaclArgs, normalizeAclPath, normalizePerms, parseGetfacl } from "./acl";

describe("acl — path normalisation", () => {
  it("accepts an absolute path and resolves it", () => {
    expect(normalizeAclPath("/srv/share/../share/photos")).toBe("/srv/share/photos");
  });

  it("rejects relative paths, NUL bytes and flag-looking values", () => {
    expect(normalizeAclPath("srv/share")).toBeNull();
    expect(normalizeAclPath("/srv/sh\0are")).toBeNull();
    expect(normalizeAclPath("--remove-all")).toBeNull();
    expect(normalizeAclPath("")).toBeNull();
  });
});

describe("acl — permission normalisation", () => {
  it("expands shorthand into a 3-char rwx string", () => {
    expect(normalizePerms("rw")).toBe("rw-");
    expect(normalizePerms("x")).toBe("--x");
    expect(normalizePerms("RWX")).toBe("rwx");
    expect(normalizePerms("r-x")).toBe("r-x");
  });

  it("treats an empty/dash value as no permissions", () => {
    expect(normalizePerms("")).toBe("---");
    expect(normalizePerms("---")).toBe("---");
  });

  it("rejects anything outside [rwx-]", () => {
    expect(normalizePerms("rws")).toBeNull();
    expect(normalizePerms("rwxr")).toBeNull();
    expect(normalizePerms("r;w")).toBeNull();
  });
});

describe("acl — setfacl spec construction", () => {
  it("builds a user entry with perms", () => {
    expect(buildAclSpec({ tag: "user", qualifier: "alice", isDefault: false }, "rwx")).toBe("user:alice:rwx");
  });

  it("prefixes default entries", () => {
    expect(buildAclSpec({ tag: "group", qualifier: "media", isDefault: true }, "r-x")).toBe("default:group:media:r-x");
  });

  it("omits perms for removal specs", () => {
    expect(buildAclSpec({ tag: "user", qualifier: "bob", isDefault: false }, null)).toBe("user:bob");
  });

  it("rejects a qualifier that could smuggle extra fields into the spec", () => {
    expect(buildAclSpec({ tag: "user", qualifier: "alice:rwx" }, "r--")).toBeNull();
    expect(buildAclSpec({ tag: "user", qualifier: "a,b" }, "r--")).toBeNull();
    expect(buildAclSpec({ tag: "user", qualifier: "../etc" }, "r--")).toBeNull();
  });

  it("rejects an unknown tag and a qualifier on mask/other", () => {
    expect(buildAclSpec({ tag: "root", qualifier: "" }, "rwx")).toBeNull();
    expect(buildAclSpec({ tag: "mask", qualifier: "alice" }, "rwx")).toBeNull();
  });
});

describe("acl — getfacl parsing", () => {
  const sample = [
    "# file: srv/share",
    "# owner: root",
    "# group: nimbo-users",
    "user::rwx",
    "user:alice:rwx",
    "group::r-x",
    "group:media:rwx\t\t#effective:r-x",
    "mask::r-x",
    "other::---",
    "default:user::rwx",
    "default:other::---",
    "",
  ].join("\n");

  it("extracts every access and default entry", () => {
    const entries = parseGetfacl(sample);
    expect(entries).toHaveLength(8);
    expect(entries[1]).toEqual({ tag: "user", qualifier: "alice", perms: "rwx", isDefault: false });
    expect(entries.filter((e) => e.isDefault)).toHaveLength(2);
  });

  it("ignores the #effective suffix and comment lines", () => {
    const media = parseGetfacl(sample).find((e) => e.qualifier === "media");
    expect(media?.perms).toBe("rwx");
  });
});

describe("acl — action to argv", () => {
  it("builds a recursive -m invocation", () => {
    expect(
      buildSetfaclArgs(
        { kind: "entry.set", path: "/srv/x", entry: { tag: "user", qualifier: "alice", perms: "rw", isDefault: false }, recursive: true },
        "/srv/x"
      )
    ).toEqual(["-R", "-m", "user:alice:rw-", "--", "/srv/x"]);
  });

  it("builds -x for removal and -b/-k for the clear actions", () => {
    expect(
      buildSetfaclArgs({ kind: "entry.remove", path: "/srv/x", entry: { tag: "group", qualifier: "media", isDefault: true } }, "/srv/x")
    ).toEqual(["-x", "default:group:media", "--", "/srv/x"]);
    expect(buildSetfaclArgs({ kind: "clear", path: "/srv/x" }, "/srv/x")).toEqual(["-b", "--", "/srv/x"]);
    expect(buildSetfaclArgs({ kind: "clear.default", path: "/srv/x" }, "/srv/x")).toEqual(["-k", "--", "/srv/x"]);
  });

  it("refuses to remove the mandatory base entries", () => {
    const res = buildSetfaclArgs(
      { kind: "entry.remove", path: "/srv/x", entry: { tag: "user", qualifier: "", isDefault: false } },
      "/srv/x"
    );
    expect(res).toHaveProperty("error");
  });
});
