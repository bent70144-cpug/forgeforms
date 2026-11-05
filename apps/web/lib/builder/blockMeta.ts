// Builder-side block catalog (palette + inspector metadata).
//
// SPEC-NOTE: the real per-kind schemas/editors/renderers live in
// packages/blocks (T09+). Until that registry is importable, the builder keeps
// its own lightweight descriptors (kinds, families, default props, inspector
// fields) mirroring spec §7.2. When packages/blocks lands, swap the palette
// + inspector sources to the registry and delete this file.

import type { Block, DocumentType } from "../bridge";
import { newId } from "./id";

export type BlockFamily = "content" | "question" | "action" | "layout";

export type FieldDef =
  | { key: string; label: string; type: "text" | "textarea" | "number" | "url" }
  | { key: string; label: string; type: "boolean" }
  | { key: string; label: string; type: "select"; options: Array<{ value: string; label: string }> }
  | { key: string; label: string; type: "options-list" }
  | { key: string; label: string; type: "string-list" };

export type BlockMeta = {
  kind: string;
  family: BlockFamily;
  label: string;
  icon: string;
  hint?: string;
  fields: FieldDef[];
  defaultProps: () => Record<string, unknown>;
  /** Layout containers accept children. */
  container?: boolean;
  /** Contextual palette: restrict to given document types (default: all). */
  onlyIn?: DocumentType[];
  /** Prop whose value is shown as the row label in tree/canvas previews. */
  primaryProp?: string;
};

const questionGeneric: FieldDef[] = [
  { key: "description", label: "Description", type: "textarea" },
  { key: "required", label: "Required", type: "boolean" },
];

const OPTIONS_FIELD: FieldDef = { key: "options", label: "Options", type: "options-list" };

function twoOptions(): Array<{ id: string; label: string }> {
  return [
    { id: newId(), label: "Option 1" },
    { id: newId(), label: "Option 2" },
  ];
}

export const BLOCK_CATALOG: BlockMeta[] = [
  // --- Content -------------------------------------------------------------
  {
    kind: "hero",
    family: "content",
    label: "Hero",
    icon: "🌄",
    hint: "Big title with a call to action",
    primaryProp: "title",
    onlyIn: ["page", "portfolio"],
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "subtitle", label: "Subtitle", type: "textarea" },
      { key: "cta.label", label: "CTA label", type: "text" },
      { key: "cta.href", label: "CTA link", type: "url" },
    ],
    defaultProps: () => ({ title: "Headline that sells", subtitle: "One or two supporting sentences.", cta: { label: "Get started", href: "#" } }),
  },
  {
    kind: "text",
    family: "content",
    label: "Text",
    icon: "¶",
    hint: "A rich text paragraph",
    primaryProp: "richText",
    fields: [{ key: "richText", label: "Content", type: "textarea" }],
    // SPEC-NOTE: stored as a plain string until the Tiptap JSON shape (T09) lands.
    defaultProps: () => ({ richText: "Write something…" }),
  },
  {
    kind: "image",
    family: "content",
    label: "Image",
    icon: "🖼️",
    primaryProp: "alt",
    fields: [
      { key: "assetId", label: "Asset", type: "text" },
      { key: "alt", label: "Alt text", type: "text" },
      { key: "caption", label: "Caption", type: "text" },
    ],
    defaultProps: () => ({ assetId: "", alt: "Image", caption: "" }),
  },
  {
    kind: "gallery",
    family: "content",
    label: "Gallery",
    icon: "🎞️",
    onlyIn: ["page", "portfolio"],
    primaryProp: "layout",
    fields: [
      { key: "assetIds", label: "Assets (comma separated)", type: "string-list" },
      { key: "layout", label: "Layout", type: "select", options: [{ value: "grid", label: "Grid" }, { value: "masonry", label: "Masonry" }] },
      { key: "columns", label: "Columns", type: "number" },
    ],
    defaultProps: () => ({ assetIds: [], layout: "grid", columns: 3 }),
  },
  {
    kind: "video",
    family: "content",
    label: "Video",
    icon: "▶️",
    onlyIn: ["page", "portfolio"],
    fields: [{ key: "url", label: "URL (YouTube/Vimeo)", type: "url" }],
    defaultProps: () => ({ url: "" }),
  },
  {
    kind: "testimonials",
    family: "content",
    label: "Testimonials",
    icon: "💬",
    onlyIn: ["page", "portfolio"],
    fields: [],
    defaultProps: () => ({ items: [] }),
  },
  {
    kind: "faq",
    family: "content",
    label: "FAQ",
    icon: "❓",
    onlyIn: ["page", "portfolio"],
    fields: [],
    defaultProps: () => ({ items: [] }),
  },
  {
    kind: "pricing",
    family: "content",
    label: "Pricing",
    icon: "💳",
    onlyIn: ["page", "portfolio"],
    fields: [],
    defaultProps: () => ({ tiers: [] }),
  },
  {
    kind: "projects",
    family: "content",
    label: "Projects",
    icon: "🗂️",
    onlyIn: ["portfolio"],
    fields: [],
    defaultProps: () => ({ items: [] }),
  },
  {
    kind: "contact-links",
    family: "content",
    label: "Contact links",
    icon: "🔗",
    onlyIn: ["portfolio"],
    fields: [],
    defaultProps: () => ({ links: [] }),
  },
  // --- Layout --------------------------------------------------------------
  {
    kind: "section",
    family: "layout",
    label: "Section",
    icon: "▭",
    hint: "A full-width group of blocks",
    container: true,
    fields: [
      { key: "background", label: "Background", type: "text" },
      { key: "padding", label: "Padding", type: "select", options: [{ value: "none", label: "None" }, { value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }] },
    ],
    defaultProps: () => ({ background: "none", padding: "md" }),
  },
  {
    kind: "columns",
    family: "layout",
    label: "Columns",
    icon: "▥",
    hint: "2–4 column grid",
    container: true,
    fields: [{ key: "count", label: "Count (2–4)", type: "number" }],
    defaultProps: () => ({ count: 2 }),
  },
  {
    kind: "multi-question-page",
    family: "layout",
    label: "Multi-question page",
    icon: "📋",
    hint: "Several questions on one step",
    container: true,
    onlyIn: ["form", "page"],
    fields: [],
    defaultProps: () => ({}),
  },
  // --- Action --------------------------------------------------------------
  {
    kind: "button",
    family: "action",
    label: "Button",
    icon: "🔘",
    primaryProp: "label",
    fields: [
      { key: "label", label: "Label", type: "text" },
      { key: "href", label: "Link", type: "url" },
      { key: "style", label: "Style", type: "select", options: [{ value: "primary", label: "Primary" }, { value: "secondary", label: "Secondary" }, { value: "ghost", label: "Ghost" }] },
    ],
    defaultProps: () => ({ label: "Click me", href: "#", style: "primary" }),
  },
  {
    kind: "form-embed",
    family: "action",
    label: "Form embed",
    icon: "🧩",
    hint: "Embed another FormForge form",
    fields: [{ key: "documentId", label: "Document", type: "text" }],
    defaultProps: () => ({ documentId: "" }),
  },
  // --- Question ------------------------------------------------------------
  {
    kind: "short-text",
    family: "question",
    label: "Short text",
    icon: "✏️",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      { key: "placeholder", label: "Placeholder", type: "text" },
      { key: "maxLength", label: "Max length", type: "number" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Short text question", placeholder: "", required: false }),
  },
  {
    kind: "long-text",
    family: "question",
    label: "Long text",
    icon: "📝",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      { key: "placeholder", label: "Placeholder", type: "textarea" },
      { key: "maxLength", label: "Max length", type: "number" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Long text question", placeholder: "", required: false }),
  },
  {
    kind: "email",
    family: "question",
    label: "Email",
    icon: "✉️",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [{ key: "label", label: "Question", type: "text" }, ...questionGeneric],
    defaultProps: () => ({ label: "Email address", required: false }),
  },
  {
    kind: "number",
    family: "question",
    label: "Number",
    icon: "🔢",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      { key: "min", label: "Min", type: "number" },
      { key: "max", label: "Max", type: "number" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Number question", required: false }),
  },
  {
    kind: "single-select",
    family: "question",
    label: "Single select",
    icon: "◉",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      OPTIONS_FIELD,
      { key: "allowOther", label: "Allow “other”", type: "boolean" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Pick one", required: false, options: twoOptions(), allowOther: false }),
  },
  {
    kind: "multi-select",
    family: "question",
    label: "Multi select",
    icon: "☑️",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      OPTIONS_FIELD,
      { key: "min", label: "Min selections", type: "number" },
      { key: "max", label: "Max selections", type: "number" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Pick any", required: false, options: twoOptions() }),
  },
  {
    kind: "dropdown",
    family: "question",
    label: "Dropdown",
    icon: "📂",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      OPTIONS_FIELD,
      { key: "searchable", label: "Searchable", type: "boolean" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Choose from the list", required: false, options: twoOptions() }),
  },
  {
    kind: "rating",
    family: "question",
    label: "Rating",
    icon: "⭐",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      { key: "scale", label: "Scale (3–10)", type: "number" },
      { key: "icon", label: "Icon", type: "select", options: [{ value: "star", label: "Stars" }, { value: "heart", label: "Hearts" }, { value: "thumbs", label: "Thumbs" }] },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Rate us", scale: 5, icon: "star" }),
  },
  {
    kind: "nps",
    family: "question",
    label: "NPS",
    icon: "📊",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      { key: "leftLabel", label: "Left label", type: "text" },
      { key: "rightLabel", label: "Right label", type: "text" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "How likely are you to recommend us?", leftLabel: "Not likely", rightLabel: "Very likely" }),
  },
  {
    kind: "file-upload",
    family: "question",
    label: "File upload",
    icon: "📎",
    primaryProp: "label",
    onlyIn: ["form"],
    fields: [
      { key: "label", label: "Question", type: "text" },
      { key: "accept", label: "Accepted types (comma separated)", type: "string-list" },
      { key: "maxSizeMb", label: "Max size (MB, ≤10)", type: "number" },
      { key: "maxFiles", label: "Max files", type: "number" },
      ...questionGeneric,
    ],
    defaultProps: () => ({ label: "Upload files", maxSizeMb: 10, maxFiles: 1, accept: [], required: false }),
  },
];

const CATALOG_BY_KIND = new Map(BLOCK_CATALOG.map((m) => [m.kind, m]));

export function getBlockMeta(kind: string): BlockMeta | undefined {
  return CATALOG_BY_KIND.get(kind);
}

export function createBlock(kind: string, makeId: () => string = newId): Block {
  const meta = CATALOG_BY_KIND.get(kind);
  return {
    id: makeId(),
    kind,
    props: meta ? meta.defaultProps() : {},
    ...(meta?.container ? { children: [] } : {}),
  };
}

/** Contextual palette groups (spec §14.1: questions for forms, content for pages/portfolios). */
export function paletteForType(type: DocumentType): Array<{ family: BlockFamily; label: string; kinds: BlockMeta[] }> {
  const familyOrder: BlockFamily[] =
    type === "form" ? ["question", "action", "layout", "content"] : ["content", "action", "layout", "question"];
  const labels: Record<BlockFamily, string> = {
    question: "Questions",
    content: "Content",
    layout: "Layout",
    action: "Actions",
  };
  return familyOrder
    .map((family) => ({
      family,
      label: labels[family],
      kinds: BLOCK_CATALOG.filter((m) => m.family === family && (!m.onlyIn || m.onlyIn.includes(type))),
    }))
    .filter((g) => g.kinds.length > 0);
}

/** Best-effort display label for a block in tree/canvas rows. */
export function blockDisplayLabel(block: Block): string {
  const meta = getBlockMeta(block.kind);
  const key = meta?.primaryProp;
  const raw = key ? block.props[key] : undefined;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.length > 42 ? `${raw.slice(0, 42)}…` : raw;
  }
  return meta?.label ?? block.kind;
}

export function blockIcon(kind: string): string {
  return getBlockMeta(kind)?.icon ?? "▪️";
}

export function isContainerKind(kind: string): boolean {
  return getBlockMeta(kind)?.container ?? false;
}
