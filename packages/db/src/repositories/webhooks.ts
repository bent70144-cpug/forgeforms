// Webhooks repository — T17 (issue #17). NEW file; does NOT touch src/schema/**.
//
// INTEGRATION-DEBT: awaiting T02 — the webhook tables + drizzle client land
// with T02. Until then this repository is self-contained: parameterized SQL
// over an injected `QueryFn` + its own row types (structurally mirrored in
// apps/worker/src/ports.ts). Table name is `webhook_endpoints` per the lead
// brief (T02's DDL); spec §6 calls the same table `webhooks` — SPEC-NOTE,
// integrator reconciles the single string if T02 chose the spec name.
//
// Delivery-log rules (issue #17):
//   - every attempt (initial + retries + replays) is recorded via recordDelivery;
//   - "consecutive failures" is derived from the most recent attempts: walk
//     newest → oldest and count failures until the first success;
//   - reaching WEBHOOK_MAX_CONSECUTIVE_FAILURES (10) disables the endpoint.

// MIRROR-CONSTANT: WEBHOOK_MAX_CONSECUTIVE_FAILURES from
// @formforge/core/integrations cannot be imported here — packages/db must not
// gain a dependency on core (lead rule: deps only in worker/core package.json).
// Keep in sync with the core constant (10); the worker enforces the same
// threshold through its ports. INTEGRATION-DEBT: after T02 lands, import the
// core constant instead of mirroring.
const MAX_CONSECUTIVE_FAILURES = 10;

export type WebhookEndpointRow = {
  id: string;
  workspaceId: string;
  /** null = workspace-wide endpoint (spec §6 comment). */
  documentId: string | null;
  url: string;
  /** Reveal-once secret; never logged, only used to sign (spec §12). */
  secret: string;
  /** Subscribed event types, e.g. ["submission.completed"]. */
  events: string[];
  enabled: boolean;
  createdAt: Date;
};

export type WebhookDeliveryRow = {
  id: string;
  webhookId: string;
  eventId: string;
  /** 0-based attempt counter of the deliver job. */
  attempt: number;
  statusCode: number | null;
  ok: boolean;
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
};

export type NewWebhookDelivery = Omit<WebhookDeliveryRow, "createdAt">;

export type QueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

type RawEndpointRecord = {
  id: string;
  workspace_id: string;
  document_id: string | null;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  created_at: Date | string;
};

type RawDeliveryRecord = {
  id: string;
  webhook_id: string;
  event_id: string;
  attempt: number;
  status_code: number | null;
  ok: boolean;
  duration_ms: number | null;
  error: string | null;
  created_at: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function mapEndpointRow(record: RawEndpointRecord): WebhookEndpointRow {
  return {
    id: record.id,
    workspaceId: record.workspace_id,
    documentId: record.document_id,
    url: record.url,
    secret: record.secret,
    events: record.events,
    enabled: record.enabled,
    createdAt: toDate(record.created_at),
  };
}

export function mapDeliveryRow(record: RawDeliveryRecord): WebhookDeliveryRow {
  return {
    id: record.id,
    webhookId: record.webhook_id,
    eventId: record.event_id,
    attempt: record.attempt,
    statusCode: record.status_code,
    ok: record.ok,
    durationMs: record.duration_ms,
    error: record.error,
    createdAt: toDate(record.created_at),
  };
}

export type ListActiveEndpointsArgs = {
  workspaceId: string;
  /** Event's document; workspace-wide endpoints (document_id IS NULL) included. */
  documentId: string;
  eventType: string;
};

export type WebhooksRepository = {
  listActiveEndpoints(args: ListActiveEndpointsArgs): Promise<WebhookEndpointRow[]>;
  getEndpoint(id: string): Promise<WebhookEndpointRow | null>;
  /** Records one attempt; idempotent by primary key (ON CONFLICT DO NOTHING). */
  recordDelivery(delivery: NewWebhookDelivery): Promise<WebhookDeliveryRow | null>;
  getDelivery(id: string): Promise<WebhookDeliveryRow | null>;
  /** Delivery log for the Integrate screen — newest first. */
  listDeliveries(webhookId: string, limit?: number): Promise<WebhookDeliveryRow[]>;
  /** Newest attempts first, capped at the auto-disable window. */
  getRecentAttempts(webhookId: string): Promise<Array<{ ok: boolean }>>;
  /** Walks recent attempts and counts failures since the last success. */
  countConsecutiveFailures(webhookId: string): Promise<number>;
  /** Returns true when this call flipped enabled=true → false. */
  disableEndpoint(id: string): Promise<boolean>;
};

export function createWebhooksRepository(query: QueryFn): WebhooksRepository {
  return {
    async listActiveEndpoints(args: ListActiveEndpointsArgs): Promise<WebhookEndpointRow[]> {
      const rows = await query<RawEndpointRecord>(
        `select * from webhook_endpoints
         where workspace_id = $1
           and enabled = true
           and (document_id is null or document_id = $2)
           and $3 = any(events)`,
        [args.workspaceId, args.documentId, args.eventType],
      );
      return rows.map(mapEndpointRow);
    },

    async getEndpoint(id: string): Promise<WebhookEndpointRow | null> {
      const rows = await query<RawEndpointRecord>(`select * from webhook_endpoints where id = $1`, [id]);
      const record = rows[0];
      return record ? mapEndpointRow(record) : null;
    },

    async recordDelivery(delivery: NewWebhookDelivery): Promise<WebhookDeliveryRow | null> {
      const rows = await query<RawDeliveryRecord>(
        `insert into webhook_deliveries (id, webhook_id, event_id, attempt, status_code, ok, duration_ms, error)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do nothing
         returning *`,
        [
          delivery.id,
          delivery.webhookId,
          delivery.eventId,
          delivery.attempt,
          delivery.statusCode,
          delivery.ok,
          delivery.durationMs,
          delivery.error,
        ],
      );
      const record = rows[0];
      return record ? mapDeliveryRow(record) : null;
    },

    async getDelivery(id: string): Promise<WebhookDeliveryRow | null> {
      const rows = await query<RawDeliveryRecord>(`select * from webhook_deliveries where id = $1`, [id]);
      const record = rows[0];
      return record ? mapDeliveryRow(record) : null;
    },

    async listDeliveries(webhookId: string, limit = 50): Promise<WebhookDeliveryRow[]> {
      const rows = await query<RawDeliveryRecord>(
        `select * from webhook_deliveries
         where webhook_id = $1
         order by created_at desc
         limit $2`,
        [webhookId, limit],
      );
      return rows.map(mapDeliveryRow);
    },

    async getRecentAttempts(webhookId: string): Promise<Array<{ ok: boolean }>> {
      const rows = await query<{ ok: boolean }>(
        `select ok from webhook_deliveries
         where webhook_id = $1
         order by created_at desc
         limit $2`,
        [webhookId, MAX_CONSECUTIVE_FAILURES],
      );
      return rows.map((row) => ({ ok: row.ok === true }));
    },

    async countConsecutiveFailures(webhookId: string): Promise<number> {
      const attempts = await this.getRecentAttempts(webhookId);
      let count = 0;
      for (const attempt of attempts) {
        if (attempt.ok) break;
        count += 1;
      }
      return count;
    },

    async disableEndpoint(id: string): Promise<boolean> {
      const rows = await query<{ id: string }>(
        `update webhook_endpoints set enabled = false
         where id = $1 and enabled = true
         returning id`,
        [id],
      );
      return rows.length > 0;
    },
  };
}
