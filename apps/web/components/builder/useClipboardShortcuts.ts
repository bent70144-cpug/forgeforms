'use client';

// Cmd/Ctrl+C / Cmd/Ctrl+V block clipboard (builder spec §6.4).
//
// Owned here (NOT in wave-1 useShortcuts) to keep that file's churn at zero:
// mounted once next to it inside <BuilderProvider>.
//
// - Copy  → the selected block's SUBTREE via copyBlocks([block]) — mirrored to
//   the system clipboard (cross-tab paste) AND the internal clipboard
//   (same-tab, works without permissions).
// - Paste → pasteBlocks() (system envelope first, internal fallback), planned
//   by lib/builder/wiring.planPasteOps: after the selected block in its own
//   list (parent's children / root), else appended at the end of the root
//   list. Ops dispatch through the normal `apply` path (label "Paste blocks",
//   undo + autosave unified) and the LAST pasted block becomes the selection.
// - Both chords respect the §6.5 ignore-while-typing rule (shouldIgnoreShortcut)
//   so text fields keep the platform copy/paste behavior.

import { useEffect, useRef } from "react";
import { copyBlocks, pasteBlocks } from "@/lib/builder/clipboard";
import { newId } from "@/lib/builder/id";
import { planCopyBlocks, planPasteOps } from "@/lib/builder/wiring";
import { shouldIgnoreShortcut } from "./useShortcuts";
import { useBuilder } from "./context";

export function useClipboardShortcuts(): void {
  const { state, dispatch } = useBuilder();
  const latest = useRef({ state });
  latest.current = { state };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey) return;
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (key !== "c" && key !== "v") return;
      if (shouldIgnoreShortcut(event.target, event)) return;

      if (key === "c") {
        const blocks = planCopyBlocks(latest.current.state);
        if (!blocks) return; // nothing selected — leave the chord alone
        event.preventDefault();
        void copyBlocks(blocks);
        return;
      }

      // Paste: preventDefault unconditionally (the card surface is not a text
      // field), then no-op when neither clipboard holds a valid envelope.
      event.preventDefault();
      void pasteBlocks().then((blocks) => {
        if (!blocks) return;
        const plan = planPasteOps(latest.current.state, blocks, newId);
        if (!plan) return;
        dispatch({ type: "apply", ops: plan.ops, label: "Paste blocks" });
        dispatch({ type: "select", id: plan.lastInsertedId });
      });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}
