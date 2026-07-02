// Nimbo interactive terminal — a WebSocket <-> PTY bridge.
//
// Runs as its own tiny service (not inside the Next standalone server, which
// can't do WebSocket upgrades). A reverse proxy (Caddy) routes
// `/api/terminal/ws` here. Every connection is authenticated by verifying the
// same HMAC `nimbo_session` cookie the app issues and requires role=admin.
//
// The PTY inherits THIS process's user (the `nimbo` service account). Admins
// can escalate with `sudo` inside the shell (audited by sudo/journald).

const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const HOST = process.env.TERMINAL_HOST || "127.0.0.1";
const PORT = parseInt(process.env.TERMINAL_PORT || "3001", 10);
const SECRET = process.env.NIMBO_SECRET || "";
const SHELL = process.env.TERMINAL_SHELL || process.env.SHELL || "/bin/bash";
const WS_PATH = "/api/terminal/ws";
const PROD = process.env.NODE_ENV === "production";
const DEV_SECRET = "nimbo-dev-insecure-secret-change-me";
// CSWSH defense-in-depth: allow-list of acceptable Origins. Comma-separated
// hostnames or full origins (e.g. "nas.lan,https://nas.lan"). When unset we
// fall back to cookie auth only (backward compatible), but the shell is still
// gated by the HMAC session cookie below.
const ALLOWED_ORIGINS = (process.env.NIMBO_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function originAllowed(origin) {
  if (!ALLOWED_ORIGINS.length) return true; // not configured — rely on cookie auth
  if (!origin) return false; // configured but no Origin header → reject
  let host;
  try { host = new URL(origin).host.split(":")[0]; } catch { return false; }
  return ALLOWED_ORIGINS.some((a) => {
    const bare = a.replace(/^https?:\/\//, "").split(":")[0];
    return a === origin || bare === host;
  });
}

if (PROD && (!SECRET || SECRET === DEV_SECRET)) {
  console.error("[terminal] FATAL: NIMBO_SECRET unset/dev in production — refusing all connections.");
}

// ---- auth: verify the app's HMAC session token (mirror of src/lib/system/auth.ts) ----
function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function verifyToken(token) {
  if (PROD && (!SECRET || SECRET === DEV_SECRET)) return null;
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto
    .createHmac("sha256", SECRET || DEV_SECRET)
    .update(payload)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(b64urlToBuf(payload).toString());
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { u: data.u, r: data.r === "admin" ? "admin" : "user" };
  } catch {
    return null;
  }
}
function cookie(req, name) {
  const raw = req.headers.cookie || "";
  const hit = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
}

const server = http.createServer((_req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("Upgrade Required — WebSocket only");
});

const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on("connection", (ws, req) => {
  if (!originAllowed(req.headers.origin)) {
    ws.close(1008, "forbidden origin");
    return;
  }
  const session = verifyToken(cookie(req, "nimbo_session"));
  if (!session || session.r !== "admin") {
    ws.close(1008, "unauthorized");
    return;
  }

  // Open the shell AS the logged-in OS user. session.u comes from the
  // HMAC-signed cookie, so it is trustworthy; we still restrict it to a valid
  // username. The sidecar runs as the `nimbo` service account (passwordless
  // sudo), so `sudo -u <user> -i` gives that user's login shell. If the user is
  // unknown/invalid or is the service account itself, fall back to SHELL.
  const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
  const svcUser = os.userInfo().username;
  const asUser = session.u && USER_RE.test(session.u) && session.u !== svcUser ? session.u : null;
  const file = asUser ? "sudo" : SHELL;
  const args = asUser ? ["-n", "-u", asUser, "-i"] : ["-l"];

  // Don't hand the global session-signing key to the interactive shell.
  const { NIMBO_SECRET: _omit, ...childEnv } = process.env;
  const term = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: "/", // `sudo -i` cd's to the target user's home; "/" avoids EACCES otherwise
    env: { ...childEnv, TERM: "xterm-256color", NIMBO_TERMINAL: "1" },
  });
  console.log(`[terminal] ${session.u} opened pty ${term.pid} as ${asUser ?? svcUser}`);

  const onData = (d) => {
    if (ws.readyState === ws.OPEN) ws.send(d);
  };
  term.onData(onData);
  term.onExit(() => {
    try { ws.close(); } catch {}
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.t === "i" && typeof msg.d === "string") term.write(msg.d);
    else if (msg.t === "r" && Number.isInteger(msg.c) && Number.isInteger(msg.r)) {
      try { term.resize(Math.max(1, msg.c), Math.max(1, msg.r)); } catch {}
    }
  });
  ws.on("close", () => {
    try { term.kill(); } catch {}
    console.log(`[terminal] ${session.u} closed pty`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[terminal] PTY WebSocket bridge on ${HOST}:${PORT}${WS_PATH} (shell=${SHELL})`);
});
