// T29 — GDPR ports (spec §17: "workspace data export, workspace and account
// deletion, per-form retention setting"). Storage-agnostic contracts; SQL
// implementations live in @formforge/db, fakes in this package's tests.
import type { Ctx } from '../bridge';

// ---------------------------------------------------------------------------
// Export (right of access / data portability)
// ---------------------------------------------------------------------------

export type ExportedWorkspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date | null;
};

export type ExportedMembership = {
  userId: string;
  role: string;
  createdAt: Date | null;
};

export type ExportedDocument = {
  id: string;
  type: string;
  title: string;
  slug: string;
  status: string;
  draft: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type ExportedDocumentVersion = {
  id: string;
  documentId: string;
  schemaVersion: number;
  /** Full version body — the user's own content, included verbatim. */
  body: unknown;
  createdAt: Date | null;
};

export type ExportedAnswer = { blockId: string; value: unknown };

export type ExportedSubmission = {
  id: string;
  documentId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  variables: unknown;
  hidden: unknown;
  meta: unknown;
  answers: ExportedAnswer[];
};

export type ExportedWebhookEndpoint = {
  id: string;
  documentId: string | null;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: Date | null;
};

export type ExportedApiToken = {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date | null;
};

/** The full workspace archive (GDPR data export). */
export type WorkspaceExport = {
  format: 'formforge.workspace-export.v1';
  exportedAt: string;
  workspace: ExportedWorkspace;
  members: ExportedMembership[];
  documents: ExportedDocument[];
  documentVersions: ExportedDocumentVersion[];
  submissions: ExportedSubmission[];
  webhookEndpoints: ExportedWebhookEndpoint[];
  apiTokens: ExportedApiToken[];
};

/**
 * Read side of the export. Implementations MUST scope every query to the
 * workspace and MUST NOT include credential material (webhook secrets, API
 * token hashes) — the service redacts defensively as well.
 */
export interface WorkspaceExportStore {
  getWorkspace(workspaceId: string): Promise<ExportedWorkspace | null>;
  listMemberships(workspaceId: string): Promise<ExportedMembership[]>;
  listDocuments(workspaceId: string): Promise<ExportedDocument[]>;
  listDocumentVersions(workspaceId: string): Promise<ExportedDocumentVersion[]>;
  /** Submissions WITH their answers (nested). */
  listSubmissions(workspaceId: string): Promise<ExportedSubmission[]>;
  listWebhookEndpoints(workspaceId: string): Promise<ExportedWebhookEndpoint[]>;
  listApiTokens(workspaceId: string): Promise<ExportedApiToken[]>;
}

// ---------------------------------------------------------------------------
// Deletion (right to erasure) — workspace + account
// ---------------------------------------------------------------------------

export type WorkspaceLifecycleRow = {
  id: string;
  slug: string;
  /** Set when deletion was REQUESTED; the hard purge happens after the grace window. */
  deletedAt: Date | null;
};

export interface WorkspaceLifecycleStore {
  getWorkspace(workspaceId: string): Promise<WorkspaceLifecycleRow | null>;
  /** Mark deletion requested (soft phase). Idempotent; keeps the first deletedAt. */
  scheduleDeletion(workspaceId: string, deletedAt: Date): Promise<boolean>;
  /** Workspaces whose deletedAt + grace elapsed — hard-purge candidates. */
  listPurgeCandidates(cutoff: Date, limit: number): Promise<WorkspaceLifecycleRow[]>;
  /**
   * Hard delete EVERYTHING owned by the workspace (submissions, answers,
   * documents + versions + snapshots, webhooks, tokens, memberships, exports)
   * and the workspace row itself. Returns counters for the audit log.
   */
  purgeWorkspace(workspaceId: string): Promise<{
    answersDeleted: number;
    submissionsDeleted: number;
    documentsDeleted: number;
  }>;
}

export interface AccountDeletionStore {
  getUser(userId: string): Promise<{ id: string; email: string; createdAt: Date | null } | null>;
  /** Workspaces the user belongs to, with the workspace's lifecycle state. */
  listMembershipsForUser(userId: string): Promise<Array<{ workspaceId: string; role: string }>>;
  /** Number of owner-role members of a workspace (is the user the sole owner?). */
  countOwners(workspaceId: string): Promise<number>;
  deleteSessionsForUser(userId: string): Promise<number>;
  deleteAuthTokensForUser(userId: string): Promise<number>;
  deleteMembershipsForUser(userId: string): Promise<number>;
  /** Deletes the user row (auth_tokens/password reference must already be gone). */
  deleteUser(userId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Retention (per-form)
// ---------------------------------------------------------------------------

export interface RetentionStore {
  /** Documents that set settings.retentionDays > 0: { documentId, workspaceId, retentionDays }. */
  listRetainedDocuments(): Promise<Array<{ documentId: string; workspaceId: string; retentionDays: number }>>;
  /**
   * Hard delete completed/spam submissions of `documentId` completed (or
   * started, when never completed) before `cutoff`, with their answers.
   */
  purgeSubmissionsBefore(documentId: string, cutoff: Date): Promise<{ submissionsDeleted: number; answersDeleted: number }>;
}

export type RetentionSummary = {
  documentsScanned: number;
  submissionsDeleted: number;
  answersDeleted: number;
};

// ---------------------------------------------------------------------------
// Shared service deps
// ---------------------------------------------------------------------------

export type WorkspaceExportDeps = {
  exports: WorkspaceExportStore;
  /** Injected clock (spec §4: never new Date() inside services). */
  now: () => Date;
};

export type WorkspaceDeletionDeps = {
  workspaces: WorkspaceLifecycleStore;
  now: () => Date;
};

export type AccountDeletionDeps = {
  accounts: AccountDeletionStore;
  workspaces: WorkspaceLifecycleStore;
  /** Grace period (days) applied to workspaces that must cascade. Default 30. */
  defaultGraceDays?: number;
  now: () => Date;
};

export type RetentionDeps = {
  retention: RetentionStore;
  now: () => Date;
};

export type { Ctx };
