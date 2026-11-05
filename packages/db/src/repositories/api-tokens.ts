// Drizzle repository for api_tokens (issue #25) — the Drizzle-backed store for
// the token service port in @formforge/core/api (spec §6 table `api_tokens`).
//
// INTEGRATION-DEBT: awaiting T02
//  - The table definition below is a faithful copy of spec §6 `api_tokens`.
//    When T02 lands packages/db/src/schema/api-tokens.ts, DELETE the local
//    `apiTokens` definition and import it from '../schema' instead.
//  - The port/record types are mirrored locally (structurally identical to
//    @formforge/core/api) because packages/db must not gain dependencies in
//    T25 (hard rule: deps only in core/schema/web manifests). apps/web wires
//    this store into the core service with a compile-time `satisfies
//    ApiTokenStore` check. Replace the mirrors with real imports when T02's
//    dependency graph lands.
//  - Tenant scoping via RLS (`set local app.workspace_id = …`, spec §6) goes
//    through T02's transaction helper; swap the `db` calls once it exists.

import { and, asc, eq } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// INTEGRATION-DEBT: awaiting T02 — local definition pending packages/db/src/schema/**
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: text('scopes').array().notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Mirror of core's scope union (contract strings per spec §6 / issue #25).
 * Keep in lockstep with @formforge/core/api `API_SCOPES` — guarded by the
 * structural compatibility check at the wiring site in apps/web.
 */
export type ApiScope = 'docs:read' | 'docs:write' | 'docs:publish' | 'submissions:read';

export const API_SCOPES: readonly ApiScope[] = [
  'docs:read',
  'docs:write',
  'docs:publish',
  'submissions:read',
];

export interface ApiTokenRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly scopes: readonly ApiScope[];
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

/** Mirror of core's `ApiTokenStore` port — structurally identical. */
export interface ApiTokenStore {
  create(input: {
    id: string;
    workspaceId: string;
    name: string;
    tokenHash: string;
    scopes: readonly ApiScope[];
    createdAt: Date;
  }): Promise<ApiTokenRecord>;
  list(workspaceId: string): Promise<readonly ApiTokenRecord[]>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  delete(workspaceId: string, id: string): Promise<boolean>;
  touch(id: string, at: Date): Promise<void>;
}

/** Minimal structural type — any Drizzle pg database satisfies it. */
export type ApiTokensDb = Pick<
  NodePgDatabase<Record<string, never>>,
  'select' | 'insert' | 'update' | 'delete'
>;

type Row = typeof apiTokens.$inferSelect;

function asScopes(value: readonly string[]): ApiScope[] {
  const allow = new Set<string>(API_SCOPES);
  const scopes: ApiScope[] = [];
  for (const scope of value) {
    if (allow.has(scope)) scopes.push(scope as ApiScope);
  }
  return scopes;
}

function mapRow(row: Row): ApiTokenRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    tokenHash: row.tokenHash,
    scopes: asScopes(row.scopes),
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
  };
}

export function createApiTokenStore(db: ApiTokensDb): ApiTokenStore {
  return {
    async create(input) {
      const [row] = await db
        .insert(apiTokens)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          name: input.name,
          tokenHash: input.tokenHash,
          scopes: [...input.scopes],
          createdAt: input.createdAt,
        })
        .returning();
      if (!row) throw new Error('api_tokens insert returned no row');
      return mapRow(row);
    },

    async list(workspaceId) {
      const rows = await db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.workspaceId, workspaceId))
        .orderBy(asc(apiTokens.createdAt));
      return rows.map(mapRow);
    },

    async findByTokenHash(tokenHash) {
      const [row] = await db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.tokenHash, tokenHash))
        .limit(1);
      return row ? mapRow(row) : null;
    },

    async delete(workspaceId, id) {
      const rows = await db
        .delete(apiTokens)
        .where(and(eq(apiTokens.id, id), eq(apiTokens.workspaceId, workspaceId)))
        .returning({ id: apiTokens.id });
      return rows.length > 0;
    },

    async touch(id, at) {
      await db.update(apiTokens).set({ lastUsedAt: at }).where(eq(apiTokens.id, id));
    },
  };
}
