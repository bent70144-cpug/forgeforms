// T15 — vitest config for @formforge/web.
// tsconfig sets `jsx: "preserve"` for Next's build; vite 8's oxc transform
// can't run preserve, so component tests need explicit automatic JSX.
// Everything else stays default (node env, plain `*.test.ts` discovery).

import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
});
