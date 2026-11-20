import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Wallet adapters, account subscriptions, and local-storage hydration are
    // external systems whose state is intentionally synchronized in effects.
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "node_modules/**",
    "target/**",
    ".anchor/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
])
