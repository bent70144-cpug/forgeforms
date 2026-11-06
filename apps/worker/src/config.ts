// Worker configuration — hand-rolled env parsing (zero new deps). Values are
// only ever read here, never inside job logic (which receives WorkerDeps).
export type WorkerConfig = {
  redisUrl: string;
  appUrl: string;
  /** e.g. "FormForge <notifications@formforge.dev>" — default from for all emails. */
  mailFrom: string;
  /** When absent the console (dev) mailer is used. */
  resendApiKey: string | null;
  logLevel: "debug" | "info" | "warn" | "error";
  concurrency: number;
  /** T29 (spec §17 GDPR): set → the retention/workspace purge stores wire up. */
  databaseUrl: string | null;
  /** T18 (issue #30): HMAC secret for signed CSV export links (EXPORT_SIGNING_SECRET / SESSION_SECRET). */
  exportSigningSecret: string | null;
};

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const logLevel = env.LOG_LEVEL;
  return {
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    appUrl: env.PUBLIC_BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    mailFrom: env.MAIL_FROM ?? "FormForge <notifications@formforge.dev>",
    resendApiKey: env.RESEND_API_KEY ?? null,
    databaseUrl: env.DATABASE_URL ?? null,
    exportSigningSecret: env.EXPORT_SIGNING_SECRET ?? env.SESSION_SECRET ?? null,
    logLevel:
      logLevel === "debug" || logLevel === "info" || logLevel === "warn" || logLevel === "error"
        ? logLevel
        : "info",
    concurrency: parsePositiveInt(env.WORKER_CONCURRENCY, 5),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Absolute URL of the results screen for a document (used in notification emails). */
export function resultsUrlFor(appUrl: string, documentId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/documents/${documentId}/submissions`;
}
