// Settings panel helpers (builder spec §6.6, §9, §13) — pure logic + the
// debounced-patch hook. Everything here is unit-testable in the node env;
// the only React-dependent piece is useDebouncedPatch at the bottom.
//
// OWNED BY B5 settings milestone (task 6-a).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Block } from "@formforge/schema";
import { useBuilder } from "../context";
import type { Op } from "@/lib/builder/ops";

// ---------------------------------------------------------------------------
// Slug (§6.6 General: `[a-z0-9-]`, 3–60 chars)
// ---------------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

// TODO(wave 3): §6.6 also wants a slug AVAILABILITY check against the server
// (`GET /api/v1/documents/:id/slug-check?slug=…`, debounced 500 ms). The route
// does not exist yet (rg slug-check apps/web/app → no match), so the panel
// ships with client-side FORMAT validation only. When the route lands, add the
// availability probe in DocSettings next to the format check (§14: on "taken",
// show an inline error and suggest a `-2` variant).

// ---------------------------------------------------------------------------
// Emails (§6.6 Notifications: validated list, max 10)
// ---------------------------------------------------------------------------

// Pragmatic RFC-5322-lite: one @, non-empty local part, dotted domain.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

/** Entitlement cap when the plan is unknown client-side (§24: free = 1;
 * the builder has no plan surface, so §6.6's document max applies). */
export const MAX_NOTIFY_EMAILS = 10;

/** Trim entries, drop empties, dedupe case-insensitively (first wins). */
export function normalizeEmailList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value === "") continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export type EmailDraftResult =
  | { ok: true; email: string }
  | { ok: false; reason: "empty" | "invalid" | "duplicate" | "limit" };

/** Validate a candidate email being added to `existing`. */
export function validateEmailDraft(
  raw: string,
  existing: readonly string[],
  max: number = MAX_NOTIFY_EMAILS,
): EmailDraftResult {
  const value = raw.trim();
  if (value === "") return { ok: false, reason: "empty" };
  if (!isValidEmail(value)) return { ok: false, reason: "invalid" };
  if (existing.some((e) => e.toLowerCase() === value.toLowerCase())) {
    return { ok: false, reason: "duplicate" };
  }
  if (existing.length >= max) return { ok: false, reason: "limit" };
  return { ok: true, email: value };
}

// ---------------------------------------------------------------------------
// Prefill param (§9.1: pattern + unique within document)
// ---------------------------------------------------------------------------

// SCHEMA IS AUTHORITATIVE: QuestionPropsBase (packages/blocks/src/shared/
// question-props.ts) pins /^[A-Za-z][A-Za-z0-9_-]{0,63}$/. The §9 table's
// older `^[a-zA-Z][a-zA-Z0-9_]{0,31}$` quote predates the schema; validating
// against the schema pattern guarantees the panel can never emit props that
// DocumentBody rejects (spec §6.6: errors never block autosave — so they must
// never be *caused* by the panel either).
export const PREFILL_PARAM_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function isValidPrefillParam(value: string): boolean {
  return PREFILL_PARAM_PATTERN.test(value);
}

/** Every `props.prefillParam` in the document → the block ids using it
 * (recursive: containers' children count). */
export function collectPrefillParams(
  blocks: readonly Block[],
  into: Map<string, string[]> = new Map(),
): Map<string, string[]> {
  for (const block of blocks) {
    const param = block.props?.["prefillParam"];
    if (typeof param === "string" && param !== "") {
      const holders = into.get(param) ?? [];
      holders.push(block.id);
      into.set(param, holders);
    }
    if (block.children) collectPrefillParams(block.children, into);
  }
  return into;
}

/** The id of ANOTHER block using `value`, or null when the param is free
 * (§9.1 "unique within doc"). */
export function prefillParamConflict(
  value: string,
  blocks: readonly Block[],
  currentBlockId: string,
): string | null {
  if (value === "") return null;
  for (const [param, holders] of collectPrefillParams(blocks)) {
    if (param === value) {
      return holders.find((id) => id !== currentBlockId) ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sensitive-label heuristic (§8.2 `SENSITIVE_FIELD`: warning, not blocking —
// "label suggests card number or password; show the abuse-policy note").
// packages/schema validate.ts does not implement the check yet, so the panel
// runs this cheap local heuristic and renders an inline note (never blocks).
// ---------------------------------------------------------------------------

const SENSITIVE_TERMS: readonly string[] = [
  "password",
  "passwd",
  "passphrase",
  "credit card",
  "card number",
  "creditcard",
  "cvv",
  "cvc",
  "security code",
  "social security",
  "ssn",
];

/** A short warning note when the label suggests sensitive data, else null. */
export function sensitiveLabelWarning(label: string | undefined): string | null {
  if (!label) return null;
  const normalized = label.toLowerCase().replace(/[_-]+/g, " ");
  const hit = SENSITIVE_TERMS.find((term) => normalized.includes(term));
  if (!hit) return null;
  return (
    `“${label}” looks like it asks for sensitive data (${hit}). ` +
    "Make sure this matches the FormForge abuse policy and your privacy obligations."
  );
}

// ---------------------------------------------------------------------------
// Clipboard (§6.6 Advanced: block id copy, silent fallback)
// ---------------------------------------------------------------------------

/** Best-effort text copy; resolves false silently when the async Clipboard
 * API is missing or denied (tests / http contexts). */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } })
    .navigator?.clipboard;
  if (typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// closeAt ⇄ datetime-local (§6.6 Limits; stored as UTC ISO per schema)
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO datetime (UTC, schema shape) → `YYYY-MM-DDTHH:mm` for datetime-local
 * (rendered in the viewer's local timezone). "" when unset/invalid. */
export function utcIsoToDatetimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

export type DatetimeLocalParse =
  | { ok: true; /** null = the field was cleared → delete the key. */ iso: string | null }
  | { ok: false };

/** datetime-local value → ISO datetime (UTC). Empty → `{iso: null}` (delete);
 * unparseable → `{ok: false}` so the caller can show an inline error. */
export function datetimeLocalToUtcIso(value: string): DatetimeLocalParse {
  if (value === "") return { ok: true, iso: null };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, iso: date.toISOString() };
}

// ---------------------------------------------------------------------------
// Debounce plumbing (§13 "debounce text inputs", §6.6 300 ms)
// ---------------------------------------------------------------------------

export const TEXT_DEBOUNCE_MS = 300;

export type ScheduleFn = (fn: () => void, ms: number) => unknown;
export type CancelFn = (handle: unknown) => void;

export type DebouncedSender<V> = {
  /** Store `value` as the pending patch and (re)start the timer. */
  push(value: V): void;
  /** Fire the pending value NOW (no-op when nothing is pending). */
  flush(): void;
  /** Drop the pending value and stop the timer. */
  cancel(): void;
  /** The value waiting to fire, or null. */
  readonly pendingValue: V | null;
};

/**
 * Framework-free debounce (latest value wins; injectable timers so node-env
 * tests drive it with vi.useFakeTimers). On fire the CURRENT `send` receives
 * the latest pushed value.
 */
export function createDebouncedSender<V>(
  send: (value: V) => void,
  ms: number,
  schedule: ScheduleFn = (fn, delay) => setTimeout(fn, delay),
  cancelTimer: CancelFn = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
): DebouncedSender<V> {
  let timer: unknown = null;
  let pending: { value: V } | null = null;
  const fire = (): void => {
    timer = null;
    const task = pending;
    pending = null;
    if (task) send(task.value);
  };
  return {
    push(value: V): void {
      pending = { value };
      if (timer !== null) cancelTimer(timer);
      timer = schedule(fire, ms);
    },
    flush(): void {
      if (timer !== null) {
        cancelTimer(timer);
        timer = null;
      }
      fire();
    },
    cancel(): void {
      if (timer !== null) {
        cancelTimer(timer);
        timer = null;
      }
      pending = null;
    },
    get pendingValue(): V | null {
      return pending?.value ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// useDebouncedPatch (§6.6: text inputs apply ops debounced 300 ms)
// ---------------------------------------------------------------------------

export type DebouncedPatchOptions = {
  /** Delay between the last keystroke and the dispatch. Default 300 ms. */
  ms?: number;
  /** Undo-history label, e.g. "Rename document". */
  label?: string;
  /** Coalesce key (§3.3), e.g. "meta:title". NOTE: the store currently only
   * MERGES block.update/block.move ops, so for settings/meta ops the key is
   * recorded on the history entry but never merges — harmless, and it lights
   * up automatically if the coalescer gains those op types. */
  coalesceKey?: string;
};

/** Shape stored in the debounce controller (ops + history metadata snapshot). */
type PendingPatch = {
  ops: readonly Op[];
  label?: string;
  coalesceKey?: string;
};

/**
 * Draft state for debounced text fields: the input keeps typing responsive
 * (local draft) while the store only updates after the debounce fires. When
 * the store value changes for ANY other reason (undo/redo, remote merge,
 * reset), the draft re-syncs; when the debounced patch lands the re-sync is a
 * no-op (same string).
 */
export function useDraftSync(external: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(external);
  useEffect(() => {
    setDraft(external);
  }, [external]);
  return [draft, setDraft];
}

/**
 * `const pushTitle = useDebouncedPatch((v) => [{ op: "meta.update", patch: { title: v } }])`
 *
 * The op builder runs AT PUSH TIME (inside the onChange handler, against the
 * then-current block/doc) and the produced ops are snapshotted together with
 * the label/coalesce key — so a selection change between push and fire can
 * never misaddress the patch (the fire-time dispatch only takes a fresh
 * `Date.now()` for the coalesce window). Unmount FLUSHES the pending patch
 * (dispatch during cleanup) so the last keystrokes before selecting another
 * block are never lost.
 *
 * Toggles/selects must NOT use this — they dispatch immediately (§6.6).
 */
export function useDebouncedPatch(
  makeOp: (value: string) => readonly Op[],
  options: DebouncedPatchOptions = {},
): (value: string) => void {
  const { dispatch } = useBuilder();
  // Refs keep the push callback stable across renders (§13: stable props).
  const makeOpRef = useRef(makeOp);
  makeOpRef.current = makeOp;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef<DebouncedSender<PendingPatch> | null>(null);

  useEffect(() => {
    const controller = createDebouncedSender<PendingPatch>(
      (patch) => {
        dispatch({
          type: "apply",
          ops: patch.ops,
          label: patch.label,
          coalesce: patch.coalesceKey
            ? { key: patch.coalesceKey, at: Date.now() }
            : undefined,
        });
      },
      optionsRef.current.ms ?? TEXT_DEBOUNCE_MS,
    );
    controllerRef.current = controller;
    // Flush (not cancel) on unmount/deps change: pending text edits must land.
    return () => controller.flush();
  }, [dispatch]);

  return useCallback((value: string) => {
    const current = optionsRef.current;
    controllerRef.current?.push({
      ops: makeOpRef.current(value),
      label: current.label,
      coalesceKey: current.coalesceKey,
    });
  }, []);
}
