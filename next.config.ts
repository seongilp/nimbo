import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lean self-contained server bundle for native (systemd) deployment.
  // Produces .next/standalone/server.js which the systemd unit runs directly.
  output: "standalone",
};

export default nextConfig;
