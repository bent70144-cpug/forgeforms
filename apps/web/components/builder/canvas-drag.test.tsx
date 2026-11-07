// §6.2 follow-up #7 — pointer drag reorder flow tests (jsdom + act, same
// harness pattern as a11y.test.tsx: BuilderProvider initialState seam, a
// state probe child, real DOM events). jsdom has no layout, so the sibling
// card rects are stubbed per element; the pointer events are real
// PointerEvents (jsdom ≥ 25 supports the constructor).
// @vitest-environment jsdom
import { act } from "react";
import { createElement as h, useEffect, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Block } from "@formforge/schema";
import type { DocumentEnvelope } from "@/lib/bridge";
import { DEFAULT_THEME_TOKENS } from "@/lib/bridge";
import { initialEditorState, type EditorState } from "@/lib/builder/store";
import { ANNOUNCE_EVENT } from "@/lib/builder/announce";
import { DRAG_SOURCE_CLASS } from "./useDragReorder";
import { BuilderProvider, useBuilder } from "./context";
import { Canvas } from "./Canvas";
import { useShortcuts } from "./useShortcuts";

// React 19: act() requires the test environment to opt in explicitly.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures + harness
// ---------------------------------------------------------------------------

function question(id: string, label: string): Block {
  return { id, kind: "short-text", props: { label, placeholder: "", required: false } };
}

function envelope(blocks: Block[]): DocumentEnvelope {
  return {
    id: "doc_drag",
    rev: 4,
    title: "Drag fixture form",
    status: "draft",
    type: "form",
    body: {
      schemaVersion: 1,
      type: "form",
      theme: {
        tokens: { ...DEFAULT_THEME_TOKENS },
        fontHeading: "Inter",
        fontBody: "Inter",
        radius: "md",
      },
      settings: {
        seo: {},
        locale: "en",
        progressBar: true,
        autoAdvance: true,
        showBranding: true,
        captcha: false,
        notifyEmails: [],
      },
      blocks,
      endings: [],
      logic: { rules: [] },
    },
  };
}

function seededState(env: DocumentEnvelope, selection: string | null): EditorState {
  return {
    ...initialEditorState(env.id),
    ready: true,
    mode: "mock",
    meta: { title: env.title },
    body: env.body,
    docStatus: env.status,
    rev: env.rev,
    selection,
  };
}

type Sink = { current: EditorState | null };

function StateProbe({ sink }: { sink: Sink }) {
  const { state } = useBuilder();
  useEffect(() => {
    sink.current = state;
  });
  return null;
}

function ShortcutsFixture() {
  useShortcuts(); // real page wiring: Esc must keep beating "Esc deselects"
  return null;
}

// Every mount registers its own cleanup — popped by the afterEach below.
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function mountCanvas(opts: { blocks: Block[]; selection?: string | null; withShortcuts?: boolean }) {
  const env = envelope(opts.blocks);
  const sink: Sink = { current: null };
  const container = document.createElement("div");
  document.body.append(container);
  let root: Root | null = null;
  const children: ReactNode[] = [h(Canvas, { key: "canvas" }), h(StateProbe, { key: "probe", sink })];
  if (opts.withShortcuts) children.push(h(ShortcutsFixture, { key: "shortcuts" }));

  function Harness() {
    const initial = useMemo(() => seededState(env, opts.selection ?? null), [env]);
    return h(BuilderProvider, { docId: env.id, initialState: initial, children });
  }

  act(() => {
    root = createRoot(container);
    root.render(h(Harness));
  });

  cleanups.push(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  return {
    container,
    state: (): EditorState => {
      if (!sink.current) throw new Error("state probe never ran");
      return sink.current;
    },
  };
}

// jsdom has no layout — stub the geometry the drag math consumes.
type CardRect = { top: number; height: number };

function stubRect(el: Element, top: number, height: number): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: top,
      left: 0,
      right: 720,
      width: 720,
      top,
      bottom: top + height,
      height,
      toJSON: () => ({}),
    }),
  });
}

function stubGeometry(container: HTMLElement, cards: Record<string, CardRect>): void {
  const root = container.querySelector('[data-testid="builder-canvas"]');
  if (!root) throw new Error("canvas root not mounted");
  stubRect(root, 0, 1000);
  const column = root.firstElementChild;
  if (!column) throw new Error("canvas content column missing");
  stubRect(column, 0, 1000);
  for (const [id, rect] of Object.entries(cards)) {
    const card = container.querySelector(`[data-block-id="${id}"]`);
    if (!card) throw new Error(`card ${id} not mounted`);
    stubRect(card, rect.top, rect.height);
  }
}

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
}

function firePointer(el: Element, type: string, init: PointerEventInit): void {
  act(() => {
    el.dispatchEvent(pointerEvent(type, init));
  });
}

function fireWindow(type: string, init: PointerEventInit): void {
  act(() => {
    window.dispatchEvent(pointerEvent(type, init));
  });
}

function captureAnnounces(): { messages: string[] } {
  const messages: string[] = [];
  const onAnnounce = (event: Event): void => {
    const detail = (event as CustomEvent<{ message: string }>).detail;
    if (detail && typeof detail.message === "string") messages.push(detail.message);
  };
  window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
  cleanups.push(() => window.removeEventListener(ANNOUNCE_EVENT, onAnnounce));
  return { messages };
}

function handleOf(container: HTMLElement, id: string): Element {
  const handle = container.querySelector(`[data-drag-handle="${id}"]`);
  if (!handle) throw new Error(`drag handle for ${id} not mounted`);
  return handle;
}

function cardOf(container: HTMLElement, id: string): Element {
  const card = container.querySelector(`[data-block-id="${id}"]`);
  if (!card) throw new Error(`card ${id} not mounted`);
  return card;
}

function indicator(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="drop-indicator"]');
}

const THREE = [
  question("q1", "First question"),
  question("q2", "Second question"),
  question("q3", "Third question"),
];

const RECTS = {
  q1: { top: 0, height: 100 },
  q2: { top: 100, height: 100 },
  q3: { top: 200, height: 100 },
};

function dragTo(id: string, toX: number, toY: number, container: HTMLElement, from = { x: 10, y: 150 }): void {
  firePointer(handleOf(container, id), "pointerdown", {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  fireWindow("pointermove", { pointerId: 1, clientX: toX, clientY: toY });
  fireWindow("pointerup", { pointerId: 1, clientX: toX, clientY: toY });
}

// ---------------------------------------------------------------------------
// Flow tests
// ---------------------------------------------------------------------------

describe("canvas pointer drag (§6.2 follow-up #7)", () => {
  it("drag-drop dispatches exactly ONE block.move op through canvas-ops and announces the move", () => {
    const mounted = mountCanvas({ blocks: THREE, selection: "q2" });
    const { messages } = captureAnnounces();
    stubGeometry(mounted.container, RECTS);

    dragTo("q2", 12, 30, mounted.container); // release above q1's midpoint (slot 0)

    const state = mounted.state();
    expect(state.body.blocks.map((b) => b.id)).toEqual(["q2", "q1", "q3"]);
    // exactly ONE op, ONE history entry, through the existing path:
    expect(state.history.past).toHaveLength(1);
    const entry = state.history.past[0]!;
    expect(entry.ops).toEqual([{ op: "block.move", id: "q2", parentId: null, index: 0 }]);
    expect(entry.label).toBe("Move block");
    expect(entry.coalesceKey).toBe("move:q2");
    // §6.2/§12 announce via the shared seam (same contract as Alt+↑/↓):
    expect(messages).toEqual(["Second question moved to position 1 of 3"]);
    // chrome cleaned up after the drop:
    expect(indicator(mounted.container)).toBeNull();
    expect(cardOf(mounted.container, "q2").classList.contains(DRAG_SOURCE_CLASS)).toBe(false);
    expect(document.body.style.userSelect).toBe("");
  });

  it("renders the drop indicator line between blocks while dragging (then removes it)", () => {
    const mounted = mountCanvas({ blocks: THREE, selection: "q2" });
    stubGeometry(mounted.container, RECTS);
    const handle = handleOf(mounted.container, "q2");

    // tap (no movement) → no drag, no indicator, no dispatch
    firePointer(handle, "pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 150,
    });
    fireWindow("pointerup", { pointerId: 1, clientX: 10, clientY: 150 });
    expect(indicator(mounted.container)).toBeNull();
    expect(mounted.state().history.past).toHaveLength(0);

    // below the ~8 px activation constraint → still no indicator
    firePointer(handle, "pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 150,
    });
    fireWindow("pointermove", { pointerId: 1, clientX: 13, clientY: 154 });
    expect(indicator(mounted.container)).toBeNull();
    fireWindow("pointerup", { pointerId: 1, clientX: 13, clientY: 154 });
    expect(mounted.state().history.past).toHaveLength(0);

    // activated → indicator between blocks with the measured gap position
    firePointer(handle, "pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 150,
    });
    fireWindow("pointermove", { pointerId: 1, clientX: 30, clientY: 280 }); // lower half of q3
    const line = indicator(mounted.container);
    expect(line).not.toBeNull();
    expect(line!.getAttribute("data-drop-slot")).toBe("3");
    expect((line as HTMLElement).style.top).toBe("300px"); // below q3
    expect(cardOf(mounted.container, "q2").classList.contains(DRAG_SOURCE_CLASS)).toBe(true);
    expect(document.body.style.userSelect).toBe("none");

    // drop at the end gap → q2 moves down exactly one slot
    fireWindow("pointerup", { pointerId: 1, clientX: 30, clientY: 280 });
    const entry = mounted.state().history.past[0]!;
    expect(entry.ops).toEqual([{ op: "block.move", id: "q2", parentId: null, index: 2 }]);
    expect(mounted.state().body.blocks.map((b) => b.id)).toEqual(["q1", "q3", "q2"]);
    expect(indicator(mounted.container)).toBeNull();
  });

  it("Esc cancels a drag mid-flight without dispatching anything (and keeps the selection)", () => {
    const mounted = mountCanvas({ blocks: THREE, selection: "q2", withShortcuts: true });
    const { messages } = captureAnnounces();
    stubGeometry(mounted.container, RECTS);

    firePointer(handleOf(mounted.container, "q2"), "pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 150,
    });
    fireWindow("pointermove", { pointerId: 1, clientX: 12, clientY: 30 });
    expect(indicator(mounted.container)).not.toBeNull();

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    const state = mounted.state();
    expect(state.history.past).toHaveLength(0);
    expect(state.body.blocks.map((b) => b.id)).toEqual(["q1", "q2", "q3"]);
    // capture-phase guard beat useShortcuts' §6.5 "Esc deselects":
    expect(state.selection).toBe("q2");
    expect(messages).toEqual([]);
    expect(indicator(mounted.container)).toBeNull();
    expect(cardOf(mounted.container, "q2").classList.contains(DRAG_SOURCE_CLASS)).toBe(false);
    expect(document.body.style.userSelect).toBe("");
  });

  it("suppresses the post-drag click, then re-arms on the next pointerdown", () => {
    const mounted = mountCanvas({ blocks: THREE, selection: "q2" });
    stubGeometry(mounted.container, RECTS);

    dragTo("q2", 12, 30, mounted.container);
    expect(mounted.state().body.blocks.map((b) => b.id)).toEqual(["q2", "q1", "q3"]);

    // the release-click must not select whatever card sits under the pointer
    act(() => {
      cardOf(mounted.container, "q3").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(mounted.state().selection).toBe("q2");

    // a fresh gesture re-arms clicks: tap q1 → selects it
    firePointer(cardOf(mounted.container, "q1"), "pointerdown", {
      pointerId: 2,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: 5,
      clientY: 50,
    });
    fireWindow("pointerup", { pointerId: 2, clientX: 5, clientY: 50 });
    act(() => {
      cardOf(mounted.container, "q1").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(mounted.state().selection).toBe("q1");
  });

  it("keeps the keyboard/toolbar move path working (regression) — same op path, own label", () => {
    const mounted = mountCanvas({ blocks: THREE, selection: "q2" });
    const { messages } = captureAnnounces();

    const moveUp = mounted.container.querySelector('[data-block-id="q2"] [aria-label="Move up"]');
    if (!moveUp) throw new Error("Move up button not mounted");
    act(() => {
      moveUp.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const entry = mounted.state().history.past[0]!;
    expect(entry.ops).toEqual([{ op: "block.move", id: "q2", parentId: null, index: 0 }]);
    expect(entry.label).toBe("Move up");
    expect(entry.coalesceKey).toBe("move:q2");
    expect(messages).toEqual(["Second question moved to position 1 of 3"]);
  });

  it("drags a nested child within its container and sets parentId on the op", () => {
    const nested: Block[] = [
      {
        id: "sec1",
        kind: "section",
        props: { background: "none", padding: "md" },
        children: [question("q2", "Nested one"), question("q3", "Nested two")],
      },
    ];
    const mounted = mountCanvas({ blocks: nested, selection: "q2" });
    stubGeometry(mounted.container, {
      sec1: { top: 0, height: 400 },
      q2: { top: 100, height: 100 },
      q3: { top: 200, height: 100 },
    });

    dragTo("q2", 12, 280, mounted.container); // lower half of q3

    const entry = mounted.state().history.past[0]!;
    expect(entry.ops).toEqual([{ op: "block.move", id: "q2", parentId: "sec1", index: 1 }]);
    const sec1 = mounted.state().body.blocks[0]!;
    expect(sec1.children?.map((c) => c.id)).toEqual(["q3", "q2"]);
  });
});
