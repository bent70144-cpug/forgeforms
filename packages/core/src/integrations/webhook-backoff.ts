// Webhook retry backoff (spec §12) — T17 (issue #17). PURE, unit-tested.
//
// Schedule pinned by spec §12 / issue #17: 1m, 5m, 30m, 2h, 12h — i.e. 5
// retries after the initial attempt (6 attempts max per event+endpoint).
// Jitter is multiplicative so the base schedule stays verifiable:
//   delay = base(attempt) * (1 + WEBHOOK_JITTER_FRACTION * jitter())
// with jitter() ∈ [0, 1) → delay ∈ [base, 1.1 * base).
export const WEBHOOK_RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;

/** Initial attempt (0) + 5 retries. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_BACKOFF_MS.length + 1;

/** ±0 % lower bound, +10 % upper bound of the multiplicative jitter. */
export const WEBHOOK_JITTER_FRACTION = 0.1;

/** A webhook endpoint auto-disables after this many consecutive failed attempts (issue #17). */
export const WEBHOOK_MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Exact base delay before retrying `attempt` (0-based). Returns null once the
 * retry budget is spent (attempt >= WEBHOOK_MAX_ATTEMPTS - 1). Pure.
 */
export function baseRetryDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  if (attempt >= WEBHOOK_RETRY_BACKOFF_MS.length) return null;
  return WEBHOOK_RETRY_BACKOFF_MS[attempt] ?? null;
}

/**
 * Retry delay with jitter. `jitter` defaults to Math.random; tests inject a
 * deterministic source. Returns null when no further retry is scheduled. Pure.
 */
export function computeRetryDelayMs(attempt: number, jitter: () => number = Math.random): number | null {
  const base = baseRetryDelayMs(attempt);
  if (base === null) return null;
  const sample = Math.min(Math.max(jitter(), 0), 1 - Number.EPSILON);
  return Math.round(base * (1 + WEBHOOK_JITTER_FRACTION * sample));
}

/** True once `consecutiveFailures` reached the auto-disable threshold. Pure. */
export function shouldDisableEndpoint(consecutiveFailures: number): boolean {
  return consecutiveFailures >= WEBHOOK_MAX_CONSECUTIVE_FAILURES;
}
