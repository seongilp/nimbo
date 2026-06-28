import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean self-contained server bundle for native (systemd) deployment.
  // Produces .next/standalone/server.js which the systemd unit runs directly.
  output: "standalone",
  // Pin the file-tracing root to this project. Without it, Next walks up to the
  // outermost lockfile/workspace file (e.g. a global ~/pnpm-workspace.yaml on a
  // dev machine) and nests the standalone under that relative path, so
  // server.js ends up at .next/standalone/<deep/path>/server.js instead of the
  // root. Pinning keeps the layout flat and identical on every build host.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
