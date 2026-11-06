'use client';

// Block-picker open-state hook (builder spec §6.1).
//
// Owns WHERE the next block is inserted ({index, parentId}) and whether the
// <BlockPicker/> modal is open. Wave-3 wiring: the builder page renders
//
//   const picker = useBlockPicker();
//   <BlockPicker open={picker.open} insertAt={picker.insertAt}
//                onClose={picker.close} />
//   useShortcuts(); // emits the "ff:open-picker" event below
//
// ---------------------------------------------------------------------------
// WINDOW EVENT CONTRACT (emitter: useShortcuts — Cmd/Ctrl+K and "/")
// ---------------------------------------------------------------------------
// `window` CustomEvent "ff:open-picker" with detail:
//   { index?: number; parentId?: string | null }
//   - index omitted  → append at the END of the root block list.
//   - parentId       → insert into that container's children (null = root).
// The hook also exposes openPicker() directly for canvas "+" insertion lines
// (spec §5.3) so they don't need to round-trip through the DOM event.

import { useCallback, useEffect, useRef, useState } from "react";
import { useBuilder } from "./context";

export type PickerTarget = { index: number; parentId: string | null };

/** Event name — see the contract comment above. Keep in sync with useShortcuts. */
export const OPEN_PICKER_EVENT = "ff:open-picker";

export type OpenPickerDetail = { index?: number; parentId?: string | null };

// Module-level open flag so useShortcuts' global Escape handler can yield to
// the picker (§6.5: "Esc — the picker handles itself; else deselect"). Pure
// module state, defaults to false in non-browser/test environments.
let pickerOpen = false;

/** True while a BlockPicker mounted via useBlockPicker is open. */
export function isBlockPickerOpen(): boolean {
  return pickerOpen;
}

export function useBlockPicker() {
  const { state } = useBuilder();
  const [open, setOpen] = useState(false);
  const [insertAt, setInsertAt] = useState<PickerTarget>({ index: 0, parentId: null });

  // Latest root length without re-subscribing the window listener on every doc
  // change (spec §6.1: picker opened with no target appends at the end).
  const rootCountRef = useRef(state.body.blocks.length);
  rootCountRef.current = state.body.blocks.length;

  const openPicker = useCallback((at?: Partial<PickerTarget>) => {
    // Omitted index → append at the end of the root list; omitted parentId → root.
    setInsertAt({
      index: at?.index ?? rootCountRef.current,
      parentId: at?.parentId !== undefined ? at.parentId : null,
    });
    pickerOpen = true;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    pickerOpen = false;
    setOpen(false);
  }, []);

  useEffect(() => {
    function onOpenPicker(event: Event) {
      const detail = (event as CustomEvent<OpenPickerDetail>).detail ?? {};
      openPicker({ index: detail.index, parentId: detail.parentId ?? null });
    }
    window.addEventListener(OPEN_PICKER_EVENT, onOpenPicker);
    return () => window.removeEventListener(OPEN_PICKER_EVENT, onOpenPicker);
  }, [openPicker]);

  return { open, insertAt, openPicker, close };
}
