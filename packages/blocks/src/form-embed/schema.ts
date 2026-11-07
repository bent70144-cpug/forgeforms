// packages/blocks — `form-embed` props schema (spec §7.2 action block:
// documentId of a published form). The id must be a public document short id
// (`doc_` + 22 base58 chars, spec §4). Existence + published state is enforced
// at publish time by the document service (spec §8), not by the schema.
// §9.2 additions: `layout` (inline frame vs centered card) and `heightMode`
// (auto-resize from ff:height vs fixed px) — both defaulted so older stored
// documents parse unchanged.
// OWNED BY T21 (issue #21).
import { z } from "zod";

/** Public document ids: `doc_<22 base58 chars>` (spec §4, shared/ids.ts). */
export const DOCUMENT_ID_PATTERN = /^doc_[1-9A-HJ-NP-Za-km-z]{22}$/;

/** §9.2 layout modes: `inline` is the classic full-width block; `card` frames it. */
export const FormEmbedLayout = z.enum(["inline", "card"]);

/**
 * §9.2 height modes: `auto` grows/shrinks with the child's ff:height messages
 * (spec §10.2 protocol); `fixed` pins the frame height and lets the child
 * scroll internally.
 */
export const FormEmbedHeightMode = z.enum(["auto", "fixed"]);

export const FormEmbedProps = z.strictObject({
  documentId: z.string().regex(DOCUMENT_ID_PATTERN, {
    message: "documentId must be a public document id (doc_…)",
  }),
  layout: FormEmbedLayout.default("inline"),
  heightMode: FormEmbedHeightMode.default("auto"),
  /** Authored height for heightMode "fixed" (px); clamped again at render. */
  fixedHeight: z.number().int().min(120).max(2000).optional(),
});

export type FormEmbedLayout = z.infer<typeof FormEmbedLayout>;
export type FormEmbedHeightMode = z.infer<typeof FormEmbedHeightMode>;
export type FormEmbedProps = z.infer<typeof FormEmbedProps>;

/** Syntactically valid placeholder; renders the graceful "unpublished" frame. */
const PLACEHOLDER_DOCUMENT_ID = `doc_${"1".repeat(22)}`;

export const formEmbedDefaultProps = (): FormEmbedProps => ({
  documentId: PLACEHOLDER_DOCUMENT_ID,
  layout: "inline",
  heightMode: "auto",
});

/** The iframe src a published document is served from (spec §10.2). */
export function embedFrameSrc(documentId: string): string {
  return `/embed/${documentId}`;
}
