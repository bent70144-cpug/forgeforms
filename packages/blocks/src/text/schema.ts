// packages/blocks — `text` props schema (spec §9.2: richText as Tiptap JSON →
// sanitized HTML; follow-up #6 / builder-audit §9.4 FAIL).
//
// The canonical builder form is TIPTAP JSON: the Zod document schema below
// mirrors EXACTLY the node/mark allowlist the §17 sanitizer serializes
// (packages/core/src/documents/sanitize.ts: TIPTAP_NODES/TIPTAP_MARKS). That
// keeps the editor output, the schema and the sanitizer round-trip in lockstep:
// everything the rich-text editor can emit validates, and everything that
// validates serializes to allowlist HTML.
//
// The schema ALSO accepts the sanitized HTML string form. That is not a
// loophole — it is the storage reality of the §17 pipeline:
//  - the save path (core `sanitizeDocumentBodyRichText`) flattens richText —
//    Tiptap JSON included — into a sanitized HTML string BEFORE validation, so
//    server-stored drafts carry the string form;
//  - seed templates and the AI vocabulary author `richText` as HTML strings.
// The sanitizer remains the security boundary: strings reaching it are
// re-tokenized on every render (script-proof), never trusted as-is.
import { z } from "zod";

// --- Hand-written shapes (recursive schemas need explicit annotations) -------

/** Mark types the §17 sanitizer serializes (mirror of TIPTAP_MARKS). */
export const RICH_TEXT_MARK_TYPES = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
] as const;

export type RichTextMarkType = (typeof RICH_TEXT_MARK_TYPES)[number];

export type RichTextMark = {
  type: RichTextMarkType;
  /** Only `link` carries attrs ({ href, … }); tolerated defensively like the sanitizer. */
  attrs?: Record<string, unknown>;
};

export type RichTextInline =
  | { type: "text"; text: string; marks?: RichTextMark[] }
  | { type: "hardBreak"; marks?: RichTextMark[] };

export type RichTextBlock =
  | { type: "paragraph"; content?: RichTextInline[] }
  | {
      type: "heading";
      /** Tiptap nests node metadata under `attrs` ({ level: 1..6, … }); level optional like the sanitizer. */
      attrs?: { level?: number } & Record<string, unknown>;
      content?: RichTextInline[];
    }
  | { type: "codeBlock"; attrs?: Record<string, unknown>; content?: RichTextInline[] }
  | { type: "horizontalRule" }
  | { type: "blockquote"; content?: RichTextBlock[] }
  | { type: "bulletList"; content?: RichTextListItem[] }
  | { type: "orderedList"; content?: RichTextListItem[] };

export type RichTextListItem = { type: "listItem"; content?: RichTextBlock[] };

export type RichTextDoc = {
  type: "doc";
  attrs?: Record<string, unknown>;
  content?: RichTextBlock[];
};

/** richText accepts Tiptap JSON (editor form) or a sanitized HTML string (§17 storage form). */
export type RichTextValue = RichTextDoc | string;

// --- Zod mirror of the sanitizer's Tiptap JSON representation ----------------

const RichTextMarkSchema = z.object({
  type: z.enum(RICH_TEXT_MARK_TYPES),
  attrs: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<RichTextMark>;

const RichTextInlineSchema: z.ZodType<RichTextInline> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("text"),
      text: z.string(),
      marks: z.array(RichTextMarkSchema).optional(),
    }),
    z.object({
      type: z.literal("hardBreak"),
      marks: z.array(RichTextMarkSchema).optional(),
    }),
  ]),
);

const RichTextListItemSchema: z.ZodType<RichTextListItem> = z.lazy(() =>
  z.object({
    type: z.literal("listItem"),
    content: z.array(RichTextBlockSchema).optional(),
  }),
);

const RichTextBlockSchema: z.ZodType<RichTextBlock> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("paragraph"),
      content: z.array(RichTextInlineSchema).optional(),
    }),
    z.object({
      type: z.literal("heading"),
      attrs: z
        .looseObject({ level: z.number().int().min(1).max(6).optional() })
        .optional(),
      content: z.array(RichTextInlineSchema).optional(),
    }),
    z.object({
      type: z.literal("codeBlock"),
      attrs: z.record(z.string(), z.unknown()).optional(),
      content: z.array(RichTextInlineSchema).optional(),
    }),
    z.object({ type: z.literal("horizontalRule") }),
    z.object({
      type: z.literal("blockquote"),
      content: z.array(RichTextBlockSchema).optional(),
    }),
    z.object({
      type: z.literal("bulletList"),
      content: z.array(RichTextListItemSchema).optional(),
    }),
    z.object({
      type: z.literal("orderedList"),
      content: z.array(RichTextListItemSchema).optional(),
    }),
  ]),
);

/** The doc root, exactly as Tiptap's `editor.getJSON()` emits it. */
export const RichTextDocSchema: z.ZodType<RichTextDoc> = z.object({
  type: z.literal("doc"),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(RichTextBlockSchema).optional(),
});

// HTML-string branch: the §17 save-path form. Any string the sanitizer accepts
// (it tokenizes and re-emits; raw markup is neutralized at render), bounded for
// storage sanity.
const RICH_TEXT_HTML_MAX = 200_000;

export const TextProps = z.strictObject({
  richText: z.union([RichTextDocSchema, z.string().max(RICH_TEXT_HTML_MAX)]),
});

export type TextProps = z.infer<typeof TextProps>;

// --- Helpers -----------------------------------------------------------------

/** True when the value looks like a Tiptap doc JSON object (not a string). */
export function isRichTextDoc(value: unknown): value is RichTextDoc {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as RichTextDoc).type === "doc";
}

/** Build a one-paragraph doc from plain text (defaults, AI seeding, migration). */
export function paragraphDoc(text: string): RichTextDoc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(text === "" ? {} : { content: [{ type: "text", text }] as RichTextInline[] }),
      },
    ],
  };
}

export const textDefaultProps = (): TextProps => ({
  richText: paragraphDoc("Write something…"),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectTextNodes(node: unknown, out: string[]): void {
  if (!isRecord(node)) return;
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectTextNodes(child, out);
  }
  if (node.type === "text" && typeof node.text === "string") out.push(node.text);
}

/**
 * Plain text of any richText value — for tree/canvas row labels and the
 * editor's loading fallback. Tiptap JSON is walked for text nodes; strings are
 * crudely tag-stripped (labels only — never rendered as markup anywhere).
 */
export function plainTextFromRichText(value: unknown): string {
  if (isRichTextDoc(value)) {
    const parts: string[] = [];
    collectTextNodes(value, parts);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  if (typeof value === "string") {
    return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}
