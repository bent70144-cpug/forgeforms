// Block → section view-model mapping (pure, spec §7.2 MVP content blocks).
// Everything here is defensive: snapshots may carry unresolved asset ids or
// missing props, and malformed blocks must degrade — never crash the page.

import type { SnapshotBlock } from "../bridge";

export type HeroViewProps = {
  title: string;
  subtitle: string;
  imageUrl: string | null;
  cta: { label: string; href: string } | null;
};

export type TextViewProps = { html: string };

export type ImageViewProps = {
  src: string | null;
  alt: string;
  caption: string;
  width: number | null;
  height: number | null;
};

export type ButtonViewProps = {
  label: string;
  href: string | null;
  variant: "primary" | "secondary" | "outline";
};

export type SectionPadding = "none" | "sm" | "md" | "lg" | "xl";

export type SectionViewProps = {
  background: string | null;
  padding: SectionPadding;
};

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

const ASSET_URL_KEYS = [
  "src",
  "url",
  "assetUrl",
  "assetSrc",
  "imageUrl",
  "imageSrc",
] as const;

/**
 * Resolve an asset URL from snapshot props. The snapshot builder (spec §8) is
 * supposed to replace asset ids with CDN URLs, but the resolved value may sit
 * under different keys (or a nested {url} object) — accept the plausible shapes.
 */
export function pickAssetUrl(
  props: Record<string, unknown>,
  keys: readonly string[] = ASSET_URL_KEYS,
): string | null {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (isRecord(value)) {
      const nested = typeof value.url === "string" ? value.url : typeof value.src === "string" ? value.src : null;
      if (nested && nested.trim() !== "") return nested.trim();
    }
  }
  return null;
}

/** Public links only: block javascript:, data: and other exotic schemes (defense in depth). */
const SAFE_HREF_PATTERN = /^(https?:\/\/|\/|#|mailto:|tel:)/i;

export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (trimmed === "") return null;
  if (!SAFE_HREF_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/* ------------------------------------------------------------------ */
/* Rich text                                                           */
/* ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// SPEC-NOTE: the snapshot stores publish-time sanitized HTML (spec §8), so HTML
// strings are rendered as-is; re-sanitizing here would need a heavy dependency.
// Tiptap JSON (if the snapshot builder did not flatten it) is degraded to escaped
// plain paragraphs instead of being trusted.

/**
 * Render snapshot rich text: HTML string passes through (sanitized at publish),
 * Tiptap JSON degrades to escaped <p> blocks, anything else becomes "".
 */
export function renderRichText(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    const paragraphs = tiptapToParagraphs(value, []);
    return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  }
  return "";
}

function collectTiptapText(nodes: unknown[]): string {
  let text = "";
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (node.type === "text" && typeof node.text === "string") {
      text += node.text;
    } else if (node.type === "hardBreak") {
      text += " ";
    } else if (Array.isArray(node.content)) {
      text += collectTiptapText(node.content);
    }
  }
  return text;
}

function tiptapToParagraphs(node: Record<string, unknown>, out: string[]): string[] {
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "text" && typeof node.text === "string") {
    out.push(node.text);
    return out;
  }
  if (type === "paragraph" || type === "heading" || type === "blockquote" || type === "listItem") {
    const inline = collectTiptapText(Array.isArray(node.content) ? node.content : []);
    if (inline.trim() !== "") out.push(inline);
    return out;
  }
  const content = Array.isArray(node.content) ? node.content : [];
  for (const child of content) {
    if (isRecord(child)) tiptapToParagraphs(child, out);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Per-kind normalizers                                                */
/* ------------------------------------------------------------------ */

export function normalizeHeroProps(props: Record<string, unknown>): HeroViewProps {
  const ctaRaw = isRecord(props.cta) ? props.cta : {};
  const href = safeHref(ctaRaw.href ?? props.ctaHref);
  const label = str(ctaRaw.label ?? props.ctaLabel);
  return {
    title: str(props.title),
    subtitle: str(props.subtitle),
    imageUrl: pickAssetUrl(props, ["imageUrl", "imageSrc", "image", "src", "url", "assetUrl", "assetSrc"]),
    cta: href !== null && label !== "" ? { label, href } : null,
  };
}

export function normalizeTextProps(props: Record<string, unknown>): TextViewProps {
  return { html: renderRichText(props.richText ?? props.html ?? props.text) };
}

export function normalizeImageProps(props: Record<string, unknown>): ImageViewProps {
  return {
    src: pickAssetUrl(props),
    alt: str(props.alt),
    caption: str(props.caption),
    width: num(props.width),
    height: num(props.height),
  };
}

export function normalizeButtonProps(props: Record<string, unknown>): ButtonViewProps {
  const styleRaw = str(props.style ?? props.variant).trim().toLowerCase();
  const variant: ButtonViewProps["variant"] =
    styleRaw === "secondary" || styleRaw === "outline" ? styleRaw : "primary";
  return {
    label: str(props.label ?? props.text),
    href: safeHref(props.href ?? props.url),
    variant,
  };
}

const SECTION_PADDINGS: readonly SectionPadding[] = ["none", "sm", "md", "lg", "xl"];

export function normalizeSectionProps(props: Record<string, unknown>): SectionViewProps {
  const paddingRaw = str(props.padding).trim().toLowerCase();
  const padding = (SECTION_PADDINGS as readonly string[]).includes(paddingRaw)
    ? (paddingRaw as SectionPadding)
    : "md";
  return { background: resolveBackground(props.background), padding };
}

const BACKGROUND_ALIASES: Record<string, string> = {
  bg: "var(--ff-bg)",
  background: "var(--ff-bg)",
  fg: "var(--ff-fg)",
  primary: "var(--ff-primary)",
  "primary-fg": "var(--ff-primary-fg)",
  muted: "var(--ff-muted)",
  border: "var(--ff-border)",
};

/**
 * Section backgrounds: accept real CSS colors, var() references, or canonical
 * token names mapped to theme variables. Unknown names resolve to nothing
 * rather than being injected into the style attribute.
 */
export function resolveBackground(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (v === "") return null;
  const lowered = v.toLowerCase().replace(/_/g, "-");
  const alias = BACKGROUND_ALIASES[lowered];
  if (alias) return alias;
  if (lowered === "color.bg") return "var(--ff-bg)";
  if (lowered === "color.fg" || lowered === "color.text") return "var(--ff-fg)";
  if (lowered === "color.primary") return "var(--ff-primary)";
  if (lowered === "color.muted") return "var(--ff-muted)";
  if (lowered === "color.border") return "var(--ff-border)";
  if (/^(#[0-9a-f]+|rgb|hsl|oklch|lab|lch|color\(|var\(|transparent|currentcolor)/i.test(v)) {
    return v;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Block dispatch support                                              */
/* ------------------------------------------------------------------ */

/** Hidden or malformed blocks render as nothing (spec §7.1 registry rules). */
export function isBlockRenderable(block: SnapshotBlock | undefined | null): boolean {
  if (!isRecord(block)) return false;
  if (block.hidden === true) return false;
  return typeof block.kind === "string" && block.kind !== "";
}
