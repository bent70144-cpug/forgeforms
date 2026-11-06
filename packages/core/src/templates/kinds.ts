// packages/core/src/templates/kinds.ts
// Block kinds used by the W1-22 seed templates (spec §7.2 catalog subset).
// ISSUE #30: the zod schema copies once in ./schema.ts moved to
// @formforge/schema; only this catalog remains templates-local.

/** Block kinds used by the W1-22 seed templates (spec §7.2 catalog subset). */
export const TEMPLATE_BLOCK_KINDS = [
  // content
  "hero",
  "text",
  "image",
  "gallery",
  "video",
  "testimonials",
  "faq",
  "pricing",
  "projects",
  "contact-links",
  // layout
  "section",
  "columns",
  // action
  "button",
  "form-embed",
  // question
  "short-text",
  "long-text",
  "email",
  "number",
  "single-select",
  "multi-select",
  "dropdown",
  "rating",
  "nps",
  "file-upload",
] as const;

export type TemplateBlockKind = (typeof TEMPLATE_BLOCK_KINDS)[number];
