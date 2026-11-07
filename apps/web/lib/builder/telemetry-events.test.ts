// Tests for the §15 builder instrumentation seams (follow-up #9):
// telemetryDispatch (block_added/deleted/moved, undo/redo, nothing on typing)
// and withAutosaveTelemetry (autosave_ok {opsCount, ms} / autosave_error
// {status}). Pure node tests — the capture sink replaces the whole pipeline.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  telemetryDispatch,
  trackEditorAction,
  withAutosaveTelemetry,
} from "./telemetry-events";
import { ConflictError, OpRejectedError, TransportError, type DocumentTransport } from "./transport";
import { setTelemetrySink, type TelemetryEvent } from "../telemetry";
import { emptyBody, type Op } from "./ops";
import type { EditorAction } from "./store";
import type { DocumentEnvelope } from "../bridge";

afterEach(() => {
  setTelemetrySink(null);
  vi.restoreAllMocks();
});

/** Capture sink → flat list of events. */
function capture(): TelemetryEvent[] {
  const events: TelemetryEvent[] = [];
  setTelemetrySink((event, props) => events.push({ event, props }));
  return events;
}

function applyAction(ops: readonly Op[]): EditorAction {
  return { type: "apply", ops, label: "test" };
}

const envelope: DocumentEnvelope = {
  id: "doc1",
  rev: 1,
  title: "T",
  slug: "t",
  status: "draft",
  type: "form",
  body: emptyBody("form"),
};

describe("trackEditorAction — mutation vocabulary (§15)", () => {
  it("emits block_added {kind} for block.insert ops (picker/quick-insert/paste/duplicate)", () => {
    const events = capture();
    trackEditorAction(
      applyAction([{ op: "block.insert", index: 0, block: { id: "b1", kind: "short-text", props: { label: "Name" } } }]),
    );
    expect(events).toEqual([{ event: "block_added", props: { kind: "short-text" } }]);
  });

  it("emits one block_added per inserted block for multi-op applies (paste)", () => {
    const events = capture();
    trackEditorAction(
      applyAction([
        { op: "block.insert", index: 0, block: { id: "b1", kind: "hero", props: {} } },
        { op: "block.insert", index: 1, block: { id: "b2", kind: "rating", props: {} } },
      ]),
    );
    expect(events).toEqual([
      { event: "block_added", props: { kind: "hero" } },
      { event: "block_added", props: { kind: "rating" } },
    ]);
  });

  it("emits bare block_deleted for block.remove and bare block_moved for block.move", () => {
    const events = capture();
    trackEditorAction(applyAction([{ op: "block.remove", id: "b1" }]));
    trackEditorAction(applyAction([{ op: "block.move", id: "b1", parentId: null, index: 2 }]));
    expect(events).toEqual([
      { event: "block_deleted", props: {} },
      { event: "block_moved", props: {} },
    ]);
  });

  it("emits NOTHING for typing ops (block.update) — no per-keystroke events", () => {
    const events = capture();
    trackEditorAction(
      applyAction([{ op: "block.update", id: "b1", props: { label: "Typed a char" } }]),
    );
    trackEditorAction(
      applyAction([
        { op: "block.update", id: "b1", props: { label: "a" } },
        { op: "block.update", id: "b1", props: { label: "ab" } },
      ]),
    );
    expect(events).toEqual([]);
  });

  it("emits undo / redo for the history actions", () => {
    const events = capture();
    trackEditorAction({ type: "undo" });
    trackEditorAction({ type: "redo" });
    expect(events).toEqual([
      { event: "undo", props: {} },
      { event: "redo", props: {} },
    ]);
  });

  it("emits nothing for selection/panel/load/save actions", () => {
    const events = capture();
    trackEditorAction({ type: "select", id: "b1" });
    trackEditorAction({ type: "setPanel", panel: "block" });
    trackEditorAction({ type: "saveStatus", status: "saved", at: 1 });
    expect(events).toEqual([]);
  });
});

describe("telemetryDispatch — the single dispatch seam", () => {
  it("forwards the action to the reducer AND emits the matching event", () => {
    const events = capture();
    const forwarded: EditorAction[] = [];
    const dispatch = telemetryDispatch((action) => forwarded.push(action));

    dispatch(applyAction([{ op: "block.remove", id: "b1" }]));

    expect(forwarded).toHaveLength(1);
    expect(events).toEqual([{ event: "block_deleted", props: {} }]);
  });

  it("forwards exactly once per dispatch and wraps (never replaces) the raw fn", () => {
    const events = capture();
    const raw = vi.fn();
    const dispatch = telemetryDispatch(raw);

    dispatch(applyAction([{ op: "block.move", id: "b1", parentId: null, index: 1 }]));
    dispatch({ type: "select", id: "b1" });

    expect(raw).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ event: "block_moved", props: {} }]);
  });
});

describe("withAutosaveTelemetry — autosave completion points", () => {
  function transportWith(patchImpl: DocumentTransport["patch"]): DocumentTransport {
    return {
      load: async () => envelope,
      patch: patchImpl,
    };
  }

  it("emits autosave_ok {opsCount, ms} on a successful PATCH", async () => {
    const events = capture();
    const wrapped = withAutosaveTelemetry(
      transportWith(async () => ({ rev: 7 })),
    );
    const result = await wrapped.patch("doc1", 6, [{ op: "block.remove", id: "b1" }]);
    expect(result).toEqual({ rev: 7 });
    expect(events).toEqual([{ event: "autosave_ok", props: { opsCount: 1, ms: expect.any(Number) } }]);
    expect((events[0]?.props as { ms: number }).ms).toBeGreaterThanOrEqual(0);
  });

  it("reports the HTTP status on failures: autosave_error {status}", async () => {
    const events = capture();
    const wrapped = withAutosaveTelemetry(
      transportWith(async () => {
        throw new TransportError("INTERNAL", "boom", 503);
      }),
    );
    await expect(wrapped.patch("doc1", 6, [])).rejects.toBeInstanceOf(TransportError);
    expect(events).toEqual([{ event: "autosave_error", props: { status: "503" } }]);
  });

  it("reports network failures as autosave_error {status:'network'}", async () => {
    const events = capture();
    const wrapped = withAutosaveTelemetry(
      transportWith(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(wrapped.patch("doc1", 6, [])).rejects.toBeInstanceOf(TypeError);
    expect(events).toEqual([{ event: "autosave_error", props: { status: "network" } }]);
  });

  it("treats 409/422 as handled paths — conflict/422 emit no autosave_error", async () => {
    const events = capture();
    const wrapped = withAutosaveTelemetry(
      transportWith(async (_docId, _rev, ops) => {
        void ops;
        throw new ConflictError(9, "stale");
      }),
    );
    await expect(wrapped.patch("doc1", 6, [])).rejects.toBeInstanceOf(ConflictError);
    expect(events).toEqual([]);

    const events2 = capture();
    const wrapped2 = withAutosaveTelemetry(
      transportWith(async () => {
        throw new OpRejectedError(0, "VALIDATION", "bad op");
      }),
    );
    await expect(wrapped2.patch("doc1", 6, [])).rejects.toBeInstanceOf(OpRejectedError);
    expect(events2).toEqual([]);
  });

  it("passes load through unwrapped and preserves the optional publish method", async () => {
    const publish = vi.fn(async () => ({ status: "published" as const }));
    const events = capture();
    const wrapped = withAutosaveTelemetry({
      load: async () => envelope,
      patch: async () => ({ rev: 2 }),
      publish,
    });
    await wrapped.load("doc1");
    expect(events).toEqual([]);
    await wrapped.publish?.("doc1");
    expect(publish).toHaveBeenCalledWith("doc1");
    expect(events).toEqual([]);
  });
});
