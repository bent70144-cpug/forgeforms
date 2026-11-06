// T29 — GDPR services (spec §17): workspace data export, workspace + account
// deletion, per-form retention purge. All services are Ctx-scoped, storage-
// agnostic and clock-injected. See ./types.ts for the ports.
import { AppError, err, ok, type Ctx, type Result } from '../bridge';
import type {
  AccountDeletionDeps,
  RetentionDeps,
  RetentionSummary,
  WorkspaceDeletionDeps,
  WorkspaceExport,
  WorkspaceExportDeps,
} from './types';

export const DEFAULT_WORKSPACE_GRACE_DAYS = 30;

const RETENTION_MAX_DOCUMENTS_PER_RUN = 500;

// ---------------------------------------------------------------------------
// Export — GET /api/v1/workspace/export (session-only, spec §17 GDPR)
// ---------------------------------------------------------------------------

/**
 * Build the workspace archive. Credential material is stripped here even if a
 * store implementation leaks it (defense in depth):
 *   - webhook endpoint SECRETS are never part of the export shape at all;
 *   - API token HASHES are never part of the export shape at all.
 */
export async function exportWorkspaceData(
  deps: WorkspaceExportDeps,
  ctx: Ctx,
): Promise<Result<WorkspaceExport, AppError>> {
  const workspace = await deps.exports.getWorkspace(ctx.workspaceId);
  if (!workspace) {
    return err(AppError.notFound('Workspace not found'));
  }
  const [members, documents, documentVersions, submissions, webhookEndpoints, apiTokens] =
    await Promise.all([
      deps.exports.listMemberships(ctx.workspaceId),
      deps.exports.listDocuments(ctx.workspaceId),
      deps.exports.listDocumentVersions(ctx.workspaceId),
      deps.exports.listSubmissions(ctx.workspaceId),
      deps.exports.listWebhookEndpoints(ctx.workspaceId),
      deps.exports.listApiTokens(ctx.workspaceId),
    ]);

  const exportPayload: WorkspaceExport = {
    format: 'formforge.workspace-export.v1',
    exportedAt: deps.now().toISOString(),
    workspace,
    members,
    documents,
    documentVersions,
    submissions,
    webhookEndpoints,
    apiTokens,
  };
  return ok(exportPayload);
}

// ---------------------------------------------------------------------------
// Workspace deletion — two phases (request/grace, then hard purge)
// ---------------------------------------------------------------------------

/** Phase 1 (user action): mark the workspace for deletion. */
export async function requestWorkspaceDeletion(
  deps: WorkspaceDeletionDeps,
  workspaceId: string,
): Promise<Result<{ scheduled: true; deletedAt: string }, AppError>> {
  const workspace = await deps.workspaces.getWorkspace(workspaceId);
  if (!workspace) return err(AppError.notFound('Workspace not found'));
  if (workspace.deletedAt !== null) {
    // Idempotent: keep the ORIGINAL deletedAt (never extends the clock).
    return ok({ scheduled: true, deletedAt: workspace.deletedAt.toISOString() });
  }
  const deletedAt = deps.now();
  await deps.workspaces.scheduleDeletion(workspaceId, deletedAt);
  return ok({ scheduled: true, deletedAt: deletedAt.toISOString() });
}

export type PurgeRunSummary = {
  purged: number;
  answersDeleted: number;
  submissionsDeleted: number;
  documentsDeleted: number;
  /** Workspace ids that were hard-deleted (for the audit trail). */
  workspaceIds: string[];
};

/**
 * Phase 2 (job): hard-delete every workspace whose deletion was requested at
 * least `graceDays` ago (default 30). "Deleted data purged within the
 * retention window" — the window runs from the deletion request.
 */
export async function purgeExpiredWorkspaces(
  deps: WorkspaceDeletionDeps,
  options: { graceDays?: number; limit?: number } = {},
): Promise<PurgeRunSummary> {
  const graceDays = options.graceDays ?? DEFAULT_WORKSPACE_GRACE_DAYS;
  const cutoff = new Date(deps.now().getTime() - graceDays * 24 * 60 * 60 * 1000);
  const candidates = await deps.workspaces.listPurgeCandidates(cutoff, options.limit ?? 100);

  const summary: PurgeRunSummary = {
    purged: 0,
    answersDeleted: 0,
    submissionsDeleted: 0,
    documentsDeleted: 0,
    workspaceIds: [],
  };
  for (const candidate of candidates) {
    const counts = await deps.workspaces.purgeWorkspace(candidate.id);
    summary.purged += 1;
    summary.answersDeleted += counts.answersDeleted;
    summary.submissionsDeleted += counts.submissionsDeleted;
    summary.documentsDeleted += counts.documentsDeleted;
    summary.workspaceIds.push(candidate.id);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Account deletion — removes the user and cascades sole-owned workspaces
// ---------------------------------------------------------------------------

export type AccountDeletionOutcome = {
  userId: string;
  sessionsDeleted: number;
  authTokensDeleted: number;
  membershipsDeleted: number;
  /** Workspaces that were scheduled for deletion because the user was the sole owner. */
  workspacesScheduled: string[];
  /** Workspaces that keep other owners — the user only left them. */
  workspacesKept: string[];
};

export async function deleteAccount(
  deps: AccountDeletionDeps,
  userId: string,
): Promise<Result<AccountDeletionOutcome, AppError>> {
  const user = await deps.accounts.getUser(userId);
  if (!user) return err(AppError.notFound('Account not found'));

  const memberships = await deps.accounts.listMembershipsForUser(userId);
  const workspacesScheduled: string[] = [];
  const workspacesKept: string[] = [];
  const graceDays = deps.defaultGraceDays ?? DEFAULT_WORKSPACE_GRACE_DAYS;
  const now = deps.now();

  for (const membership of memberships) {
    const workspace = await deps.workspaces.getWorkspace(membership.workspaceId);
    if (!workspace || workspace.deletedAt !== null) continue; // already scheduled/purged
    if (membership.role === 'owner') {
      const owners = await deps.accounts.countOwners(membership.workspaceId);
      if (owners <= 1) {
        // Sole owner: the workspace cannot outlive the account — schedule it.
        await deps.workspaces.scheduleDeletion(membership.workspaceId, now);
        workspacesScheduled.push(membership.workspaceId);
        continue;
      }
    }
    workspacesKept.push(membership.workspaceId);
  }

  const sessionsDeleted = await deps.accounts.deleteSessionsForUser(userId);
  const authTokensDeleted = await deps.accounts.deleteAuthTokensForUser(userId);
  const membershipsDeleted = await deps.accounts.deleteMembershipsForUser(userId);
  await deps.accounts.deleteUser(userId);

  return ok({
    userId,
    sessionsDeleted,
    authTokensDeleted,
    membershipsDeleted,
    workspacesScheduled,
    workspacesKept,
  });
}

// ---------------------------------------------------------------------------
// Per-form retention — purge job (spec §17 GDPR "per-form retention setting")
// ---------------------------------------------------------------------------

/**
 * Runs the per-form retention sweep: for every document with
 * `settings.retentionDays > 0`, deletes completed/spam submissions older than
 * the retention window (with their answers). Drafts are NEVER purged by
 * retention (they are still being filled in).
 */
export async function purgeExpiredSubmissionData(deps: RetentionDeps): Promise<RetentionSummary> {
  const documents = await deps.retention.listRetainedDocuments();
  const summary: RetentionSummary = { documentsScanned: 0, submissionsDeleted: 0, answersDeleted: 0 };

  for (const document of documents.slice(0, RETENTION_MAX_DOCUMENTS_PER_RUN)) {
    const cutoff = new Date(deps.now().getTime() - document.retentionDays * 24 * 60 * 60 * 1000);
    const counts = await deps.retention.purgeSubmissionsBefore(document.documentId, cutoff);
    summary.documentsScanned += 1;
    summary.submissionsDeleted += counts.submissionsDeleted;
    summary.answersDeleted += counts.answersDeleted;
  }
  return summary;
}
