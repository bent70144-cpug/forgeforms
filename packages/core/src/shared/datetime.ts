// Shared kernel: datetime parsing (spec §4/§10.3).
//
// ISSUE #30: moved verbatim from the retired core `bridge.ts` — the ingest
// service (and any other plane that accepts client-supplied ISO datetimes)
// parses with this helper instead of hand-rolling `Date.parse` checks.

/** Parse an ISO datetime string; returns null when invalid. */
export function parseIsoDate(value: string): Date | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}
