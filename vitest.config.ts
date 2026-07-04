import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the pure, security-critical logic (IP allow-list, session
// tokens, client-IP parsing). Node environment; no DOM needed.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
