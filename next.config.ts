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
  // A runtime-dynamic readFile path (zfs.ts schedules file, derived from an env
  // var) is not statically analyzable, so NFT conservatively traces the whole
  // repo — shipping raw TS source, deploy/ scripts, and internal *.md into the
  // standalone runtime dir. None of that is needed at runtime; exclude it so the
  // deployed bundle carries only real server dependencies.
  outputFileTracingExcludes: {
    "*": [
      "./src/**",
      "./docs/**",
      "./deploy/**",
      "./.github/**",
      "./*.md",
      "./package-lock.json",
      "./node_modules/typescript/**",
      "./node_modules/@types/**",
    ],
  },
};

export default nextConfig;
