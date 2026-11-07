// packages/blocks — `text` public renderer (server-safe; follow-up #6).
//
// SECURITY (spec §17, builder-audit §9.4): the renderer NEVER trusts the stored
// richText. Every render path — public BlockView, the builder's disabled canvas
// preview, AI previews — passes the value through the allowlist sanitizer
// (`sanitizeRichTextHtml`): Tiptap JSON is serialized to allowlist HTML; HTML
// strings are re-tokenized so `<script>`/handlers/`javascript:` hrefs cannot
// survive. This module must stay dependency-light: it imports ONLY the
// sanitizer subpath (dependency-free module) — never the editor (the rich-text
// editor is a lazy `import()` away in ./editor.tsx and must never enter any
// renderer bundle, spec §10.2 ≤120 KB conversational plane).
import type { FC } from "react";
import { sanitizeRichTextHtml } from "@formforge/core/documents/sanitize";
import type { RenderProps } from "../registry";
import type { TextProps } from "./schema";

export const TextRender: FC<RenderProps<TextProps>> = ({ props }) => {
  const html = sanitizeRichTextHtml(props.richText);
  if (html === "") return null;
  return (
    <div
      className="ff-text"
      data-block-kind="text"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
