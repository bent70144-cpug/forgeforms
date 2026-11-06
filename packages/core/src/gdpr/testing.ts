// T29 — in-memory GDPR stores. Used by unit tests AND as the dev-mode
// composition (no DATABASE_URL) in apps/web/lib/gdpr. SQL lives in @formforge/db.
import type {
  AccountDeletionStore,
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
} from './types';

export type InMemoryGdprState = {
  workspaces: Map<string, { id: string; name: string; slug: string; createdAt: Date | null; deletedAt: Date | null }>;
  memberships: Map<string, Array<{ userId: string; role: string; createdAt: Date | null }>>;
  documents: Map<string, ExportedDocument[]>;
  documentVersions: Map<string, ExportedDocumentVersion[]>;
  submissions: Map<string, Array<ExportedSubmission & { workspaceId: string; answers: Array<{ blockId: string; value: unknown }> }>>;
  webhookEndpoints: Map<string, Array<ExportedWebhookEndpoint & { secret: string }>>;
  apiTokens: Map<string, Array<ExportedApiToken & { tokenHash: string }>>;
  users: Map<string, { id: string; email: string; createdAt: Date | null }>;
  sessionsByUser: Map<string, number>;
  authTokensByUser: Map<string, number>;
  /** documentId → retentionDays (mirrors documents.draft->settings.retentionDays). */
  retentionDays: Map<string, number>;
};

export function createInMemoryGdprState(): InMemoryGdprState {
  return {
    workspaces: new Map(),
    memberships: new Map(),
    documents: new Map(),
    documentVersions: new Map(),
    submissions: new Map(),
    webhookEndpoints: new Map(),
    apiTokens: new Map(),
    users: new Map(),
    sessionsByUser: new Map(),
    authTokensByUser: new Map(),
    retentionDays: new Map(),
  };
}

export function createInMemoryGdprStores(state: InMemoryGdprState = createInMemoryGdprState()): {
  exports: WorkspaceExportStore;
  workspaces: WorkspaceLifecycleStore;
  accounts: AccountDeletionStore;
  retention: RetentionStore;
  state: InMemoryGdprState;
} {
  const exportsStore: WorkspaceExportStore = {
    async getWorkspace(workspaceId) {
      const ws = state.workspaces.get(workspaceId);
      if (!ws) return null;
      return { id: ws.id, name: ws.name, slug: ws.slug, createdAt: ws.createdAt };
    },
    async listMemberships(workspaceId): Promise<ExportedMembership[]> {
      return (state.memberships.get(workspaceId) ?? []).map(({ userId, role, createdAt }) => ({ userId, role, createdAt }));
    },
    async listDocuments(workspaceId) {
      return [...(state.documents.get(workspaceId) ?? [])];
    },
    async listDocumentVersions(workspaceId) {
      return [...(state.documentVersions.get(workspaceId) ?? [])];
    },
    async listSubmissions(workspaceId) {
      return (state.submissions.get(workspaceId) ?? []).map((s) => ({
        id: s.id,
        documentId: s.documentId,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        variables: s.variables,
        hidden: s.hidden,
        meta: s.meta,
        answers: s.answers.map((a) => ({ ...a, value: structuredCloneSafe(a.value) })),
      }));
    },
    async listWebhookEndpoints(workspaceId) {
      // REDACTION: the in-memory store mirrors the SQL contract — no secret leaves the store.
      return (state.webhookEndpoints.get(workspaceId) ?? []).map(({ id, documentId, url, events, enabled, createdAt }) => ({
        id,
        documentId,
        url,
        events,
        enabled,
        createdAt,
      }));
    },
    async listApiTokens(workspaceId) {
      // REDACTION: no token hash leaves the store.
      return (state.apiTokens.get(workspaceId) ?? []).map(({ id, name, scopes, lastUsedAt, createdAt }) => ({
        id,
        name,
        scopes,
        lastUsedAt,
        createdAt,
      }));
    },
  };

  const workspacesStore: WorkspaceLifecycleStore = {
    async getWorkspace(workspaceId): Promise<WorkspaceLifecycleRow | null> {
      const ws = state.workspaces.get(workspaceId);
      if (!ws) return null;
      return { id: ws.id, slug: ws.slug, deletedAt: ws.deletedAt };
    },
    async scheduleDeletion(workspaceId, deletedAt) {
      const ws = state.workspaces.get(workspaceId);
      if (!ws) return false;
      if (ws.deletedAt === null) ws.deletedAt = deletedAt;
      return true;
    },
    async listPurgeCandidates(cutoff, limit) {
      const out: WorkspaceLifecycleRow[] = [];
      for (const ws of state.workspaces.values()) {
        if (out.length >= limit) break;
        if (ws.deletedAt !== null && ws.deletedAt.getTime() <= cutoff.getTime()) {
          out.push({ id: ws.id, slug: ws.slug, deletedAt: ws.deletedAt });
        }
      }
      return out;
    },
    async purgeWorkspace(workspaceId) {
      const ws = state.workspaces.get(workspaceId);
      if (!ws) return { answersDeleted: 0, submissionsDeleted: 0, documentsDeleted: 0 };
      const submissions = state.submissions.get(workspaceId) ?? [];
      const answersDeleted = submissions.reduce((n, s) => n + s.answers.length, 0);
      const submissionsDeleted = submissions.length;
      const documentsDeleted = (state.documents.get(workspaceId) ?? []).length;
      state.submissions.delete(workspaceId);
      state.documents.delete(workspaceId);
      state.documentVersions.delete(workspaceId);
      state.webhookEndpoints.delete(workspaceId);
      state.apiTokens.delete(workspaceId);
      state.memberships.delete(workspaceId);
      state.retentionDays.delete(workspaceId);
      state.workspaces.delete(workspaceId);
      return { answersDeleted, submissionsDeleted, documentsDeleted };
    },
  };

  const accountsStore: AccountDeletionStore = {
    async getUser(userId) {
      const user = state.users.get(userId);
      if (!user) return null;
      return { id: user.id, email: user.email, createdAt: user.createdAt };
    },
    async listMembershipsForUser(userId) {
      const out: Array<{ workspaceId: string; role: string }> = [];
      for (const [workspaceId, members] of state.memberships.entries()) {
        for (const membership of members) {
          if (membership.userId === userId) out.push({ workspaceId, role: membership.role });
        }
      }
      return out;
    },
    async countOwners(workspaceId) {
      return (state.memberships.get(workspaceId) ?? []).filter((m) => m.role === 'owner').length;
    },
    async deleteSessionsForUser(userId) {
      const count = state.sessionsByUser.get(userId) ?? 0;
      state.sessionsByUser.delete(userId);
      return count;
    },
    async deleteAuthTokensForUser(userId) {
      const count = state.authTokensByUser.get(userId) ?? 0;
      state.authTokensByUser.delete(userId);
      return count;
    },
    async deleteMembershipsForUser(userId) {
      let deleted = 0;
      for (const [workspaceId, members] of state.memberships.entries()) {
        const remaining = members.filter((m) => m.userId !== userId);
        deleted += members.length - remaining.length;
        if (remaining.length === 0) state.memberships.delete(workspaceId);
        else state.memberships.set(workspaceId, remaining);
      }
      return deleted;
    },
    async deleteUser(userId) {
      return state.users.delete(userId);
    },
  };

  const retentionStore: RetentionStore = {
    async listRetainedDocuments() {
      const out: Array<{ documentId: string; workspaceId: string; retentionDays: number }> = [];
      for (const [workspaceId, docs] of state.documents.entries()) {
        for (const doc of docs) {
          const days = state.retentionDays.get(doc.id) ?? 0;
          if (days > 0) out.push({ documentId: doc.id, workspaceId, retentionDays: days });
        }
      }
      return out;
    },
    async purgeSubmissionsBefore(documentId, cutoff) {
      let submissionsDeleted = 0;
      let answersDeleted = 0;
      for (const [workspaceId, submissions] of state.submissions.entries()) {
        const keep: typeof submissions = [];
        for (const submission of submissions) {
          const isThisDoc = submission.documentId === documentId;
          const ts = submission.completedAt ?? submission.startedAt;
          const expired = isThisDoc && submission.status !== 'draft' && ts !== null && ts.getTime() < cutoff.getTime();
          if (expired) {
            submissionsDeleted += 1;
            answersDeleted += submission.answers.length;
          } else {
            keep.push(submission);
          }
        }
        state.submissions.set(workspaceId, keep);
      }
      return { submissionsDeleted, answersDeleted };
    },
  };

  return { exports: exportsStore, workspaces: workspacesStore, accounts: accountsStore, retention: retentionStore, state };
}

function structuredCloneSafe<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
