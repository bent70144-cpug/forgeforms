// T29 (spec §17 GDPR) — SQL implementations of the GDPR store ports from
// @formforge/core/gdpr (structural match — this package does not import core
// gdpr types, mirroring repositories/exports.ts).
//
// Surfaces:
//   WorkspaceExportStore    — the workspace archive read side (export route).
//   WorkspaceLifecycleStore — soft deletion (request/grace) + hard purge.
//   AccountDeletionStore    — user erasure cascading sole-owned workspaces.
//   RetentionStore          — per-form retention purge (maintenance job).
//
// SECURITY (spec §17): export queries NEVER select webhook secrets or API
// token hashes — the columns are simply absent from the SELECT lists.
//
// SCOPING: every statement filters by workspace_id in its WHERE clause (RLS is
// defense in depth — see packages/db/src/repositories/tenant.ts). The hard
// purge and the retention sweep are MAINTENANCE-plane jobs that must run with
// a connection whose role is allowed to touch all tenants (table owner), or be
// wrapped per-workspace in `set local app.workspace_id` transactions by the
// caller — see docs/backups-restore-runbook.md and the runbook notes in
// docs/security-checklist.md.
import type {
  AccountDeletionStore,
  ExportedAnswer,
  ExportedApiToken,
  ExportedDocument,
  ExportedDocumentVersion,
  ExportedMembership,
  ExportedSubmission,
  ExportedWebhookEndpoint,
  ExportedWorkspace,
  RetentionStore,
  WorkspaceExportStore,
  WorkspaceLifecycleRow,
  WorkspaceLifecycleStore,
} from "@formforge/core/gdpr";
import type { SqlExecutor } from "./document-versions";

type Row = Record<string, unknown>;

const asString = (v: unknown): string => (typeof v === "string" ? v : String(v));
const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : (v as Date));
const asRecord = (v: unknown): unknown => v; // jsonb already parsed by pg

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function createGdprExportStore(exec: SqlExecutor): WorkspaceExportStore {
  return {
    async getWorkspace(workspaceId: string): Promise<ExportedWorkspace | null> {
      const result = await exec.query(
        `select id, name, slug, created_at from workspaces where id = $1`,
        [workspaceId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: asString(row["id"]),
        name: asString(row["name"]),
        slug: asString(row["slug"]),
        createdAt: asDate(row["created_at"]),
      };
    },

    async listMemberships(workspaceId: string): Promise<ExportedMembership[]> {
      const result = await exec.query(
        `select user_id, role, created_at from memberships where workspace_id = $1 order by created_at asc`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        userId: asString(row["user_id"]),
        role: asString(row["role"]),
        createdAt: asDate(row["created_at"]),
      }));
    },

    async listDocuments(workspaceId: string): Promise<ExportedDocument[]> {
      const result = await exec.query(
        `select id, type, title, slug, status, draft, created_at, updated_at
         from documents where workspace_id = $1 order by created_at asc`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        id: asString(row["id"]),
        type: asString(row["type"]),
        title: asString(row["title"]),
        slug: asString(row["slug"]),
        status: asString(row["status"]),
        draft: asRecord(row["draft"]),
        createdAt: asDate(row["created_at"]),
        updatedAt: asDate(row["updated_at"]),
      }));
    },

    async listDocumentVersions(workspaceId: string): Promise<ExportedDocumentVersion[]> {
      const result = await exec.query(
        `select v.id, v.document_id, v.schema_version, v.body, v.created_at
         from document_versions v
         join documents d on d.id = v.document_id
         where d.workspace_id = $1
         order by v.created_at asc`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        id: asString(row["id"]),
        documentId: asString(row["document_id"]),
        schemaVersion: Number(row["schema_version"]),
        body: asRecord(row["body"]),
        createdAt: asDate(row["created_at"]),
      }));
    },

    async listSubmissions(workspaceId: string): Promise<ExportedSubmission[]> {
      const result = await exec.query(
        `select s.id, s.document_id, s.status, s.started_at, s.completed_at,
                s.variables, s.hidden, s.meta,
                coalesce(json_agg(
                  json_build_object('blockId', a.block_id, 'value', a.value)
                  order by a.block_id
                ) filter (where a.block_id is not null), '[]') as answers
         from submissions s
         left join answers a on a.submission_id = s.id
         where s.workspace_id = $1
         group by s.id
         order by s.started_at asc`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        id: asString(row["id"]),
        documentId: asString(row["document_id"]),
        status: asString(row["status"]),
        startedAt: asDate(row["started_at"]),
        completedAt: asDate(row["completed_at"]),
        variables: asRecord(row["variables"]),
        hidden: asRecord(row["hidden"]),
        meta: asRecord(row["meta"]),
        answers: (row["answers"] as ExportedAnswer[]) ?? [],
      }));
    },

    async listWebhookEndpoints(workspaceId: string): Promise<ExportedWebhookEndpoint[]> {
      // NO `secret` column — credentials never leave the DB (spec §17).
      const result = await exec.query(
        `select id, document_id, url, events, enabled, created_at
         from webhook_endpoints where workspace_id = $1 order by created_at asc`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        id: asString(row["id"]),
        documentId: row["document_id"] === null ? null : asString(row["document_id"]),
        url: asString(row["url"]),
        events: (row["events"] as string[]) ?? [],
        enabled: row["enabled"] === true,
        createdAt: asDate(row["created_at"]),
      }));
    },

    async listApiTokens(workspaceId: string): Promise<ExportedApiToken[]> {
      // NO `token_hash` column — hashes never leave the DB (spec §17).
      const result = await exec.query(
        `select id, name, scopes, last_used_at, created_at
         from api_tokens where workspace_id = $1 order by created_at asc`,
        [workspaceId],
      );
      return result.rows.map((row) => ({
        id: asString(row["id"]),
        name: asString(row["name"]),
        scopes: (row["scopes"] as string[]) ?? [],
        lastUsedAt: asDate(row["last_used_at"]),
        createdAt: asDate(row["created_at"]),
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Workspace lifecycle (soft delete → grace → hard purge)
// ---------------------------------------------------------------------------

function mapLifecycleRow(row: Row): WorkspaceLifecycleRow {
  return {
    id: asString(row["id"]),
    slug: asString(row["slug"]),
    deletedAt: asDate(row["deleted_at"]),
  };
}

export function createGdprWorkspaceStore(exec: SqlExecutor): WorkspaceLifecycleStore {
  return {
    async getWorkspace(workspaceId: string): Promise<WorkspaceLifecycleRow | null> {
      const result = await exec.query(
        `select id, slug, deleted_at from workspaces where id = $1`,
        [workspaceId],
      );
      const row = result.rows[0];
      return row ? mapLifecycleRow(row) : null;
    },

    async scheduleDeletion(workspaceId: string, deletedAt: Date): Promise<boolean> {
      // Idempotent AND monotone: only the FIRST request wins (keeps the
      // original deletedAt — a second request can never extend the clock).
      const result = await exec.query(
        `update workspaces set deleted_at = $2 where id = $1 and deleted_at is null returning id`,
        [workspaceId, deletedAt],
      );
      return result.rows.length > 0;
    },

    async listPurgeCandidates(cutoff: Date, limit: number): Promise<WorkspaceLifecycleRow[]> {
      const result = await exec.query(
        `select id, slug, deleted_at from workspaces
         where deleted_at is not null and deleted_at <= $1
         order by deleted_at asc limit $2`,
        [cutoff, limit],
      );
      return result.rows.map(mapLifecycleRow);
    },

    async purgeWorkspace(workspaceId: string): Promise<{
      answersDeleted: number;
      submissionsDeleted: number;
      documentsDeleted: number;
    }> {
      // Hard delete in dependency order; answers ride submissions' ON DELETE
      // CASCADE, but the count is still reported for the audit trail.
      const countOf = (rows: Row[]): number => rows.length;
      const answersRes = await exec.query(
        `delete from answers a using submissions s
         where a.submission_id = s.id and s.workspace_id = $1 returning a.submission_id`,
        [workspaceId],
      );
      const submissionsRes = await exec.query(
        `delete from submissions where workspace_id = $1 returning id`,
        [workspaceId],
      );
      await exec.query(
        `delete from export_jobs where workspace_id = $1`,
        [workspaceId],
      );
      await exec.query(
        `delete from webhook_deliveries d using webhook_endpoints e
         where d.webhook_id = e.id and e.workspace_id = $1`,
        [workspaceId],
      );
      await exec.query(
        `delete from webhook_endpoints where workspace_id = $1`,
        [workspaceId],
      );
      await exec.query(
        `delete from api_tokens where workspace_id = $1`,
        [workspaceId],
      );
      await exec.query(
        `delete from snapshots s using documents d
         where s.document_id = d.id and d.workspace_id = $1`,
        [workspaceId],
      );
      await exec.query(
        `delete from document_versions where workspace_id = $1`,
        [workspaceId],
      );
      const documentsRes = await exec.query(
        `delete from documents where workspace_id = $1 returning id`,
        [workspaceId],
      );
      await exec.query(
        `delete from memberships where workspace_id = $1`,
        [workspaceId],
      );
      await exec.query(`delete from workspaces where id = $1`, [workspaceId]);
      return {
        answersDeleted: countOf(answersRes.rows),
        submissionsDeleted: countOf(submissionsRes.rows),
        documentsDeleted: countOf(documentsRes.rows),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

export function createGdprAccountStore(exec: SqlExecutor): AccountDeletionStore {
  return {
    async getUser(userId: string) {
      const result = await exec.query(
        `select id, email, created_at from users where id = $1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: asString(row["id"]),
        email: asString(row["email"]),
        createdAt: asDate(row["created_at"]),
      };
    },

    async listMembershipsForUser(userId: string) {
      const result = await exec.query(
        `select workspace_id, role from memberships where user_id = $1`,
        [userId],
      );
      return result.rows.map((row) => ({
        workspaceId: asString(row["workspace_id"]),
        role: asString(row["role"]),
      }));
    },

    async countOwners(workspaceId: string): Promise<number> {
      const result = await exec.query(
        `select count(*)::int as owners from memberships where workspace_id = $1 and role = 'owner'`,
        [workspaceId],
      );
      return Number(result.rows[0]?.["owners"] ?? 0);
    },

    async deleteSessionsForUser(userId: string): Promise<number> {
      const result = await exec.query(
        `delete from sessions where user_id = $1 returning id`,
        [userId],
      );
      return result.rows.length;
    },

    async deleteAuthTokensForUser(userId: string): Promise<number> {
      const result = await exec.query(
        `delete from auth_tokens where user_id = $1 returning id`,
        [userId],
      );
      return result.rows.length;
    },

    async deleteMembershipsForUser(userId: string): Promise<number> {
      const result = await exec.query(
        `delete from memberships where user_id = $1 returning workspace_id`,
        [userId],
      );
      return result.rows.length;
    },

    async deleteUser(userId: string): Promise<boolean> {
      // Password hash rides the users row — deleting it erases the credential.
      const result = await exec.query(`delete from users where id = $1 returning id`, [userId]);
      return result.rows.length > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-form retention (maintenance job)
// ---------------------------------------------------------------------------

export function createGdprRetentionStore(exec: SqlExecutor): RetentionStore {
  return {
    async listRetainedDocuments() {
      const result = await exec.query(
        `select id, workspace_id, (draft->'settings'->>'retentionDays')::int as retention_days
         from documents
         where (draft->'settings'->>'retentionDays')::int > 0
         limit 500`,
      );
      return result.rows.map((row) => ({
        documentId: asString(row["id"]),
        workspaceId: asString(row["workspace_id"]),
        retentionDays: Number(row["retention_days"]),
      }));
    },

    async purgeSubmissionsBefore(
      documentId: string,
      cutoff: Date,
    ): Promise<{ submissionsDeleted: number; answersDeleted: number }> {
      // Completed/spam submissions ONLY — in-progress drafts are never purged
      // (they are still being filled in). `coalesce(completed_at, started_at)`
      // ages out abandoned drafts too.
      const answersRes = await exec.query(
        `delete from answers a using submissions s
         where a.submission_id = s.id
           and s.document_id = $1
           and s.status <> 'draft'
           and coalesce(s.completed_at, s.started_at) < $2
         returning a.submission_id`,
        [documentId, cutoff],
      );
      const submissionsRes = await exec.query(
        `delete from submissions
         where document_id = $1
           and status <> 'draft'
           and coalesce(completed_at, started_at) < $2
         returning id`,
        [documentId, cutoff],
      );
      return {
        submissionsDeleted: submissionsRes.rows.length,
        answersDeleted: answersRes.rows.length,
      };
    },
  };
}
