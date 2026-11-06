// T15 — vitest config for @formforge/web.
// tsconfig sets `jsx: "preserve"` for Next's build; vite 8's oxc transform
// can't run preserve, so component tests need explicit automatic JSX.
// Everything else stays default (node env, plain `*.test.ts` discovery).
//
// The `@/*` tsconfig path alias is mirrored here so route-handler tests can
// import `@/lib/...` modules (T07 route tests, T07 session loader in _lib/auth).

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  // Playwright specs (apps/web/e2e, written for CI; not runnable in the unit
  // sandbox — no @playwright/test dependency) must not be picked up here.
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "e2e/**"],
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
