// Events repository — T17 (issue #17). NEW file; does NOT touch src/schema/**.
//
// INTEGRATION-DEBT: awaiting T02 — the `events` table + drizzle client land
// with T02 (issue #2). Until then this repository is self-contained: it speaks
// parameterized SQL through an injected `QueryFn` and owns its own row types.
// When T02 lands, either point `QueryFn` at the shared client/pool or swap the
// internals for drizzle tables — the public interface below is the contract
// T17's worker depends on (structurally mirrored in apps/worker/src/ports.ts).
//
// Exactly-once rule: `insertEventOnce` is the ONLY way an event row is
// created; it relies on the primary key + ON CONFLICT DO NOTHING so a
// redelivered fan-out job can never persist the event twice.
//
// SPEC-NOTE: spec §6 does not define the `events` DDL (it was added by the
// lead brief: T02 creates events + webhook_endpoints tables). Column mapping
// here follows the webhook_deliveries conventions (snake_case, timestamptz).

export type EventRow = {
  id: string;
  workspaceId: string;
  /** e.g. "submission.completed" */
  type: string;
  documentId: string | null;
  /** Full event payload (jsonb), spec §12 shape. */
  payload: unknown;
  occurredAt: Date;
  /** Set when fan-out finished enqueueing all side effects. */
  processedAt: Date | null;
};

export type NewEventRow = {
  id: string;
  workspaceId: string;
  type: string;
  documentId: string | null;
  payload: unknown;
  occurredAt: Date;
};

export type InsertEventOutcome = { created: boolean };

/** Minimal SQL executor surface (rows as raw records with snake_case keys). */
export type QueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

type RawEventRecord = {
  id: string;
  workspace_id: string;
  type: string;
  document_id: string | null;
  payload: unknown;
  occurred_at: Date | string;
  processed_at: Date | string | null;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function mapEventRow(record: RawEventRecord): EventRow {
  return {
    id: record.id,
    workspaceId: record.workspace_id,
    type: record.type,
    documentId: record.document_id,
    payload: record.payload,
    occurredAt: toDate(record.occurred_at),
    processedAt: record.processed_at === null ? null : toDate(record.processed_at),
  };
}

export type EventsRepository = {
  /** Persists the event exactly once (idempotent by primary key). */
  insertEventOnce(row: NewEventRow): Promise<InsertEventOutcome>;
  getEvent(id: string): Promise<EventRow | null>;
  markEventProcessed(id: string, processedAt: Date): Promise<void>;
};

export function createEventsRepository(query: QueryFn): EventsRepository {
  return {
    async insertEventOnce(row: NewEventRow): Promise<InsertEventOutcome> {
      const rows = await query<{ id: string }>(
        `insert into events (id, workspace_id, type, document_id, payload, occurred_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing
         returning id`,
        [row.id, row.workspaceId, row.type, row.documentId, JSON.stringify(row.payload), row.occurredAt],
      );
      return { created: rows.length > 0 };
    },

    async getEvent(id: string): Promise<EventRow | null> {
      const rows = await query<RawEventRecord>(`select * from events where id = $1`, [id]);
      const record = rows[0];
      return record ? mapEventRow(record) : null;
    },

    async markEventProcessed(id: string, processedAt: Date): Promise<void> {
      await query(`update events set processed_at = $2 where id = $1`, [id, processedAt]);
    },
  };
}
