// packages/db/src/repositories/billing.ts
// Billing repository (spec §6 tables: workspaces, memberships,
// usage_counters, audit_log). Owned by T23 — NEW file under
// src/repositories/** as sanctioned by this package's index.ts header;
// NEVER touches src/schema/**.
//
// INTEGRATION-DEBT: awaiting T02 (billing tables kernel). The drizzle table
// objects for workspaces/memberships/usage_counters/audit_log do not exist
// yet, so this repository uses parameterized raw SQL (`sql` templates) with
// the exact snake_case columns from spec §6. Once T02's schema lands, the
// lead may swap the statements for typed table access without changing the
// exported interface — the shape mirrors @formforge/core/billing's
// `BillingStore` structurally (dependency direction: db must not import core).

import { sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Client seam

/** Minimal structural view of a drizzle node-postgres database — just what
 * billing needs. `drizzle(pool)` satisfies it structurally, and so does any
 * test double. */
export interface BillingDbClient {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** Create a real Postgres-backed client. Lazy: no sockets open until the
 * first query, so creating this in tests without a DB is safe. */
export function createBillingDb(databaseUrl: string = process.env.DATABASE_URL ?? '') {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  // drizzle's execute returns a Promise-like whose resolved QueryResult is
  // structurally compatible; the cast keeps us decoupled from drizzle
  // generics (no schema objects exist yet — see INTEGRATION-DEBT above).
  return drizzle(pool) as unknown as BillingDbClient;
}

// ---------------------------------------------------------------------------
// Types (structural mirrors of @formforge/core/billing — keep in sync;
// the webhook route in apps/web enforces the match by using both ends)

export type Plan = 'free' | 'pro' | 'business';

export type WorkspaceBillingRow = {
  workspaceId: string;
  plan: Plan;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

const PLANS: readonly Plan[] = ['free', 'pro', 'business'];

function asPlan(value: unknown): Plan {
  return PLANS.includes(value as Plan) ? (value as Plan) : 'free';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function firstRow(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
}

// UUIDv7 per spec §4 (generated in the app). INTEGRATION-DEBT: replace with
// shared/ids.ts from the T02 kernel once it lands.
function uuidv7(now = Date.now()): string {
  const ts = BigInt(now);
  const rand = globalThis.crypto.getRandomValues(new Uint8Array(10));
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt(40 - 8 * i)) & 0xffn);
  }
  bytes[6] = (rand[0]! & 0x0f) | 0x70;
  bytes[7] = rand[1]!;
  bytes[8] = (rand[2]! & 0x3f) | 0x80;
  for (let i = 3; i < 10; i++) {
    bytes[i + 6] = rand[i]!;
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type BillingRepository = {
  getWorkspaceBilling(workspaceId: string): Promise<WorkspaceBillingRow | null>;
  findWorkspaceIdByStripeCustomer(stripeCustomerId: string): Promise<string | null>;
  setWorkspaceBilling(input: {
    workspaceId: string;
    plan: Plan;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  }): Promise<boolean>;
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(input: { eventId: string; workspaceId: string; type: string }): Promise<void>;
  countMembers(workspaceId: string): Promise<number>;
  getMonthlySubmissions(workspaceId: string, period: string): Promise<number>;
};

export function createBillingRepository(db: BillingDbClient): BillingRepository {
  return {
    async getWorkspaceBilling(workspaceId) {
      const result = await db.execute(sql`
        select id, plan, stripe_customer_id, stripe_subscription_id
        from workspaces
        where id = ${workspaceId}
      `);
      const row = firstRow(result.rows);
      if (!row) return null;
      return {
        workspaceId: asString(row['id']) ?? workspaceId,
        plan: asPlan(row['plan']),
        stripeCustomerId: asString(row['stripe_customer_id']),
        stripeSubscriptionId: asString(row['stripe_subscription_id']),
      };
    },

    async findWorkspaceIdByStripeCustomer(stripeCustomerId) {
      const result = await db.execute(sql`
        select id from workspaces
        where stripe_customer_id = ${stripeCustomerId}
        limit 1
      `);
      const row = firstRow(result.rows);
      return row ? asString(row['id']) : null;
    },

    async setWorkspaceBilling({ workspaceId, plan, stripeCustomerId, stripeSubscriptionId }) {
      const result = await db.execute(sql`
        update workspaces
        set plan = ${plan},
            stripe_customer_id = ${stripeCustomerId},
            stripe_subscription_id = ${stripeSubscriptionId}
        where id = ${workspaceId}
      `);
      return (result.rowCount ?? 0) > 0;
    },

    // SPEC-NOTE: spec §6 has no dedicated webhook-events table; processed
    // event ids live in audit_log (actor_type='stripe', actor_id=eventId,
    // action='billing.webhook.processed') so replays are idempotent per
    // issue #23 and leave an audit trail.
    async isEventProcessed(eventId) {
      const result = await db.execute(sql`
        select 1 from audit_log
        where action = 'billing.webhook.processed' and actor_id = ${eventId}
        limit 1
      `);
      return result.rows.length > 0;
    },

    async markEventProcessed({ eventId, workspaceId, type }) {
      await db.execute(sql`
        insert into audit_log (id, workspace_id, actor_type, actor_id, action, target, created_at)
        values (${uuidv7()}, ${workspaceId}, 'stripe', ${eventId}, 'billing.webhook.processed', ${type}, now())
      `);
    },

    async countMembers(workspaceId) {
      const result = await db.execute(sql`
        select count(*)::int as count from memberships where workspace_id = ${workspaceId}
      `);
      const row = firstRow(result.rows);
      const count = row?.['count'];
      return typeof count === 'number' ? count : 0;
    },

    async getMonthlySubmissions(workspaceId, period) {
      const result = await db.execute(sql`
        select value from usage_counters
        where workspace_id = ${workspaceId} and period = ${period} and metric = 'submissions'
      `);
      const row = firstRow(result.rows);
      const value = row?.['value'];
      // bigint comes back as string from pg
      return typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : 0;
    },
  };
}

/** Current usage period (`YYYY-MM`) in UTC — callers pass ctx.now(). */
export function usagePeriod(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
