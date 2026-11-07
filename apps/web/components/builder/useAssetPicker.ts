'use client';

// §10 asset-picker host hook — BuilderPage mounts ONE <AssetPicker/> modal and
// wires it through this hook. Requests arrive as "ff:open-asset-picker" window
// events (asset-picker-bridge: question-editor-kit seam, DocSettings OG row),
// and the modal answers the pending promise via settleAssetPicker.

import { useCallback, useEffect, useState } from "react";
import type { AssetPickResult } from "@formforge/blocks";
import {
  OPEN_ASSET_PICKER_EVENT,
  settleAssetPicker,
  type OpenAssetPickerDetail,
} from "./asset-picker-bridge";

/** What the hosted modal needs to know about the current target prop. */
export type AssetPickerRequest = {
  /** Show the §10 alt-text step before resolving. */
  supportsAlt: boolean;
};

export function useAssetPicker() {
  const [request, setRequest] = useState<AssetPickerRequest | null>(null);

  // Window event contract (emitter: asset-picker-bridge.requestAssetPick).
  useEffect(() => {
    function onOpenPicker(event: Event) {
      const detail = ((event as CustomEvent<OpenAssetPickerDetail>).detail ?? {}) as OpenAssetPickerDetail;
      setRequest({ supportsAlt: detail.supportsAlt === true });
    }
    window.addEventListener(OPEN_ASSET_PICKER_EVENT, onOpenPicker);
    return () => window.removeEventListener(OPEN_ASSET_PICKER_EVENT, onOpenPicker);
  }, []);

  const close = useCallback(() => {
    settleAssetPicker(null);
    setRequest(null);
  }, []);

  const select = useCallback((result: AssetPickResult) => {
    settleAssetPicker(result);
    setRequest(null);
  }, []);

  return { request, close, select };
}
