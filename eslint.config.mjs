import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
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
  ...tseslint.configs.recommended,
);
