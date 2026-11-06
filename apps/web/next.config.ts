import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TS source (exports point at src/*.ts) — Next must
  // transpile them (added by T03 for @formforge/core/identity + db repositories;
  // T21 adds blocks for the form-embed parent side + test harness).
  transpilePackages: ["@formforge/core", "@formforge/db", "@formforge/blocks"],
};

export default config;
