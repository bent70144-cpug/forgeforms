"use client";

// packages/blocks — `form-embed` public renderer (client-interactive).
//
// Parent side of the ff:* postMessage protocol for a nested embed:
//   1. Renders the child iframe (/embed/:documentId — the T22 embed shell).
//   2. Listens for {ff:height} from that iframe and grows/shrinks to fit
//      (heightMode "auto", the §9.2 default) or pins a fixed height
//      (heightMode "fixed" — the child scrolls internally, and ff:height is
//      not applied to our frame nor forwarded, so an outer host never chases
//      the child's content height past the authored pin).
//   3. Forwards {ff:height} and {ff:complete:submissionToken} one level up
//      (postToEmbedParent) when this page is itself embedded, so completion
//      bubbles to the outermost host loader.
// §9.2 layout modes: "inline" (classic full-width block) or "card" (centered,
// framed container). Both speak the exact same embed protocol.
// OWNED BY T21 (issue #21).
import { useEffect, useRef, useState, type CSSProperties, type FC } from "react";
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

/** §9.2 "card" layout: centered, framed container (theme-token friendly). */
const CARD_STYLE: CSSProperties = {
  maxWidth: "480px",
  marginInline: "auto",
  border: "1px solid var(--ff-border, #d6d3ce)",
  borderRadius: "12px",
  padding: "1rem",
};

export const FormEmbedRender: FC<RenderProps<FormEmbedProps>> = ({ props }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fixed = props.heightMode === "fixed";
  const [height, setHeight] = useState(
    fixed ? clampHeight(props.fixedHeight ?? DEFAULT_EMBED_HEIGHT) : DEFAULT_EMBED_HEIGHT,
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe === null) return;
    const detach = attachEmbedEventListeners(window, iframe.contentWindow, {
      onHeight: (value) => {
        const clamped = clampHeight(value);
        // §9.2 heightMode "fixed": the authored pin wins; ff:height is ignored
        // for our frame and NOT forwarded (an outer auto host must not chase
        // the child's content height past the pin). ff:complete still bubbles.
        if (props.heightMode === "fixed") return;
        setHeight(clamped);
        postToEmbedParent({ type: FF_HEIGHT, value: clamped });
      },
      onComplete: (submissionToken) => {
        postToEmbedParent({ type: FF_COMPLETE, submissionToken });
      },
    });
    return detach;
  }, [props.documentId, props.heightMode]);

  return (
    <div
      className={
        props.layout === "card" ? "ff-form-embed ff-form-embed--card" : "ff-form-embed"
      }
      data-block-kind="form-embed"
      data-document-id={props.documentId}
      data-layout={props.layout}
      data-height-mode={props.heightMode}
      style={props.layout === "card" ? CARD_STYLE : undefined}
    >
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
