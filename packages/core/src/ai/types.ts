// T27 module-local types & AI prompt catalog (spec §7/§13).
// ISSUE #30: the spec-§7 zod schema copies that lived here moved to
// @formforge/schema (T06) — Block/Theme/Rule/DocumentBody/DocumentType are
// re-exported from there. What remains AI-local: the Capability/CanFn billing
// seam (narrowed by T23 reconciliation) and the prompt cheatsheet catalog.

import { Block, DocumentBody, Rule, Theme, type DocumentType } from "@formforge/schema";

/** T23 will narrow this to the real capability union; the AI plane passes "ai". */
export type Capability = string;
export type CanFn = (workspaceId: string, capability: Capability) => Promise<boolean>;

// Spec §7 shapes (canonical @formforge/schema — value + type via declaration merging).
export { Block, DocumentBody, Rule, Theme };
export type { DocumentType };

// ---------------------------------------------------------------------------
// MVP block catalog (spec §7.2) — the cheatsheet the AI prompt is built from.
// The same set is used to reject drafts that invent unknown block kinds.
// ---------------------------------------------------------------------------

export const BLOCK_KIND_CHEATSHEET: ReadonlyArray<{
  family: "content" | "layout" | "action" | "question";
  kind: string;
  props: string;
}> = [
  { family: "content", kind: "hero", props: "title, subtitle, imageAssetId?, cta?{label,href}" },
  { family: "content", kind: "text", props: "richText (HTML string)" },
  { family: "content", kind: "image", props: "assetId, alt?, caption?" },
  { family: "content", kind: "gallery", props: "assetIds[], layout(grid|masonry), columns" },
  { family: "content", kind: "video", props: "url (YouTube/Vimeo)" },
  { family: "content", kind: "testimonials", props: "items[{quote,name,role,avatarAssetId?}]" },
  { family: "content", kind: "faq", props: "items[{q,a}]" },
  { family: "content", kind: "pricing", props: "tiers[{name,price,features[],cta}]" },
  { family: "content", kind: "projects", props: "items[{title,description,coverAssetId?,link?,tags[]}]" },
  { family: "content", kind: "contact-links", props: "links[{type,url}]" },
  { family: "layout", kind: "section", props: "background?, padding?, children[]" },
  { family: "layout", kind: "columns", props: "count(2-4), children[]" },
  { family: "layout", kind: "multi-question-page", props: "children[] (question blocks)" },
  { family: "action", kind: "button", props: "label, href, style" },
  { family: "action", kind: "form-embed", props: "documentId (type=form)" },
  { family: "question", kind: "short-text", props: "label, placeholder?, required?, maxLength?" },
  { family: "question", kind: "long-text", props: "label, placeholder?, required?, maxLength?" },
  { family: "question", kind: "email", props: "label, required?" },
  { family: "question", kind: "number", props: "label, required?, min?, max?" },
  { family: "question", kind: "single-select", props: "label, options[{id,label}], allowOther?, randomize?" },
  { family: "question", kind: "multi-select", props: "label, options[{id,label}], min?, max?" },
  { family: "question", kind: "dropdown", props: "label, options[{id,label}], searchable?" },
  { family: "question", kind: "rating", props: "label, scale(3-10), icon?" },
  { family: "question", kind: "nps", props: "label, leftLabel?, rightLabel?" },
  { family: "question", kind: "file-upload", props: "label, accept[], maxSizeMb(≤10), maxFiles?" },
];

export const KNOWN_BLOCK_KINDS: ReadonlySet<string> = new Set(
  BLOCK_KIND_CHEATSHEET.map((b) => b.kind),
);
