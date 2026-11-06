// T29 — GDPR module public interface (spec §3: consumers import only this).
export type {
  AccountDeletionDeps,
  AccountDeletionStore,
  ExportedAnswer,
  ExportedApiToken,
  ExportedDocument,
  ExportedDocumentVersion,
  ExportedMembership,
  ExportedSubmission,
  ExportedWebhookEndpoint,
  ExportedWorkspace,
  RetentionDeps,
  RetentionStore,
  RetentionSummary,
  WorkspaceDeletionDeps,
  WorkspaceExport,
  WorkspaceExportDeps,
  WorkspaceExportStore,
  WorkspaceLifecycleRow,
  WorkspaceLifecycleStore,
} from './types';
export {
  DEFAULT_WORKSPACE_GRACE_DAYS,
  deleteAccount,
  exportWorkspaceData,
  purgeExpiredSubmissionData,
  purgeExpiredWorkspaces,
  requestWorkspaceDeletion,
  type AccountDeletionOutcome,
  type PurgeRunSummary,
} from './service';
export { createInMemoryGdprStores } from './testing';
