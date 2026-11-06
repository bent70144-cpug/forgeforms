"use client";

// packages/blocks — `form-embed` public renderer (client-interactive).
//
// Parent side of the ff:* postMessage protocol for a nested embed:
//   1. Renders the child iframe (/embed/:documentId — the T22 embed shell).
//   2. Listens for {ff:height} from that iframe and grows/shrinks to fit.
//   3. Forwards {ff:height} and {ff:complete:submissionToken} one level up
//      (postToEmbedParent) when this page is itself embedded, so completion
//      bubbles to the outermost host loader.
// OWNED BY T21 (issue #21).
import { useEffect, useRef, useState, type FC } from "react";
import type { RenderProps } from "../registry";
import {
  FF_COMPLETE,
  FF_HEIGHT,
  attachEmbedEventListeners,
  postToEmbedParent,
} from "../shared/embed-protocol";
import { embedFrameSrc, type FormEmbedProps } from "./schema";

const DEFAULT_EMBED_HEIGHT = 480;
const MIN_EMBED_HEIGHT = 120;
const MAX_EMBED_HEIGHT = 20000;

function clampHeight(value: number): number {
  return Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, Math.round(value)));
}

export const FormEmbedRender: FC<RenderProps<FormEmbedProps>> = ({ props }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(DEFAULT_EMBED_HEIGHT);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null) return;
    const detach = attachEmbedEventListeners(window, iframe.contentWindow, {
      onHeight: (value) => {
        const clamped = clampHeight(value);
        setHeight(clamped);
        postToEmbedParent({ type: FF_HEIGHT, value: clamped });
      },
      onComplete: (submissionToken) => {
        postToEmbedParent({ type: FF_COMPLETE, submissionToken });
      },
    });
    return detach;
  }, [props.documentId]);

  return (
    <div className="ff-form-embed" data-block-kind="form-embed" data-document-id={props.documentId}>
      <iframe
        ref={iframeRef}
        className="ff-form-embed__frame"
        src={embedFrameSrc(props.documentId)}
        title="Embedded FormForge form"
        style={{ width: "100%", height, border: 0 }}
        loading="lazy"
      />
    </div>
  );
};
