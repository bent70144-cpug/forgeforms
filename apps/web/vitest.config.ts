// T15 — vitest config for @formforge/web.
// tsconfig sets `jsx: "preserve"` for Next's build; vite 8's oxc transform
// can't run preserve, so component tests need explicit automatic JSX.
// Everything else stays default (node env, plain `*.test.ts` discovery).
//
// The `@/*` tsconfig path alias is mirrored here (T05) so route-handler tests
// and lib/ modules resolve (T07 route tests, session loader in _lib/auth).
// T20: `e2e/**` holds Playwright specs (CI-gated) — never run under vitest.

import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    // `*.spec.ts` under e2e/ belongs to Playwright (@playwright/test's
    // test.describe throws when run under Vitest) — keep them out of `pnpm test`.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
