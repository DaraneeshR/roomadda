import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Node-environment tests for the BFF route handlers and server libs. `server-only`
 * is aliased to a no-op so those server modules import cleanly outside Next.
 */
export default defineConfig({
  // Server components under test don't import React; use the automatic JSX runtime.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./__tests__/stubs/server-only.ts", import.meta.url)),
    },
  },
});
