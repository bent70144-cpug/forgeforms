// @formforge/core — beacon payload validation + normalization (spec §10.1
// `POST /api/public/a` "Analytics beacon batch", issue #19).
//
// Privacy rules (spec §4 logging, §13, issue #19): the beacon NEVER sets or
// reads cookies, the client only sends an opaque anonymous visitor id, and the
// server stores a sha256 hash of it. IPs are never read or stored.

import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../shared/errors.ts";
import { err, ok } from "../shared/result.ts";
import { type Result } from "../shared/result.ts";
import { ANALYTICS_EVENT_TYPES } from "./types";
import type { AnalyticsEventType, RawAnalyticsEvent } from "./types";

export const BEACON_MAX_EVENTS = 500;
/** Public document ids are opaque (`uuid` or prefixed short form, spec §4). */
export const DOCUMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Opaque client-generated anonymous visitor/session id (e.g. uuidv7). */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

const BeaconEventSchema = z.object({
  type: z.enum(ANALYTICS_EVENT_TYPES),
  sessionId: z.string().regex(SESSION_ID_RE),
  blockId: z.string().min(1).max(128).nullish(),
  props: z.record(z.string(), z.unknown()).nullish(),
  ts: z.iso.datetime().nullish(),
});

export const BeaconBatchSchema = z.object({
  documentId: z.string().regex(DOCUMENT_ID_RE),
  events: z.array(BeaconEventSchema).min(1).max(BEACON_MAX_EVENTS),
});

export type BeaconBatchInput = z.infer<typeof BeaconBatchSchema>;

/** sha256 hex of the anonymous visitor id — deterministic, never reversible. */
export function hashSessionId(rawSessionId: string): string {
  return createHash("sha256").update(rawSessionId, "utf8").digest("hex");
}

export interface BeaconQueryInput {
  documentId?: string;
  type?: string;
  sessionId?: string;
  blockId?: string;
}

/**
 * Build a single normalized event from GET-pixel query params.
 * Returns null for anything missing/invalid — pixel beacons must never error
 * out (broken-image beacons are common), they are silently dropped instead.
 */
export function buildPixelEvent(input: BeaconQueryInput, now: () => Date): RawAnalyticsEvent | null {
  const { documentId, type, sessionId, blockId } = input;
  if (!documentId || !sessionId || !DOCUMENT_ID_RE.test(documentId) || !SESSION_ID_RE.test(sessionId)) {
    return null;
  }
  if (type !== undefined && !isEventType(type)) return null;
  const eventType: AnalyticsEventType = type ?? "view";
  return {
    documentId,
    ts: now(),
    type: eventType,
    sessionHash: hashSessionId(sessionId),
    blockId: blockId && blockId.length <= 128 ? blockId : null,
    props: null,
  };
}

function isEventType(value: string): value is AnalyticsEventType {
  return (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Validate + normalize a beacon batch. Pure: `now` is injected (spec §4), the
 * session id is hashed here so raw ids never reach storage.
 */
export function parseBeaconBatch(input: unknown, now: () => Date): Result<{ documentId: string; events: RawAnalyticsEvent[] }> {
  const parsed = BeaconBatchSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new AppError(
        "VALIDATION",
        "Invalid analytics beacon batch",
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      ),
    );
  }
  const documentId = parsed.data.documentId;
  const events: RawAnalyticsEvent[] = parsed.data.events.map((event) => ({
    documentId,
    ts: event.ts ? new Date(event.ts) : now(),
    type: event.type,
    sessionHash: hashSessionId(event.sessionId),
    blockId: event.blockId ?? null,
    props: event.props ?? null,
  }));
  return ok({ documentId, events });
}
