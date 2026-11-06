// SEO / Open Graph metadata builder (spec §10: SEO meta + OG tags from
// snapshot.settings.seo). Returns a structural subset of Next.js `Metadata`
// so callers can return it directly from generateMetadata.

import type { Snapshot } from "../snapshot";

/**
 * Minimal Next-Metadata-compatible shape. Kept local so this package does not
 * depend on `next`; a plain object with these fields assigns to `Metadata`.
 */
export type PageMetadata = {
  title: string;
  description?: string;
  metadataBase?: URL;
  alternates?: { canonical?: string };
  robots?: { index: boolean; follow: boolean };
  openGraph?: {
    type: "website";
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    locale?: string;
    images?: string[];
  };
  twitter?: {
    card: "summary" | "summary_large_image";
    title?: string;
    description?: string;
    images?: string[];
  };
};

export type BuildPageMetadataOptions = {
  /** Canonical path for this public route, e.g. "/p/acme/landing". */
  canonicalPath?: string;
  /** Site name shown in OG tags (e.g. "FormForge" or the workspace name). */
  siteName?: string;
  /** Origin used as metadataBase so relative OG URLs/canonicals resolve. */
  baseUrl?: string;
};

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function findHeroSubtitle(snapshot: Snapshot): string | undefined {
  for (const block of snapshot.blocks ?? []) {
    if (block?.kind !== "hero") continue;
    const props = block.props;
    if (props && typeof props.subtitle === "string" && props.subtitle.trim() !== "") {
      return props.subtitle.trim();
    }
  }
  return undefined;
}

function normalizeLocale(locale: string | undefined): string | undefined {
  const v = firstNonEmpty(locale);
  if (!v) return undefined;
  return /^[a-z]{2}(-[A-Z0-9]{2,8})?$/i.test(v) ? v : undefined;
}

export function buildPageMetadata(
  snapshot: Snapshot,
  options: BuildPageMetadataOptions = {},
): PageMetadata {
  const seo = snapshot.seo ?? {};
  const title = firstNonEmpty(seo.title, snapshot.title) ?? "Untitled";
  const description = firstNonEmpty(seo.description, findHeroSubtitle(snapshot));
  const canonicalPath = options.canonicalPath ?? "/";
  const ogImage = firstNonEmpty(seo.ogImageUrl, seo.ogImage);

  const metadata: PageMetadata = {
    title,
    ...(description !== undefined ? { description } : {}),
    robots: { index: true, follow: true },
    ...(options.baseUrl !== undefined && isValidHttpUrl(options.baseUrl)
      ? { metadataBase: new URL(options.baseUrl) }
      : {}),
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "website",
      title,
      ...(description !== undefined ? { description } : {}),
      url: canonicalPath,
      ...(options.siteName !== undefined ? { siteName: options.siteName } : {}),
      ...(normalizeLocale(snapshot.locale) !== undefined
        ? { locale: normalizeLocale(snapshot.locale) }
        : {}),
      ...(ogImage !== undefined ? { images: [ogImage] } : {}),
    },
    twitter: {
      card: ogImage !== undefined ? "summary_large_image" : "summary",
      title,
      ...(description !== undefined ? { description } : {}),
      ...(ogImage !== undefined ? { images: [ogImage] } : {}),
    },
  };

  return metadata;
}

/** Metadata for the "gone / not available" state: keep it out of search indexes. */
export function buildUnavailableMetadata(): PageMetadata {
  return {
    title: "Page not available",
    robots: { index: false, follow: false },
  };
}
