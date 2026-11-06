import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      // Next.js regenerates this during `next build` with a triple-slash
      // reference to .next/types — generated file, gitignored, never linted.
      "**/next-env.d.ts",
      "**/dist/**",
      "**/coverage/**",
      "worktrees/**",
      "tool-results/**",
      "download/**",
      "upload/**",
      "skills/**",
      "agent/**",
      ".agents/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  ...tseslint.configs.recommended,
);
