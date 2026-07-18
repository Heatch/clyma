import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "lib/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      exclude: ["app/layout.tsx", "next-env.d.ts"],
    },
  },
  resolve: {
    alias: {
      // fileURLToPath decodes the file URL so the alias still resolves when the
      // project path contains spaces (e.g. ".../Climate Market/..."), which a
      // raw URL .pathname would leave percent-encoded as "%20".
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
})
