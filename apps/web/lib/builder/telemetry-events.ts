// §15 builder telemetry — the wiring seams between the editor machinery and
// lib/telemetry.ts (builder audit follow-up #9).
//
// Where events are emitted (and deliberately where NOT):
//   • telemetryDispatch   — ONE observation point wrapped around the builder
//     dispatch (components/builder/context.tsx). It maps editor actions to the
//     mutation vocabulary (block_added / block_deleted / block_moved / undo /
//     redo). It sits OUTSIDE the reducer, and per-keystroke ops (`block.update`,
//     incl. their coalesced batches) emit nothing — §15 has no typing event.
//   • withAutosaveTelemetry — wraps the DocumentTransport's PATCH so autosave
//     completion points emit autosave_ok {opsCount, ms} / autosave_error
//     {status} with the exact request facts (op count + round-trip ms).
//   • builder_opened / preview_opened / conflict {resolved} / publish_attempt /
//     publish_ok are emitted directly at their seams (BuilderPage.tsx,
//     PublishControl.tsx).
//
// Privacy (§15): ids/counts/statuses only. Block kinds are registry names
// ("short-text"); no labels, answers or props ever reach a payload.

import type { Dispatch } from "react";
import { track } from "../telemetry";
import type { EditorAction } from "./store";
import type { Op } from "./ops";
import { ConflictError, OpRejectedError, TransportError, type DocumentTransport } from "./transport";

// ---------------------------------------------------------------------------
// Dispatch seam — editor actions → §15 mutation vocabulary
// ---------------------------------------------------------------------------

/** Map a single editor op onto its §15 event (or nothing). */
function trackOp(op: Op): void {
  switch (op.op) {
    case "block.insert":
      track("block_added", { kind: op.block.kind });
      return;
    case "block.remove":
      track("block_deleted");
      return;
    case "block.move":
      track("block_moved");
      return;
    default:
      return; // block.update / theme / settings / meta / endings — not in §15
  }
}

/**
 * Observe one editor action and emit the matching §15 events. Multi-op
 * applies (paste, AI apply, restore) emit one event per block op — honest
 * counts, bounded by the paste/insert caps. Never throws.
 */
export function trackEditorAction(action: EditorAction): void {
  try {
    switch (action.type) {
      case "undo":
        track("undo");
        return;
      case "redo":
        track("redo");
        return;
      case "apply":
        for (const op of action.ops) trackOp(op);
        return;
      default:
        return; // loaded/select/panel/saveStatus/… — nothing in the vocabulary
    }
  } catch {
    // Telemetry must never break the UI (same rule as the sink itself).
  }
}

/**
 * Wrap a raw reducer dispatch with §15 observation. Identity-stable as long
 * as `rawDispatch` is (React guarantees that for useReducer) — callers memo
 * on it so §13 memoization (React.memo cards, stable canvas callbacks) is
 * untouched.
 */
export function telemetryDispatch(raw: Dispatch<EditorAction>): Dispatch<EditorAction> {
  return (action) => {
    trackEditorAction(action);
    raw(action);
  };
}

// ---------------------------------------------------------------------------
// Autosave completion seam — transport wrapper
// ---------------------------------------------------------------------------

/** Status-shaped token for autosave_error (§15). */
function autosaveErrorStatus(err: unknown): string {
  if (err instanceof TransportError && typeof err.status === "number") return String(err.status);
  if (err instanceof TypeError) return "network"; // fetch failure / offline
  return "error";
}

/**
 * Wrap a DocumentTransport so every PATCH (the autosave flush) emits:
 *   • success → `autosave_ok {opsCount, ms}` — exact batch size + round-trip;
 *   • failure → `autosave_error {status}` — HTTP status, "network", "error".
 * ConflictError (409) and OpRejectedError (422) are NOT autosave errors: the
 * controller rebases/rolls back and the flow continues (conflicts surface via
 * `conflict {resolved}` at the BuilderPage seam), so they are re-thrown
 * untouched. `load` and `publish` pass through unwrapped.
 */
export function withAutosaveTelemetry(transport: DocumentTransport): DocumentTransport {
  const publish = transport.publish;
  return {
    load: (docId) => transport.load(docId),
    patch: async (docId, baseRev, ops) => {
      const startedAt = Date.now();
      try {
        const result = await transport.patch(docId, baseRev, ops);
        track("autosave_ok", { opsCount: ops.length, ms: Math.max(0, Date.now() - startedAt) });
        return result;
      } catch (err) {
        if (err instanceof ConflictError || err instanceof OpRejectedError) throw err;
        track("autosave_error", { status: autosaveErrorStatus(err) });
        throw err;
      }
    },
    ...(publish ? { publish: (docId: string) => publish(docId) } : {}),
  };
}
