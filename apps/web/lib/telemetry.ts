// §15 telemetry — privacy-safe batched sink (builder audit follow-up #9).
//
// §15 pins the event vocabulary (`builder_opened`, `block_added {kind}`,
// `autosave_ok {opsCount, ms}`, …) and the privacy rule: include ids/counts
// only, NEVER labels, answers or props. The vocabulary + its closed per-event
// prop shapes are enforced server-side by TelemetryBatchSchema
// (@formforge/schema/api → POST /api/telemetry); this module documents the
// rule and never serializes anything beyond `{ event, props }` pairs.
//
// Sink design (all failure paths swallowed — telemetry must never break the
// UI):
//   • `track(event, props)` enqueues the event into a module-level batch
//     queue; the queue flushes ~10 s after the first queued event or when it
//     reaches 20 events, whichever comes first, via `fetch(..., keepalive)`.
//   • on `pagehide` the tail is delivered with `navigator.sendBeacon`
//     (keepalive-fetch fallback when the beacon is unavailable/rejected).
//   • delivery failures are silent: the batch is dropped, never retried, and
//     nothing is ever thrown into the caller.
//   • no-op when there is no `window` (SSR/static render) and in tests
//     (NODE_ENV=test) — the module stays observable: dev builds keep the old
//     `[ff-telemetry]` console.debug line alongside the network flush.
//   • test/DI seams: `setTelemetrySink` replaces the whole pipeline with a
//     synchronous capture sink (component-level tests); `setTelemetryDelivery`
//     swaps only the network call so batching/flush/beacon stay live under
//     test. Both `null` restores the default pipeline (and resets the queue).
//
// Callers own privacy: props must be `{id}`, `{kind}`, `{count}`-shaped (§15).
// The server rejects anything else with 422.

export type TelemetryProps = Record<string, string | number | boolean>;

export type TelemetryEvent = { event: string; props: TelemetryProps };

/** Synchronous capture sink (test/DI seam) — replaces the whole pipeline. */
export type TelemetrySink = (event: string, props: TelemetryProps) => void;

/** Network seam — receives the drained batch (test/DI seam or real fetch). */
export type TelemetryDelivery = (batch: readonly TelemetryEvent[]) => Promise<void>;

export const TELEMETRY_PREFIX = "[ff-telemetry]";

/** Same-origin collector — see apps/web/app/api/telemetry/route.ts. */
export const TELEMETRY_ENDPOINT = "/api/telemetry";

/** Flush cadence: ~10 s after the first queued event… */
export const TELEMETRY_FLUSH_INTERVAL_MS = 10_000;
/** …or when 20 events have queued up, whichever comes first. */
export const TELEMETRY_FLUSH_MAX_EVENTS = 20;

// ---------------------------------------------------------------------------
// Module state (one queue per browser session; HMR re-evaluations re-create
// the module and lose at most one unflushed batch — acceptable for telemetry)
// ---------------------------------------------------------------------------

let injectedSink: TelemetrySink | null = null;
let injectedDelivery: TelemetryDelivery | null = null;
let queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pagehideHandler: (() => void) | null = null;

/** Replace the whole pipeline with a synchronous sink (or restore with null). */
export function setTelemetrySink(sink: TelemetrySink | null): void {
  injectedSink = sink;
  if (sink !== null) resetQueue();
}

/** Replace only the network delivery (or restore the fetch/keepalive with null). */
export function setTelemetryDelivery(deliver: TelemetryDelivery | null): void {
  injectedDelivery = deliver;
  if (deliver === null) resetQueue();
}

function resetQueue(): void {
  queue = [];
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pagehideHandler !== null && typeof window !== "undefined") {
    window.removeEventListener("pagehide", pagehideHandler);
  }
  pagehideHandler = null;
}

// ---------------------------------------------------------------------------
// track
// ---------------------------------------------------------------------------

/**
 * Emit a §15 telemetry event. Batches into the sink queue (see module docs).
 * Never throws: caller mistakes (missing props) surface as server 422s that
 * the sink swallows.
 */
export function track(event: string, props: TelemetryProps = {}): void {
  // Direct capture (tests / alternate sinks): bypass every gate by design.
  const sink = injectedSink;
  if (sink !== null) {
    sink(event, props);
    return;
  }
  // SSR/static render: no-op (no timers, no navigator, nothing to flush to).
  if (typeof window === "undefined") return;
  // Tests: silent unless a delivery was explicitly injected for a sink test.
  const isTest = process.env.NODE_ENV === "test";
  if (isTest && injectedDelivery === null) return;
  // Dev visibility without network noise in the console… (kept from the stub)
  if (process.env.NODE_ENV === "development") {
    console.debug(`${TELEMETRY_PREFIX} ${event}`, props);
  }
  enqueue({ event, props });
}

// ---------------------------------------------------------------------------
// Queue → flush → beacon pipeline
// ---------------------------------------------------------------------------

function enqueue(event: TelemetryEvent): void {
  queue.push(event);
  if (queue.length >= TELEMETRY_FLUSH_MAX_EVENTS) {
    void flushTelemetry();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushTelemetry();
    }, TELEMETRY_FLUSH_INTERVAL_MS);
  }
  installPagehide();
}

/**
 * Drain the queue through the delivery seam (fetch keepalive by default).
 * Resolves `true` when the batch was handed off successfully, `false` when
 * delivery failed — failures are swallowed (logged nowhere, thrown nowhere).
 */
export async function flushTelemetry(): Promise<boolean> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return true;
  const batch = queue.splice(0, queue.length);
  return deliverBatch(batch);
}

async function deliverBatch(batch: readonly TelemetryEvent[]): Promise<boolean> {
  const deliver = injectedDelivery ?? defaultDelivery;
  try {
    await deliver(batch);
    return true;
  } catch {
    // Telemetry must never break the UI: drop the batch silently (§15 sink).
    return false;
  }
}

/** keepalive so an in-flight flush survives page unload. */
function defaultDelivery(batch: readonly TelemetryEvent[]): Promise<void> {
  return fetch(TELEMETRY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: batch }),
    keepalive: true,
  }).then((res) => {
    if (!res.ok) throw new Error(`${TELEMETRY_PREFIX} flush failed with ${res.status}`);
  });
}

/** Install the one-time-per-session `pagehide` tail flush (beacon first). */
function installPagehide(): void {
  if (pagehideHandler !== null) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  pagehideHandler = () => {
    try {
      flushTailViaBeacon();
    } catch {
      // Same rule as everywhere else: never throw out of telemetry.
    }
  };
  window.addEventListener("pagehide", pagehideHandler);
}

/** pagehide tail: navigator.sendBeacon, keepalive-fetch fallback, silent. */
function flushTailViaBeacon(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const payload = JSON.stringify({ events: batch });
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    // Blob + explicit type keeps the POST `application/json` for the collector.
    const sent = navigator.sendBeacon(
      TELEMETRY_ENDPOINT,
      new Blob([payload], { type: "application/json" }),
    );
    if (sent) return; // accepted by the browser — nothing else to do
  }
  // sendBeacon unavailable or rejected the payload → keepalive fetch fallback.
  void fetch(TELEMETRY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Unload is already happening — nowhere left to report; stay silent.
  });
}
