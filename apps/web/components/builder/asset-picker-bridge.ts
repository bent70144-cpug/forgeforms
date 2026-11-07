'use client';

// §10 asset-picker bridge — any builder surface can request an image pick and
// BuilderPage hosts the ONE <AssetPicker/> modal that answers it:
//
//   requesters                              host (BuilderPage)
//   -----------                              ------------------
//   question-editor-kit seam   ─┐
//   DocSettings OG row         ─┼─ requestAssetPick() → CustomEvent ──► useAssetPicker
//   (future: hero, section bg) ─┘   (promise pends)      "ff:open-asset-picker"  ► open modal
//                                                          ► close/select settleAssetPicker()
//
// Same window-event posture as the block picker ("ff:open-picker"): the
// requester and the host never need to share props/context. One pick at a
// time — a superseded request resolves with null (the modal shows the latest).
//
// The blocks-package seam is registered HERE at module load: the builder
// always imports this module (via BuilderPage → useAssetPicker), so question
// editors can open the modal from anywhere in the settings panel.

import { setAssetPickerOpener, type AssetPickResult } from "@formforge/blocks";

/** Event name — keep in sync with useAssetPicker. */
export const OPEN_ASSET_PICKER_EVENT = "ff:open-asset-picker";

export type OpenAssetPickerDetail = {
  /** Target prop can store alt text → the modal shows the §10 alt prompt. */
  supportsAlt?: boolean;
};

let pendingResolve: ((result: AssetPickResult | null) => void) | null = null;

/** Open the hosted AssetPicker; resolves with the pick, or null on cancel. */
export function requestAssetPick(options?: OpenAssetPickerDetail): Promise<AssetPickResult | null> {
  return new Promise((resolve) => {
    // One modal at a time: a superseded request resolves with null.
    if (pendingResolve) pendingResolve(null);
    pendingResolve = resolve;
    if (typeof window === "undefined") {
      // Non-browser safety (the builder is client-only): never dangle.
      pendingResolve = null;
      resolve(null);
      return;
    }
    window.dispatchEvent(
      new CustomEvent<OpenAssetPickerDetail>(OPEN_ASSET_PICKER_EVENT, { detail: options ?? {} }),
    );
  });
}

/** Host side: settle the pending request (pick or cancel) exactly once. */
export function settleAssetPicker(result: AssetPickResult | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(result);
}

// Blocks-kit seam → this bridge (registered once at module load; the kit's
// Image row and the gallery editor's Add image… button go through here).
setAssetPickerOpener((options) => requestAssetPick(options));
