// T29 (spec §17 GDPR) — maintenance queue: `purge-retention` job.
//
// Runs BOTH GDPR sweeps:
//   1. per-form retention — completed/spam submissions older than each
//      document's `settings.retentionDays` are deleted with their answers;
//   2. workspace hard-purge — workspaces whose deletion was requested more
//      than the grace window ago are erased (documents, versions, snapshots,
//      submissions + answers, webhooks, tokens, memberships, exports, row).
//
// Scheduling: enqueue on the `maintenance` queue from a cron/Repeat (see
// docs/security-checklist.md — "every day at 04:00 UTC" is the reference
// cadence). The job is idempotent: re-running purges nothing new.
//
// NOTE (maintenance plane): the sweeps run cross-workspace by definition —
// the gdpr stores must be constructed over a connection whose DB role may
// touch every tenant (table owner), OR each store call is wrapped in a
// `set local app.workspace_id` transaction by the container. See
// packages/db/src/repositories/gdpr.ts header.
import { AppError, err, ok, type Result } from "@formforge/core";;
import { purgeExpiredSubmissionData, purgeExpiredWorkspaces, DEFAULT_WORKSPACE_GRACE_DAYS } from "@formforge/core/gdpr";
import type { Logger } from "../logger";

export type RetentionPurgeSummary = {
  retention: { documentsScanned: number; submissionsDeleted: number; answersDeleted: number };
  workspaces: { purged: number; answersDeleted: number; submissionsDeleted: number; documentsDeleted: number };
};

export type GdprStoresPort = {
  retention: Parameters<typeof purgeExpiredSubmissionData>[0]["retention"];
  workspaces: Parameters<typeof purgeExpiredWorkspaces>[0]["workspaces"];
  /** Grace window (days) for hard-purging scheduled workspaces. */
  workspaceGraceDays?: number;
};

/** Narrow structural dep set (WorkerDeps satisfies it; tests pass fakes). */
export type RetentionPurgeDeps = {
  /** Injected clock (WorkerDeps carries one; tests may omit → system clock). */
  clock?: { now: () => Date };
  logger: Logger;
  gdpr?: GdprStoresPort;
};

export async function processRetentionPurge(
  deps: RetentionPurgeDeps,
  _jobId: string | undefined,
  _data: unknown,
): Promise<Result<RetentionPurgeSummary, AppError>> {
  const gdpr = deps.gdpr;
  if (!gdpr) {
    return err(
      new AppError("INTERNAL", "gdpr stores not wired: set DATABASE_URL or inject deps.gdpr (INTEGRATION-DEBT)"),
    );
  }
  const nowMs = () => (deps.clock ? deps.clock.now() : new Date());

  const retention = await purgeExpiredSubmissionData({ retention: gdpr.retention, now: nowMs });
  const workspaces = await purgeExpiredWorkspaces(
    { workspaces: gdpr.workspaces, now: nowMs },
    { graceDays: gdpr.workspaceGraceDays ?? DEFAULT_WORKSPACE_GRACE_DAYS },
  );

  deps.logger.info("gdpr.purge-run", {
    retentionDocumentsScanned: retention.documentsScanned,
    retentionSubmissionsDeleted: retention.submissionsDeleted,
    retentionAnswersDeleted: retention.answersDeleted,
    workspacesPurged: workspaces.purged,
    workspaceSubmissionsDeleted: workspaces.submissionsDeleted,
    requestId: "maintenance:gdpr",
  });

  return ok({ retention, workspaces });
}
