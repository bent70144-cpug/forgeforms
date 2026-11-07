// T-B4 — Undo toast tests (builder spec §6.4: delete → 8 s undo toast, no
// confirm dialog, logic warning for referenced blocks).
// Static-render smoke for the view + fake-timer unit tests for the timing
// controller (node env — no DOM, no real timers).

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCK_DELETED_EVENT,
  UNDO_TOAST_MS,
  UndoToast,
  UndoToastView,
  createUndoToastController,
} from "./UndoToast";
import { BuilderProvider } from "./context";

describe("<UndoToastView> (static smoke)", () => {
  it("renders the deleted label, an Undo action, and polite live-region semantics", () => {
    const html = renderToStaticMarkup(
      h(UndoToastView, { label: "Email address", hadLogic: false, onUndo: () => {}, onDismiss: () => {} }),
    );
    expect(html).toContain("Deleted Email address");
    expect(html).toContain("Undo");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("ff-undo-toast");
    expect(html).not.toContain("logic rules"); // no warning when hadLogic=false
  });

  it("shows the logic warning with a ../logic link when hadLogic is set (§6.4)", () => {
    const html = renderToStaticMarkup(
      h(UndoToastView, { label: "Pick one", hadLogic: true, onUndo: () => {}, onDismiss: () => {} }),
    );
    expect(html).toContain("Used by logic rules");
    expect(html).toContain("../logic");
    expect(html).toContain("Logic");
  });
});

describe("<UndoToast> (wired)", () => {
  it("renders null until a ff:block-deleted event arrives (no DOM needed for first paint)", () => {
    // Static render never runs effects, so no listeners, no toast: null-ish.
    const html = renderToStaticMarkup(
      h(BuilderProvider, { docId: "test-doc", children: h(UndoToast, {}) }),
    );
    expect(html).toBe("");
    expect(BLOCK_DELETED_EVENT).toBe("ff:block-deleted");
  });
});

describe("createUndoToastController (8 s timing contract)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    const states: Array<{ label: string; hadLogic: boolean } | null> = [];
    let undos = 0;
    const controller = createUndoToastController({
      onState: (s) => states.push(s),
      onUndo: () => {
        undos += 1;
      },
    });
    return { controller, states, undos: () => undos };
  }

  it("auto-dismisses after 8 s", () => {
    const { controller, states } = make();
    controller.handleDeleted({ label: "Email address", hadLogic: false });
    expect(states.at(-1)).toEqual({ label: "Email address", hadLogic: false });

    vi.advanceTimersByTime(UNDO_TOAST_MS - 1);
    expect(states.at(-1)).not.toBeNull(); // still visible at 7999 ms
    vi.advanceTimersByTime(1);
    expect(states.at(-1)).toBeNull(); // gone at 8 s
  });

  it("a second delete replaces the toast and resets the timer (one toast at a time)", () => {
    const { controller, states } = make();
    controller.handleDeleted({ label: "First", hadLogic: false });
    vi.advanceTimersByTime(UNDO_TOAST_MS - 500);

    controller.handleDeleted({ label: "Second", hadLogic: true });
    expect(states.at(-1)).toEqual({ label: "Second", hadLogic: true });

    vi.advanceTimersByTime(UNDO_TOAST_MS - 500);
    expect(states.at(-1)).not.toBeNull(); // old timer did not fire
    vi.advanceTimersByTime(500);
    expect(states.at(-1)).toBeNull(); // reset timer fired exactly once
  });

  it("undo fires the callback exactly once and hides immediately", () => {
    const { controller, states, undos } = make();
    controller.handleDeleted({ label: "Pick one", hadLogic: true });
    controller.undo();
    expect(undos()).toBe(1);
    expect(states.at(-1)).toBeNull();
    vi.advanceTimersByTime(UNDO_TOAST_MS * 2);
    expect(undos()).toBe(1); // timer cleared, no double-undo
  });

  it("dismiss hides without undoing; undo on empty toast is a no-op; destroy cleans up", () => {
    const { controller, states, undos } = make();
    controller.handleDeleted({ label: "Text", hadLogic: false });
    controller.dismiss();
    expect(states.at(-1)).toBeNull();
    expect(undos()).toBe(0);

    controller.undo(); // nothing visible
    expect(undos()).toBe(0);

    controller.handleDeleted({ label: "Text", hadLogic: false });
    controller.destroy();
    vi.advanceTimersByTime(UNDO_TOAST_MS * 2);
    expect(states.at(-1)).toBeNull(); // destroyed: timer never fires
  });
});
