// Telemetry batch schemas (builder audit follow-up #9, spec §15 vocabulary).
//
// PRIVACY RULE (§15): events carry ids/counts/status-shaped fields ONLY —
// NEVER labels, answers, props or any document content. The schemas below
// enforce that server-side:
//   • the event name comes from a strict allowlist (the §15 vocabulary);
//   • every event's props are a closed, per-event shape (`.strict()`) — any
//     extra key (content-looking or not) fails validation;
//   • string fields are pattern- + length-capped tokens (ids/kinds/statuses);
//     numeric fields are bounded non-negative integers.
//
// Consumers: apps/web/app/api/telemetry/route.ts (validation) — the client
// sink (apps/web/lib/telemetry.ts) deliberately stays dependency-free and
// documents this contract in comments instead of importing it.
import { z } from "zod";

/** The §15 event vocabulary (builder surface + the two pre-existing events). */
export const TELEMETRY_EVENTS = [
  "builder_opened",
  "template_used",
  "ai_applied",
  "block_added",
  "block_deleted",
  "block_moved",
  "undo",
  "redo",
  "autosave_ok",
  "autosave_error",
  "conflict",
  "publish_attempt",
  "publish_ok",
  "preview_opened",
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];
export const TelemetryEventNameSchema = z.enum(TELEMETRY_EVENTS);

/** Id/kind-shaped token: conservative charset + 64-char cap (no free text). */
export const TelemetryTokenSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/, "must be an id/kind-shaped token (no free text)");

/** Status-shaped token (save-state / HTTP status / "network"): ≤ 32 chars. */
export const TelemetryStatusSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/, "must be a status-shaped token");

/** Bounded non-negative integer (counts, durations). */
export const TelemetryCountSchema = z.number().int().min(0).max(1_000_000);

// ---------------------------------------------------------------------------
// Per-event props — closed shapes; `.strict()` rejects any extra key.
// ---------------------------------------------------------------------------

/** Events with no properties at all (or an empty object). */
const EmptyProps = z.object({}).strict();
const KindProps = z.object({ kind: TelemetryTokenSchema }).strict();
const IdProps = z.object({ id: TelemetryTokenSchema }).strict();
const OpsCountProps = z.object({ opsCount: TelemetryCountSchema }).strict();
/** autosave_ok {opsCount, ms} — §15 names exactly these two fields. */
const AutosaveOkProps = z
  .object({ opsCount: TelemetryCountSchema, ms: TelemetryCountSchema })
  .strict();
const StatusProps = z.object({ status: TelemetryStatusSchema }).strict();
const ResolvedProps = z.object({ resolved: z.boolean() }).strict();
const IssuesProps = z.object({ issues: TelemetryCountSchema }).strict();

function eventSchema<Event extends TelemetryEventName, P extends z.ZodType>(
  name: Event,
  props: P,
): z.ZodObject<{ event: z.ZodLiteral<Event>; props: z.ZodOptional<P> }> {
  return z.object({ event: z.literal(name), props: props.optional() }).strict();
}

function eventSchemaRequiredProps<Event extends TelemetryEventName, P extends z.ZodType>(
  name: Event,
  props: P,
): z.ZodObject<{ event: z.ZodLiteral<Event>; props: P }> {
  return z.object({ event: z.literal(name), props }).strict();
}

/**
 * One telemetry event. Discriminated on `event` so validation errors name the
 * exact vocabulary member and props are validated against that member's
 * closed shape only.
 */
export const TelemetryEventSchema = z.discriminatedUnion("event", [
  eventSchema("builder_opened", EmptyProps),
  eventSchema("template_used", IdProps),
  eventSchema("ai_applied", OpsCountProps),
  eventSchemaRequiredProps("block_added", KindProps),
  eventSchema("block_deleted", EmptyProps),
  eventSchema("block_moved", EmptyProps),
  eventSchema("undo", EmptyProps),
  eventSchema("redo", EmptyProps),
  eventSchemaRequiredProps("autosave_ok", AutosaveOkProps),
  eventSchemaRequiredProps("autosave_error", StatusProps),
  eventSchemaRequiredProps("conflict", ResolvedProps),
  eventSchemaRequiredProps("publish_attempt", IssuesProps),
  eventSchema("publish_ok", EmptyProps),
  eventSchema("preview_opened", EmptyProps),
]);

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

/** Client batch: `{ events: [...] }` — capped so one request stays cheap. */
export const TELEMETRY_BATCH_MAX_EVENTS = 50;

export const TelemetryBatchSchema = z
  .object({ events: z.array(TelemetryEventSchema).min(1).max(TELEMETRY_BATCH_MAX_EVENTS) })
  .strict();

export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;
