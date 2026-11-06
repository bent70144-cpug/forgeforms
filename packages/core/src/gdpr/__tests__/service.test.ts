// T29 — GDPR service tests (spec §17): workspace export, workspace + account
// deletion, per-form retention. All flows run against in-memory fakes.
import { describe, expect, it } from 'vitest';
import { createCtx } from '../../shared/ctx';
import {
  createInMemoryGdprState,
  createInMemoryGdprStores,
} from '../testing';
import {
  deleteAccount,
  exportWorkspaceData,
  purgeExpiredSubmissionData,
  purgeExpiredWorkspaces,
  requestWorkspaceDeletion,
} from '../service';
import type { InMemoryGdprState } from '../testing';

const T0 = Date.parse('2026-11-06T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function clock(start: number = T0) {
  let current = start;
  return { now: () => new Date(current), jumpTo: (ms: number) => { current = ms; } };
}

function ctxFor(state: InMemoryGdprState, workspaceId: string) {
  const member = state.memberships.get(workspaceId)?.[0];
  return createCtx({
    workspaceId,
    actor: { type: 'user', id: member?.userId ?? 'u_unknown' },
    now: () => new Date(T0),
  });
}

function seedWorkspace(state: InMemoryGdprState, workspaceId: string, userId = 'u_owner') {
  state.workspaces.set(workspaceId, { id: workspaceId, name: 'WS', slug: `slug-${workspaceId}`, createdAt: new Date(T0 - 90 * DAY), deletedAt: null });
  state.memberships.set(workspaceId, [{ userId, role: 'owner', createdAt: new Date(T0 - 90 * DAY) }]);
  state.users.set(userId, { id: userId, email: `${userId}@example.test`, createdAt: new Date(T0 - 90 * DAY) });
  state.sessionsByUser.set(userId, 2);
  state.authTokensByUser.set(userId, 1);
}

describe('exportWorkspaceData (workspace data export)', () => {
  it('builds a full archive: workspace, members, documents, versions, submissions, webhooks, tokens', async () => {
    const state = createInMemoryGdprState();
    seedWorkspace(state, 'ws_1');
    state.documents.set('ws_1', [
      { id: 'doc_1', type: 'form', title: 'Contact', slug: 'contact', status: 'published', draft: { blocks: [] }, createdAt: new Date(T0), updatedAt: new Date(T0) },
    ]);
    state.documentVersions.set('ws_1', [
      { id: 'ver_1', documentId: 'doc_1', schemaVersion: 1, body: { blocks: [] }, createdAt: new Date(T0) },
    ]);
    state.submissions.set('ws_1', [
      {
        id: 'sub_1', workspaceId: 'ws_1', documentId: 'doc_1', status: 'completed',
        startedAt: new Date(T0), completedAt: new Date(T0),
        variables: { score: 2 }, hidden: { utm: 'x' }, meta: {},
        answers: [{ blockId: 'q1', value: 'hello' }],
      },
    ]);
    state.webhookEndpoints.set('ws_1', [
      { id: 'wh_1', documentId: 'doc_1', url: 'https://hooks.example', events: ['submission.completed'], enabled: true, createdAt: new Date(T0), secret: 'whsec_TOPSECRET' },
    ]);
    state.apiTokens.set('ws_1', [
      { id: 'tok_1', name: 'CI', scopes: ['docs:read'], lastUsedAt: null, createdAt: new Date(T0), tokenHash: 'aaabbbeeesss' },
    ]);

    const stores = createInMemoryGdprStores(state);
    const result = await exportWorkspaceData({ exports: stores.exports, now: () => new Date(T0) }, ctxFor(state, 'ws_1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const archive = result.value;
    expect(archive.format).toBe('formforge.workspace-export.v1');
    expect(archive.workspace).toMatchObject({ id: 'ws_1', name: 'WS', slug: 'slug-ws_1' });
    expect(archive.members).toHaveLength(1);
    expect(archive.documents).toHaveLength(1);
    expect(archive.documentVersions).toHaveLength(1);
    expect(archive.submissions).toHaveLength(1);
    expect(archive.submissions[0]).toMatchObject({ id: 'sub_1', status: 'completed', answers: [{ blockId: 'q1', value: 'hello' }] });
    expect(archive.webhookEndpoints).toHaveLength(1);
    expect(archive.apiTokens).toHaveLength(1);
  });

  it('NEVER contains webhook secrets or API token hashes', async () => {
    const state = createInMemoryGdprState();
    seedWorkspace(state, 'ws_1');
    state.webhookEndpoints.set('ws_1', [
      { id: 'wh_1', documentId: null, url: 'https://h', events: [], enabled: true, createdAt: null, secret: 'whsec_SUPERSECRETVALUE' },
    ]);
    state.apiTokens.set('ws_1', [
      { id: 'tok_1', name: 't', scopes: [], lastUsedAt: null, createdAt: null, tokenHash: 'deadbeefdeadbeef' },
    ]);
    const stores = createInMemoryGdprStores(state);
    const result = await exportWorkspaceData({ exports: stores.exports, now: () => new Date(T0) }, ctxFor(state, 'ws_1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrowing for the assertions below
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain('SUPERSECRET');
    expect(serialized).not.toContain('deadbeefdeadbeef');
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain('secret');
  });

  it('404s for a workspace the ctx does not own', async () => {
    const state = createInMemoryGdprState();
    const stores = createInMemoryGdprStores(state);
    const result = await exportWorkspaceData({ exports: stores.exports, now: () => new Date(T0) }, ctxFor(state, 'ws_missing'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_FOUND');
  });
});

describe('workspace deletion (request + grace + hard purge)', () => {
  it('schedules deletion (idempotent, keeps first deletedAt) and purges after the grace window', async () => {
    const state = createInMemoryGdprState();
    seedWorkspace(state, 'ws_1');
    state.documents.set('ws_1', [{ id: 'doc_1', type: 'page', title: 'P', slug: 'p', status: 'published', draft: {}, createdAt: null, updatedAt: null }]);
    state.submissions.set('ws_1', [
      { id: 'sub_1', workspaceId: 'ws_1', documentId: 'doc_1', status: 'completed', startedAt: null, completedAt: null, variables: {}, hidden: {}, meta: {}, answers: [{ blockId: 'q1', value: 1 }, { blockId: 'q2', value: 2 }] },
    ]);
    const stores = createInMemoryGdprStores(state);

    const first = await requestWorkspaceDeletion({ workspaces: stores.workspaces, now: () => new Date(T0) }, 'ws_1');
    expect(first.ok).toBe(true);
    const again = await requestWorkspaceDeletion({ workspaces: stores.workspaces, now: () => new Date(T0 + 10 * DAY) }, 'ws_1');
    expect(again.ok).toBe(true);
    // deletedAt unchanged (idempotent — grace never extended)
    expect(stores.state.workspaces.get('ws_1')?.deletedAt?.getTime()).toBe(T0);

    // Within the 30-day window: not purged.
    const midRun = await purgeExpiredWorkspaces({ workspaces: stores.workspaces, now: () => new Date(T0 + 29 * DAY) });
    expect(midRun.purged).toBe(0);
    expect(state.workspaces.has('ws_1')).toBe(true);

    // After the window: hard purge removes everything.
    const run = await purgeExpiredWorkspaces({ workspaces: stores.workspaces, now: () => new Date(T0 + 31 * DAY) });
    expect(run).toMatchObject({ purged: 1, answersDeleted: 2, submissionsDeleted: 1, documentsDeleted: 1, workspaceIds: ['ws_1'] });
    expect(state.workspaces.has('ws_1')).toBe(false);
    expect(state.documents.has('ws_1')).toBe(false);
    expect(state.submissions.has('ws_1')).toBe(false);
  });

  it('does not purge a workspace deleted just now (default 30-day window)', async () => {
    const state = createInMemoryGdprState();
    seedWorkspace(state, 'ws_1');
    const stores = createInMemoryGdprStores(state);
    await requestWorkspaceDeletion({ workspaces: stores.workspaces, now: () => new Date(T0) }, 'ws_1');
    const run = await purgeExpiredWorkspaces({ workspaces: stores.workspaces, now: () => new Date(T0 + DAY) });
    expect(run.purged).toBe(0);
  });
});

describe('account deletion', () => {
  it('deletes the user, sessions, tokens and memberships; schedules sole-owned workspaces', async () => {
    const state = createInMemoryGdprState();
    seedWorkspace(state, 'ws_solo', 'u_owner');
    seedWorkspace(state, 'ws_shared', 'u_owner');
    state.memberships.set('ws_shared', [
      { userId: 'u_owner', role: 'owner', createdAt: null },
      { userId: 'u_peer', role: 'owner', createdAt: null },
    ]);
    state.users.set('u_peer', { id: 'u_peer', email: 'peer@example.test', createdAt: null });
    const stores = createInMemoryGdprStores(state);

    const result = await deleteAccount(
      { accounts: stores.accounts, workspaces: stores.workspaces, now: () => new Date(T0) },
      'u_owner',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      userId: 'u_owner',
      sessionsDeleted: 2,
      authTokensDeleted: 1,
      membershipsDeleted: 2,
      workspacesScheduled: ['ws_solo'],
      workspacesKept: ['ws_shared'],
    });
    expect(state.users.has('u_owner')).toBe(false);
    expect(state.sessionsByUser.has('u_owner')).toBe(false);
    // Shared workspace survives with its other owner.
    expect(state.workspaces.get('ws_shared')?.deletedAt).toBeNull();
    expect(state.workspaces.get('ws_solo')?.deletedAt?.getTime()).toBe(T0);
  });

  it('404s for unknown users', async () => {
    const stores = createInMemoryGdprStores();
    const result = await deleteAccount({ accounts: stores.accounts, workspaces: stores.workspaces, now: () => new Date(T0) }, 'u_ghost');
    expect(result.ok).toBe(false);
  });
});

describe('per-form retention purge', () => {
  function retentionState(): InMemoryGdprState {
    const state = createInMemoryGdprState();
    seedWorkspace(state, 'ws_1');
    state.documents.set('ws_1', [
      { id: 'doc_keep', type: 'form', title: 'Keep forever', slug: 'keep', status: 'published', draft: {}, createdAt: null, updatedAt: null },
      { id: 'doc_30', type: 'form', title: '30d retention', slug: '30d', status: 'published', draft: {}, createdAt: null, updatedAt: null },
    ]);
    state.retentionDays.set('doc_30', 30);
    state.submissions.set('ws_1', [
      { id: 's_old', workspaceId: 'ws_1', documentId: 'doc_30', status: 'completed', startedAt: new Date(T0 - 60 * DAY), completedAt: new Date(T0 - 60 * DAY), variables: {}, hidden: {}, meta: {}, answers: [{ blockId: 'q1', value: 'a' }] },
      { id: 's_new', workspaceId: 'ws_1', documentId: 'doc_30', status: 'completed', startedAt: new Date(T0 - 5 * DAY), completedAt: new Date(T0 - 5 * DAY), variables: {}, hidden: {}, meta: {}, answers: [{ blockId: 'q1', value: 'b' }] },
      { id: 's_draft', workspaceId: 'ws_1', documentId: 'doc_30', status: 'draft', startedAt: new Date(T0 - 90 * DAY), completedAt: null, variables: {}, hidden: {}, meta: {}, answers: [{ blockId: 'q1', value: 'c' }] },
      { id: 's_other', workspaceId: 'ws_1', documentId: 'doc_keep', status: 'completed', startedAt: new Date(T0 - 90 * DAY), completedAt: new Date(T0 - 90 * DAY), variables: {}, hidden: {}, meta: {}, answers: [{ blockId: 'q1', value: 'd' }] },
      { id: 's_spam_old', workspaceId: 'ws_1', documentId: 'doc_30', status: 'spam', startedAt: new Date(T0 - 60 * DAY), completedAt: new Date(T0 - 60 * DAY), variables: {}, hidden: {}, meta: {}, answers: [] },
    ]);
    return state;
  }

  it('deletes only expired completed/spam submissions of documents WITH retention', async () => {
    const state = retentionState();
    const stores = createInMemoryGdprStores(state);
    const summary = await purgeExpiredSubmissionData({ retention: stores.retention, now: () => new Date(T0) });
    expect(summary).toEqual({ documentsScanned: 1, submissionsDeleted: 2, answersDeleted: 1 });
    const ids = (state.submissions.get('ws_1') ?? []).map((s) => s.id).sort();
    expect(ids).toEqual(['s_draft', 's_new', 's_other']); // draft + no-retention doc survive
  });

  it('documents without retentionDays keep everything', async () => {
    const state = retentionState();
    state.retentionDays.clear();
    const stores = createInMemoryGdprStores(state);
    const summary = await purgeExpiredSubmissionData({ retention: stores.retention, now: () => new Date(T0) });
    expect(summary.documentsScanned).toBe(0);
    expect((state.submissions.get('ws_1') ?? []).length).toBe(5);
  });
});
