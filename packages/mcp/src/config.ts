// packages/mcp/src/config.ts — CLI/env configuration for the stdio entrypoint.
export const API_TOKEN_ENV_VAR = "FORMFORGE_API_TOKEN";

/**
 * Resolves the FormForge API token: `--token <value>` / `--token=<value>`
 * takes precedence over the `FORMFORGE_API_TOKEN` environment variable.
 * Returns null when no token was provided (caller fails fast).
 */
export function readApiToken(argv: readonly string[], env: Record<string, string | undefined>): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--token") {
      const value = argv[i + 1];
      if (value !== undefined && value !== "") return value;
    }
    if (arg.startsWith("--token=")) {
      const value = arg.slice("--token=".length);
      if (value !== "") return value;
    }
  }
  const fromEnv = env[API_TOKEN_ENV_VAR];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : null;
}
