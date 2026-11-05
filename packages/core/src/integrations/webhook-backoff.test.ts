// Backoff schedule math — T17 (issue #17) acceptance: "Failing webhook endpoint
// retried on the exact backoff schedule". Base schedule is exact; jitter is
// bounded and deterministic under an injected source.
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_JITTER_FRACTION,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_MAX_CONSECUTIVE_FAILURES,
  WEBHOOK_RETRY_BACKOFF_MS,
  baseRetryDelayMs,
  computeRetryDelayMs,
  shouldDisableEndpoint,
} from "./webhook-backoff";

const MINUTE = 60_000;

describe("backoff schedule", () => {
  it("is exactly 1m, 5m, 30m, 2h, 12h per spec §12", () => {
    expect([...WEBHOOK_RETRY_BACKOFF_MS]).toEqual([1 * MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * 60 * MINUTE, 12 * 60 * MINUTE]);
  });

  it("returns the exact base delay for attempts 0..4", () => {
    expect(baseRetryDelayMs(0)).toBe(60_000);
    expect(baseRetryDelayMs(1)).toBe(300_000);
    expect(baseRetryDelayMs(2)).toBe(1_800_000);
    expect(baseRetryDelayMs(3)).toBe(7_200_000);
    expect(baseRetryDelayMs(4)).toBe(43_200_000);
  });

  it("returns null when the retry budget is spent (initial + 5 retries = 6 attempts)", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(6);
    expect(baseRetryDelayMs(5)).toBeNull();
    expect(baseRetryDelayMs(-1)).toBeNull();
  });
});

describe("computeRetryDelayMs (jitter bounds)", () => {
  it("yields the exact base delay when jitter source returns 0", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(computeRetryDelayMs(attempt, () => 0)).toBe(baseRetryDelayMs(attempt));
    }
  });

  it("stays within [base, base * (1 + WEBHOOK_JITTER_FRACTION)) for extreme jitter", () => {
    const low = () => 0;
    const high = () => 1 - Number.EPSILON;
    const randomish = () => 0.7357;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const base = baseRetryDelayMs(attempt) as number;
      const ceil = Math.round(base * (1 + WEBHOOK_JITTER_FRACTION));
      const dLow = computeRetryDelayMs(attempt, low) as number;
      const dHigh = computeRetryDelayMs(attempt, high) as number;
      const dRandom = computeRetryDelayMs(attempt, randomish) as number;
      expect(dLow).toBeGreaterThanOrEqual(base);
      expect(dHigh).toBeLessThan(base * (1 + WEBHOOK_JITTER_FRACTION) + 1);
      expect(dHigh).toBeLessThanOrEqual(ceil);
      expect(dRandom).toBeGreaterThanOrEqual(base);
      expect(dRandom).toBeLessThan(ceil);
    }
  });

  it("never schedules a retry past the budget", () => {
    expect(computeRetryDelayMs(5, () => 0)).toBeNull();
  });

  it("defaults to Math.random without throwing and stays in bounds", () => {
    const delay = computeRetryDelayMs(2);
    expect(delay).not.toBeNull();
    expect(delay as number).toBeGreaterThanOrEqual(1_800_000);
    expect(delay as number).toBeLessThanOrEqual(Math.round(1_800_000 * 1.1));
  });
});

describe("shouldDisableEndpoint (auto-disable after 10 consecutive failures)", () => {
  it("is false for 0..9 consecutive failures", () => {
    for (let n = 0; n < WEBHOOK_MAX_CONSECUTIVE_FAILURES; n += 1) {
      expect(shouldDisableEndpoint(n)).toBe(false);
    }
  });

  it("is true at exactly 10 and beyond", () => {
    expect(shouldDisableEndpoint(WEBHOOK_MAX_CONSECUTIVE_FAILURES)).toBe(true);
    expect(shouldDisableEndpoint(25)).toBe(true);
  });
});
