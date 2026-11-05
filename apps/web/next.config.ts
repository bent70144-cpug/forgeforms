import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TS source (exports point at src/*.ts) — Next must
  // transpile them (added by T03 for @formforge/core/identity + db repositories).
  transpilePackages: ["@formforge/core", "@formforge/db"],
};

export default config;
