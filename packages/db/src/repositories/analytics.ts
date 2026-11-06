// T19 (issue #19) — analytics repository: `analytics_events` inserts/reads,
// `analytics_daily` idempotent upserts, and the `create-partitions` DDL executor
// (spec §6, §12).
//
// INTEGRATION-DEBT: awaiting T02 (issue #2) — T02 owns packages/db/src/schema/**.
// The two table definitions below therefore live TEMPORARILY in this NEW file
// (they match spec §6 verbatim). When T02 lands, move the tables into
// src/schema/analytics.ts and re-point the imports here. This file never edits
// src/schema/**.

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type {
  AnalyticsEventType,
  AnalyticsRange,
  DailyRollupRow,
  RawAnalyticsEvent,
} from "../../../core/src/analytics/types";
import type { PartitionPlanItem } from "../../../core/src/analytics/partitions";

// ---------------------------------------------------------------------------
// Tables (temporary home — INTEGRATION-DEBT above)
// ---------------------------------------------------------------------------

/** Partition parent — `PARTITION BY RANGE (ts)`; partition children are created
 * by the maintenance job (see ensurePartitions). Spec §6 defines no PK here. */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    documentId: uuid("document_id").notNull(),
    ts: timestamp("ts", { withTimezone: true, mode: "date" }).notNull(),
    type: text("type").notNull(), // view | start | question_view | question_pass | complete
    sessionHash: text("session_hash").notNull(),
    blockId: text("block_id"),
    props: jsonb("props"),
  },
  (t) => [index("analytics_events_doc_ts_idx").on(t.documentId, t.ts)],
);

export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    documentId: uuid("document_id").notNull(),
    day: date("day", { mode: "string" }).notNull(), // YYYY-MM-DD (UTC day key)
    views: integer("views").notNull().default(0),
    starts: integer("starts").notNull().default(0),
    completes: integer("completes").notNull().default(0),
  },
  (t) => [primaryKey({ name: "analytics_daily_pk", columns: [t.documentId, t.day] })],
);

// ---------------------------------------------------------------------------
// DDL executed by the maintenance job (idempotent; safe pre-migration too)
// ---------------------------------------------------------------------------

export const ANALYTICS_EVENTS_PARENT_DDL =
  "CREATE TABLE IF NOT EXISTS analytics_events (" +
  "document_id uuid NOT NULL, " +
  "ts timestamptz NOT NULL, " +
  "type text NOT NULL, " +
  "session_hash text NOT NULL, " +
  "block_id text, " +
  "props jsonb" +
  ") PARTITION BY RANGE (ts)";

export const ANALYTICS_EVENTS_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS analytics_events_doc_ts_idx " +
  "ON analytics_events (document_id, ts)";

export function partitionCreateDDL(parent: string, item: PartitionPlanItem): string {
  return (
    `CREATE TABLE IF NOT EXISTS "${item.name}" ` +
    `PARTITION OF "${parent}" ` +
    `FOR VALUES FROM ('${item.fromIso}') TO ('${item.toIso}')`
  );
}

// ---------------------------------------------------------------------------
// Repository (implements @formforge/core AnalyticsRepositoryPort structurally)
// ---------------------------------------------------------------------------

export interface AnalyticsRepositoryOptions {
  /** Drizzle executor; defaults to a lazily-created pg Pool when omitted. */
  db?: NodePgDatabase;
}

const UPSERT_CHUNK = 500;

export function createAnalyticsRepository(db: NodePgDatabase) {
  const repo: {
    insertEvents(rows: readonly RawAnalyticsEvent[]): Promise<number>;
    listEvents(
      documentId: string,
      range: AnalyticsRange,
      types?: readonly AnalyticsEventType[],
    ): Promise<RawAnalyticsEvent[]>;
    listDaily(documentId: string, fromDay: string, toDay: string): Promise<DailyRollupRow[]>;
    upsertDaily(rows: readonly DailyRollupRow[]): Promise<void>;
    listDocumentIdsWithEvents(range: AnalyticsRange): Promise<string[]>;
    ensureParentTable(): Promise<void>;
    ensurePartitions(plan: readonly PartitionPlanItem[]): Promise<void>;
    executeSql(statement: string): Promise<unknown>;
  } = {
    async insertEvents(rows) {
      if (rows.length === 0) return 0;
      await db.insert(analyticsEvents).values(
        rows.map((row) => ({
          documentId: row.documentId,
          ts: row.ts,
          type: row.type,
          sessionHash: row.sessionHash,
          blockId: row.blockId,
          props: row.props,
        })),
      );
      return rows.length;
    },

    async listEvents(documentId, range, types) {
      const conditions = [
        eq(analyticsEvents.documentId, documentId),
        gte(analyticsEvents.ts, range.from),
        lt(analyticsEvents.ts, range.to),
      ];
      if (types && types.length > 0) {
        conditions.push(inArray(analyticsEvents.type, [...types]));
      }
      const rows = await db
        .select()
        .from(analyticsEvents)
        .where(and(...conditions))
        .orderBy(analyticsEvents.ts);
      return rows.map((row) => ({
        documentId: row.documentId,
        ts: row.ts,
        type: row.type as AnalyticsEventType,
        sessionHash: row.sessionHash,
        blockId: row.blockId,
        props: (row.props ?? null) as Record<string, unknown> | null,
      }));
    },

    async listDaily(documentId, fromDay, toDay) {
      const rows = await db
        .select()
        .from(analyticsDaily)
        .where(
          and(
            eq(analyticsDaily.documentId, documentId),
            gte(analyticsDaily.day, fromDay),
            lt(analyticsDaily.day, nextDayKey(toDay)),
          ),
        )
        .orderBy(analyticsDaily.day);
      return rows.map((row) => ({
        documentId: row.documentId,
        day: row.day,
        views: row.views,
        starts: row.starts,
        completes: row.completes,
      }));
    },

    // Idempotency guarantee: REPLACE the counters with the recomputed values
    // (excluded.*) — never increment. See packages/core/src/analytics/rollup.ts.
    async upsertDaily(rows) {
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK);
        await db
          .insert(analyticsDaily)
          .values(chunk)
          .onConflictDoUpdate({
            target: [analyticsDaily.documentId, analyticsDaily.day],
            set: {
              views: sql`excluded.views`,
              starts: sql`excluded.starts`,
              completes: sql`excluded.completes`,
            },
          });
      }
    },

    async listDocumentIdsWithEvents(range) {
      const rows = await db
        .selectDistinct({ documentId: analyticsEvents.documentId })
        .from(analyticsEvents)
        .where(and(gte(analyticsEvents.ts, range.from), lt(analyticsEvents.ts, range.to)));
      return rows.map((row) => row.documentId);
    },

    async ensureParentTable() {
      await db.execute(sql.raw(ANALYTICS_EVENTS_PARENT_DDL));
      await db.execute(sql.raw(ANALYTICS_EVENTS_INDEX_DDL));
    },

    async ensurePartitions(plan) {
      for (const item of plan) {
        await db.execute(sql.raw(partitionCreateDDL("analytics_events", item)));
      }
    },

    async executeSql(statement) {
      return db.execute(sql.raw(statement));
    },
  };
  return repo;
}

export type AnalyticsRepository = ReturnType<typeof createAnalyticsRepository>;

/** `toDay` is an inclusive day key — convert to an exclusive upper bound. */
function nextDayKey(day: string): string {
  const utc = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return new Date(utc + 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Composition-root helpers (Next.js route/page + worker registration)
// ---------------------------------------------------------------------------

/** Build a repository over a fresh pg Pool (caller owns the pool lifecycle). */
export function createDefaultAnalyticsRepository(databaseUrl: string): AnalyticsRepository {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool);
  return createAnalyticsRepository(db);
}

/**
 * Process-wide lazy singleton reading DATABASE_URL.
 * Returns null when analytics storage is not configured (dev without Postgres)
 * so callers can degrade gracefully.
 */
export function getDefaultAnalyticsRepository(): AnalyticsRepository | null {
  const globalStore = globalThis as typeof globalThis & {
    __formforgeAnalyticsRepo?: AnalyticsRepository;
  };
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  globalStore.__formforgeAnalyticsRepo ??= createDefaultAnalyticsRepository(databaseUrl);
  return globalStore.__formforgeAnalyticsRepo;
}
