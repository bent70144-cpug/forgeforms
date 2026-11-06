// Pure unit tests for the settings panel helpers (builder spec §6.6, §9, §13).
// Node env; the debounce controller is driven with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "@formforge/schema";
import {
  MAX_NOTIFY_EMAILS,
  SLUG_PATTERN,
  collectPrefillParams,
  copyTextToClipboard,
  createDebouncedSender,
  datetimeLocalToUtcIso,
  isValidEmail,
  isValidPrefillParam,
  isValidSlug,
  normalizeEmailList,
  prefillParamConflict,
  sensitiveLabelWarning,
  utcIsoToDatetimeLocal,
  validateEmailDraft,
} from "./settings-helpers";

function block(id: string, kind: string, props: Record<string, unknown>, children?: Block[]): Block {
  return { id, kind, props, ...(children ? { children } : {}) };
}

describe("slug validation (§6.6: [a-z0-9-], 3–60 chars)", () => {
  it("accepts lowercase letters, digits and hyphens within 3–60 chars", () => {
    expect(isValidSlug("my-form")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a".repeat(60))).toBe(true);
    expect(SLUG_PATTERN.test("feedback-2024")).toBe(true);
  });

  it("rejects uppercase, spaces, slashes and other noise", () => {
    expect(isValidSlug("My-Form")).toBe(false);
    expect(isValidSlug("my form")).toBe(false);
    expect(isValidSlug("my/form")).toBe(false);
    expect(isValidSlug("my_form")).toBe(false);
    expect(isValidSlug("café")).toBe(false);
  });

  it("rejects lengths outside 3–60", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(61))).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});

describe("email validation (§6.6 Notifications: max 10)", () => {
  it("accepts pragmatic addresses and rejects the rest", () => {
    expect(isValidEmail("team@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.io")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
  });

  it("normalizes: trims, drops empties, dedupes case-insensitively", () => {
    expect(normalizeEmailList([" a@Example.com ", "", "A@example.com", "b@x.io"])).toEqual([
      "a@Example.com",
      "b@x.io",
    ]);
    expect(normalizeEmailList([])).toEqual([]);
  });

  it("validateEmailDraft: ok / invalid / duplicate / limit", () => {
    expect(validateEmailDraft(" new@x.io ", ["old@x.io"])).toEqual({ ok: true, email: "new@x.io" });
    expect(validateEmailDraft("not-an-email", [])).toMatchObject({ ok: false, reason: "invalid" });
    expect(validateEmailDraft("", [])).toMatchObject({ ok: false, reason: "empty" });
    expect(validateEmailDraft("OLD@x.io", ["old@x.io"])).toMatchObject({ ok: false, reason: "duplicate" });
  });

  it("caps the list at 10 (entitlement unknown → document max, §24 note)", () => {
    const full = Array.from({ length: MAX_NOTIFY_EMAILS }, (_, i) => `p${i + 1}@x.io`);
    expect(full).toHaveLength(10);
    expect(validateEmailDraft("extra@x.io", full)).toMatchObject({ ok: false, reason: "limit" });
    expect(validateEmailDraft("extra@x.io", full.slice(0, 9)).ok).toBe(true);
  });
});

describe("prefill param (§9.1: pattern + unique within doc)", () => {
  it("accepts the schema pattern ^[A-Za-z][A-Za-z0-9_-]{0,63}$", () => {
    expect(isValidPrefillParam("utm_source")).toBe(true);
    expect(isValidPrefillParam("Campaign-Id")).toBe(true);
    expect(isValidPrefillParam("a")).toBe(true);
    expect(isValidPrefillParam("1st")).toBe(false); // must start with a letter
    expect(isValidPrefillParam("has space")).toBe(false);
    expect(isValidPrefillParam("x".repeat(65))).toBe(false);
  });

  it("collects params from nested children", () => {
    const blocks = [
      block("q1", "short-text", { prefillParam: "name" }),
      block("sec", "section", {}, [block("q2", "email", { prefillParam: "name" }), block("q3", "email", {})]),
    ];
    expect(collectPrefillParams(blocks).get("name")).toEqual(["q1", "q2"]);
  });

  it("flags conflicts with OTHER blocks only", () => {
    const blocks = [
      block("q1", "short-text", { prefillParam: "name" }),
      block("sec", "section", {}, [block("q2", "email", { prefillParam: "mail" })]),
    ];
    expect(prefillParamConflict("name", blocks, "q1")).toBeNull(); // self
    expect(prefillParamConflict("name", blocks, "q9")).toBe("q1");
    expect(prefillParamConflict("mail", blocks, "q1")).toBe("q2");
    expect(prefillParamConflict("free", blocks, "q1")).toBeNull();
    expect(prefillParamConflict("", blocks, "q1")).toBeNull(); // clearing is always fine
  });
});

describe("sensitive-label heuristic (§8.2 SENSITIVE_FIELD, warning only)", () => {
  it("warns for password / credit card / card number labels", () => {
    expect(sensitiveLabelWarning("Your password")).toMatch(/sensitive data/);
    expect(sensitiveLabelWarning("Credit card number")).toMatch(/credit card/);
    expect(sensitiveLabelWarning("Card Number")).toMatch(/card number/);
    expect(sensitiveLabelWarning("enter_ssn_here")).toMatch(/ssn/);
  });

  it("stays quiet for ordinary labels", () => {
    expect(sensitiveLabelWarning("What is your name?")).toBeNull();
    expect(sensitiveLabelWarning("Email address")).toBeNull();
    expect(sensitiveLabelWarning(undefined)).toBeNull();
    expect(sensitiveLabelWarning("")).toBeNull();
  });
});

describe("copyTextToClipboard", () => {
  it("resolves false silently when the async Clipboard API is unavailable", async () => {
    await expect(copyTextToClipboard("blk_1")).resolves.toBe(false);
  });
});

describe("closeAt ⇄ datetime-local (§6.6 Limits)", () => {
  it("round-trips an ISO instant through the local datetime-local string", () => {
    const iso = "2030-06-15T12:30:00.000Z";
    const local = utcIsoToDatetimeLocal(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(datetimeLocalToUtcIso(local)).toEqual({ ok: true, iso });
    expect(utcIsoToDatetimeLocal(undefined)).toBe("");
    expect(utcIsoToDatetimeLocal("not-a-date")).toBe("");
  });

  it("maps empty → delete token and garbage → inline error", () => {
    expect(datetimeLocalToUtcIso("")).toEqual({ ok: true, iso: null });
    expect(datetimeLocalToUtcIso("nonsense")).toEqual({ ok: false });
  });
});

describe("createDebouncedSender (§13: 300 ms text debounce, latest wins)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the delay with the LATEST pushed value", () => {
    const send = vi.fn();
    const sender = createDebouncedSender<string>(send, 300);
    sender.push("a");
    sender.push("b");
    sender.push("c");
    expect(sender.pendingValue).toBe("c");
    vi.advanceTimersByTime(299);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("c");
    expect(sender.pendingValue).toBeNull();
  });

  it("re-arms the timer on every push (constant typing never fires)", () => {
    const send = vi.fn();
    const sender = createDebouncedSender<string>(send, 300);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(250);
      sender.push(`v${i}`);
    }
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("v9");
  });

  it("flush fires immediately and exactly once, cancel drops the pending value", () => {
    const send = vi.fn();
    const sender = createDebouncedSender<string>(send, 300);
    sender.push("now");
    sender.flush();
    expect(send).toHaveBeenCalledWith("now");
    expect(sender.pendingValue).toBeNull();
    sender.flush(); // no-op when idle
    expect(send).toHaveBeenCalledTimes(1);

    sender.push("dropped");
    sender.cancel();
    expect(sender.pendingValue).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("works with injected timers (no reliance on globals)", () => {
    let callback: (() => void) | null = null;
    const schedule = vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(500);
      callback = fn;
      return "handle";
    });
    const cancelTimer = vi.fn();
    const send = vi.fn();
    const sender = createDebouncedSender<number>(send, 500, schedule, cancelTimer);
    sender.push(42);
    sender.push(43);
    expect(schedule).toHaveBeenCalledTimes(2);
    expect(cancelTimer).toHaveBeenCalledWith("handle");
    // Cast defeats TS's closure-unaware narrowing (assigned inside vi.fn).
    (callback as unknown as () => void)();
    expect(send).toHaveBeenCalledWith(43);
  });
});
