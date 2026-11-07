'use client';

// Pointer/touch drag reordering for the builder canvas (builder spec §6.2 —
// audit follow-up #7): the toolbar ⠿ handle becomes a real drag handle with
// an activation constraint, drop indicator, edge auto-scroll and Esc-cancel,
// while the keyboard path (Alt+↑/↓ + toolbar arrows) stays untouched.
//
// NOTE (audit deviation, for docs/builder-audit.md §6.2): the audit text pins
// dnd-kit for this follow-up, but @dnd-kit/* is NOT in the workspace lockfile
// and dependencies are frozen — so the gesture layer is built on native
// Pointer Events with the same behaviour contract dnd-kit would give us:
//   • handle-gated dragging (~8 px activation distance) so plain clicks,
//     selection chrome and inline text editing keep working;
//   • a drop indicator line rendered by Canvas between blocks;
//   • auto-scroll of the nearest scrollable ancestor near its edges;
//   • Esc cancels mid-flight without dispatching anything;
//   • drop dispatches exactly ONE block.move op through the existing
//     canvas-ops path (CanvasActions.move → moveByOffset), so the move:<id>
//     coalescing key + undo grouping work, and the drop announces through the
//     shared announce() seam exactly like Alt+↑/↓ ("… moved to position N of M").
// Swapping in dnd-kit later only replaces this hook — the DOM contract below
// (data-drag-handle / data-block-parent) and the dispatch path stay identical.
//
// DOM CONTRACT (rendered by BlockToolbar / BlockCard / UnknownBlock):
//   [data-drag-handle="<blockId>"]  the pointer-only drag handle glyph
//   [data-drag-parent="<parentId|''>"]  list the handle belongs to ("" = root)
//   [data-drag-index="<index>"]     the handle block's index in that list
//   [data-block-parent="<parentId|''>"]  on every card: which list it is a
//     sibling of — the hook measures those elements for the drop slot.
//
// Gesture wiring is fully delegated: Canvas attaches ONE pointerdown listener
// on the canvas root and window-level move/up/cancel/Esc listeners while the
// hook is mounted, so cards never receive drag props (per-card memoization,
// spec §13, is preserved). Mouse/touch/pen all speak Pointer Events; mobile
// drag stays out of scope (§18) — the handle simply works where pointer
// events exist, and touch scrolling is unaffected outside the handle
// (`touch-action: none` on the handle only).

import { useEffect, useRef, useState, type RefObject } from "react";
import type { CanvasActions } from "@/lib/builder/canvas-ops";

/** Drag activates only after the pointer moves this far (px) — §6.2: clicks,
 * selection and inline text editing must still work. */
export const ACTIVATION_DISTANCE_PX = 8;

/** Auto-scroll engages within this many px of the scroll container edge. */
export const AUTO_SCROLL_EDGE_PX = 48;

/** Max auto-scroll speed per animation frame (px). */
export const AUTO_SCROLL_STEP_PX = 14;

/** CSS class set on the card being dragged (see globals.css). */
export const DRAG_SOURCE_CLASS = "ff-drag-source";

/** DOM attribute contract between the hook and the card chrome. */
export const DRAG_ATTRS = {
  handle: "data-drag-handle",
  parent: "data-drag-parent",
  index: "data-drag-index",
  blockParent: "data-block-parent",
} as const;

// ---------------------------------------------------------------------------
// Pure geometry helpers (exported for node tests)
// ---------------------------------------------------------------------------

export type RectLike = { top: number; bottom: number };

/** True once the pointer has travelled ≥ threshold px from the gesture start. */
export function activationReached(
  startX: number,
  startY: number,
  x: number,
  y: number,
  threshold: number = ACTIVATION_DISTANCE_PX,
): boolean {
  const dx = x - startX;
  const dy = y - startY;
  return dx * dx + dy * dy >= threshold * threshold;
}

/**
 * Drop slot (gap index into the list INCLUDING the dragged item, 0..n) →
 * `block.move` delta. block.move's index is the final position AFTER removal
 * (ops.ts), so slots after the source shift by one. slot == fromIndex and
 * slot == fromIndex + 1 both map to delta 0 (dropped where it already is).
 */
export function dropSlotToDelta(slot: number, fromIndex: number): number {
  return slot <= fromIndex ? slot - fromIndex : slot - fromIndex - 1;
}

/** Gap the pointer is over: index of the first card whose midpoint is below
 * the pointer, else the list length (after the last card). */
export function computeDropSlot(pointerY: number, rects: readonly RectLike[]): number {
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    if (pointerY < (rect.top + rect.bottom) / 2) return i;
  }
  return rects.length;
}

/**
 * Auto-scroll delta toward the nearest container edge (px per frame): ramps
 * linearly inside the edge zone, full speed past it, 0 in the middle.
 */
export function autoScrollDelta(
  pointerY: number,
  rectTop: number,
  rectBottom: number,
  edgeZone: number = AUTO_SCROLL_EDGE_PX,
  step: number = AUTO_SCROLL_STEP_PX,
): number {
  if (edgeZone <= 0 || step <= 0 || rectBottom <= rectTop) return 0;
  const fromTop = pointerY - rectTop;
  const toBottom = rectBottom - pointerY;
  if (fromTop < edgeZone && fromTop <= toBottom) {
    return -Math.round(step * Math.min(1, Math.max(0, edgeZone - fromTop) / edgeZone));
  }
  if (toBottom < edgeZone && toBottom < fromTop) {
    return Math.round(step * Math.min(1, Math.max(0, edgeZone - toBottom) / edgeZone));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Gesture bookkeeping that must be readable from window-level listeners. */
type DragRuntime = {
  pointerId: number;
  id: string;
  /** Raw parent attr value of the dragged block's list ("" = root list). */
  parentValue: string;
  fromIndex: number;
  dropSlot: number;
  pointerX: number;
  pointerY: number;
};

/** Rendered drag state consumed by Canvas (drop indicator). */
export type ActiveDrag = {
  /** Dragged block id. */
  id: string;
  /** List the drop will happen in (null = root list). */
  parentId: string | null;
  /** Gap the pointer is over (0..n in the original list). */
  dropSlot: number;
  /** Drop-line top offset in px, relative to the canvas content column. */
  indicatorTop: number;
};

export function useDragReorder({
  rootRef,
  actions,
}: {
  rootRef: RefObject<HTMLElement | null>;
  actions: CanvasActions;
}): { drag: ActiveDrag | null } {
  const [drag, setDrag] = useState<ActiveDrag | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const runtimeRef = useRef<DragRuntime | null>(null);
  const pendingRef = useRef<PendingGesture | null>(null);
  const suppressClickRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function attrEscape(value: string): string {
      return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value;
    }
    function cardById(id: string): HTMLElement | null {
      return root!.querySelector<HTMLElement>(`[data-block-id="${attrEscape(id)}"]`);
    }
    function siblingsByParent(parentValue: string): HTMLElement[] {
      return Array.from(
        root!.querySelectorAll<HTMLElement>(`[${DRAG_ATTRS.blockParent}="${attrEscape(parentValue)}"]`),
      );
    }
    /**
     * The canvas <section> and the shell <main> are both overflow-y:auto;
     * only one of them ever actually overflows. Auto-scroll targets the
     * nearest ancestor that really scrolls (jsdom: none — no-op, harmless).
     */
    function scrollContainer(): HTMLElement | null {
      let el: HTMLElement | null = root;
      while (el) {
        if (el.scrollHeight > el.clientHeight) {
          const overflowY = window.getComputedStyle(el).overflowY;
          if (overflowY === "auto" || overflowY === "scroll") return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    function setDragState(next: ActiveDrag | null): void {
      dragRef.current = next;
      setDrag(next);
    }

    function updateDrag(x: number, y: number): void {
      const rt = runtimeRef.current;
      if (!rt) return;
      rt.pointerX = x;
      rt.pointerY = y;
      const rects = siblingsByParent(rt.parentValue).map((el) => el.getBoundingClientRect());
      if (rects.length === 0) return; // stale list — keep the last slot, drop will clamp
      const slot = computeDropSlot(y, rects);
      const column = root!.firstElementChild as HTMLElement | null;
      const columnTop = column ? column.getBoundingClientRect().top : 0;
      const last = rects[rects.length - 1]!;
      const gapY = slot < rects.length ? rects[slot]!.top : last.bottom;
      const next: ActiveDrag = {
        id: rt.id,
        parentId: rt.parentValue === "" ? null : rt.parentValue,
        dropSlot: slot,
        indicatorTop: gapY - columnTop,
      };
      rt.dropSlot = slot;
      const prev = dragRef.current;
      if (
        !prev ||
        prev.id !== next.id ||
        prev.dropSlot !== next.dropSlot ||
        prev.indicatorTop !== next.indicatorTop
      ) {
        setDragState(next);
      }
    }

    function autoScrollTick(): void {
      rafRef.current = null;
      const rt = runtimeRef.current;
      if (!rt) return;
      const scroller = scrollContainer();
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const delta = autoScrollDelta(rt.pointerY, rect.top, rect.bottom);
        if (delta !== 0) {
          scroller.scrollTop += delta;
          updateDrag(rt.pointerX, rt.pointerY);
        }
      }
      rafRef.current = requestAnimationFrame(autoScrollTick);
    }

    function beginDrag(x: number, y: number): void {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      const card = cardById(pending.blockId);
      card?.classList.add(DRAG_SOURCE_CLASS);
      // Text selection would fight the drag (mousemove selection handles).
      document.body.style.userSelect = "none";
      runtimeRef.current = {
        pointerId: pending.pointerId,
        id: pending.blockId,
        parentValue: pending.parentValue,
        fromIndex: pending.fromIndex,
        dropSlot: pending.fromIndex,
        pointerX: x,
        pointerY: y,
      };
      updateDrag(x, y);
      rafRef.current = requestAnimationFrame(autoScrollTick);
    }

    /** Teardown shared by drop, Esc-cancel, pointercancel and unmount.
     * Committing dispatches exactly ONE block.move op through canvas-ops. */
    function endDrag(commit: boolean): void {
      const rt = runtimeRef.current;
      if (rt === null) {
        pendingRef.current = null; // tap before activation: click proceeds
        return;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const card = cardById(rt.id);
      card?.classList.remove(DRAG_SOURCE_CLASS);
      document.body.style.userSelect = "";
      runtimeRef.current = null;
      pendingRef.current = null;
      setDragState(null);
      // A drag gesture must never leak a click onto whatever element is
      // under the pointer at release (dnd-kit does the same).
      suppressClickRef.current = true;
      if (!commit) return;
      actionsRef.current.move(rt.id, dropSlotToDelta(rt.dropSlot, rt.fromIndex), {
        label: "Move block",
      });
    }

    function onPointerDown(event: PointerEvent): void {
      suppressClickRef.current = false; // new gesture re-arms clicks
      if (runtimeRef.current) return; // already dragging (multi-pointer)
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const handle = target.closest(`[${DRAG_ATTRS.handle}]`);
      if (!handle || !root!.contains(handle)) return;
      const blockId = handle.getAttribute(DRAG_ATTRS.handle);
      if (!blockId) return;
      const indexAttr = handle.getAttribute(DRAG_ATTRS.index);
      pendingRef.current = {
        pointerId: event.pointerId,
        blockId,
        parentValue: handle.getAttribute(DRAG_ATTRS.parent) ?? "",
        fromIndex: indexAttr === null ? -1 : Number(indexAttr),
        startX: event.clientX,
        startY: event.clientY,
      };
    }

    function onPointerMove(event: PointerEvent): void {
      const pending = pendingRef.current;
      if (pending) {
        if (event.pointerId !== pending.pointerId) return;
        if (!activationReached(pending.startX, pending.startY, event.clientX, event.clientY)) return;
        beginDrag(event.clientX, event.clientY);
        return;
      }
      const rt = runtimeRef.current;
      if (!rt) return;
      if (event.pointerId !== rt.pointerId) return;
      event.preventDefault(); // keep text selection / native DnD out of the drag
      updateDrag(event.clientX, event.clientY);
    }

    function onPointerUp(event: PointerEvent): void {
      const pending = pendingRef.current;
      if (pending) {
        if (event.pointerId !== pending.pointerId) return;
        pendingRef.current = null; // tap: no drag happened, click proceeds
        return;
      }
      const rt = runtimeRef.current;
      if (rt && event.pointerId === rt.pointerId) endDrag(true);
    }

    function onPointerCancel(event: PointerEvent): void {
      const pending = pendingRef.current;
      if (pending && event.pointerId === pending.pointerId) {
        pendingRef.current = null;
        return;
      }
      const rt = runtimeRef.current;
      if (rt && event.pointerId === rt.pointerId) endDrag(false);
    }

    // Capture phase so Esc beats useShortcuts' bubble-phase "Esc deselects"
    // (§6.5) while a drag is in flight.
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        suppressClickRef.current = false; // keyboard clicks stay trustworthy
        return;
      }
      if (!pendingRef.current && !runtimeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      endDrag(false);
    }

    function onClickCapture(event: MouseEvent): void {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }

    root.addEventListener("pointerdown", onPointerDown);
    // move is non-passive: the active drag preventDefaults it (text selection).
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("click", onClickCapture, true);

    return () => {
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("click", onClickCapture, true);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const rt = runtimeRef.current;
      if (rt) {
        cardById(rt.id)?.classList.remove(DRAG_SOURCE_CLASS);
        document.body.style.userSelect = "";
      }
      runtimeRef.current = null;
      pendingRef.current = null;
    };
    // The gesture layer is wired once per mount; `actions` is read through
    // actionsRef (it is memoized in Canvas, but the listeners must not be
    // re-attached per render), so the effect deliberately has no extra deps.
  }, [rootRef]);

  return { drag };
}

/** Pending gesture: pointer is down on a handle, not yet past activation. */
type PendingGesture = {
  pointerId: number;
  blockId: string;
  parentValue: string;
  fromIndex: number;
  startX: number;
  startY: number;
};
