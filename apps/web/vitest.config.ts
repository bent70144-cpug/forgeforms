// T15 — vitest config for @formforge/web.
// tsconfig sets `jsx: "preserve"` for Next's build; vite 8's oxc transform
// can't run preserve, so component tests need explicit automatic JSX.
// Everything else stays default (node env, plain `*.test.ts` discovery).
// T05 adds the tsconfig `@/*` path alias so lib/ modules resolve in tests.

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
