// Privacy-safe telemetry stub (spec §15 — "no content").
//
// §15 pins the event vocabulary (`builder_opened`, `template_used {id}`,
// `ai_applied {opsCount}`, …) and the privacy rule: include ids/counts only,
// NEVER labels, answers or props. Until a real collector ships this module is
// a no-op sink: events are visible in the dev console (gated off in production
// builds so test/staging output stays inspectable and prod stays silent).
//
// The sink is injectable (`track(event, props, sink)`) so unit tests can
// capture calls without touching `console`. Callers own privacy: this module
// documents the rule but does not filter prop values (§15 payloads in this
// codebase are `{id}`, `{kind}`, `{opsCount}`-shaped by convention).

export type TelemetryProps = Record<string, string | number>;

/** Minimal surface of `console` used — injectable for tests. */
export type TelemetrySink = Pick<Console, "debug">;

export const TELEMETRY_PREFIX = "[ff-telemetry]";

/**
 * Emit a §15 telemetry event. No-op in production; `console.debug` otherwise
 * (dev/test visibility without network I/O). Never throws on missing props.
 */
export function track(
  event: string,
  props?: TelemetryProps,
  sink: TelemetrySink = console,
): void {
  if (process.env.NODE_ENV === "production") return;
  sink.debug(`${TELEMETRY_PREFIX} ${event}`, props ?? {});
}
