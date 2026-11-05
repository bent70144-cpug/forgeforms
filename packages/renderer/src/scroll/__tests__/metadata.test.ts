import { describe, expect, it } from "vitest";
import { buildPageMetadata, buildUnavailableMetadata } from "../metadata";
import { classifySnapshotError } from "../errors";
import type { Snapshot } from "../../bridge";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    documentId: "doc-1",
    versionId: "ver-1",
    type: "page",
    title: "My Landing",
    locale: "en",
    cssVars: {},
    blocks: [],
    settings: { showBranding: true },
    ...overrides,
  };
}

describe("buildPageMetadata", () => {
  it("prefers seo.title over the document title", () => {
    const meta = buildPageMetadata(snapshot({ seo: { title: "SEO Title" } }));
    expect(meta.title).toBe("SEO Title");
  });

  it("falls back to snapshot.title, then 'Untitled'", () => {
    expect(buildPageMetadata(snapshot()).title).toBe("My Landing");
    expect(buildPageMetadata({ ...snapshot(), title: undefined }).title).toBe("Untitled");
  });

  it("prefers seo.description and falls back to the hero subtitle", () => {
    expect(buildPageMetadata(snapshot({ seo: { description: "SEO desc" } })).description).toBe("SEO desc");
    expect(
      buildPageMetadata(
        snapshot({ blocks: [{ id: "h", kind: "hero", props: { subtitle: "Hero sub" } }] }),
      ).description,
    ).toBe("Hero sub");
    expect(buildPageMetadata(snapshot()).description).toBeUndefined();
  });

  it("emits website OpenGraph with canonical url, locale and images", () => {
    const meta = buildPageMetadata(
      snapshot({ seo: { ogImageUrl: "https://cdn/og.png" }, locale: "en-US" }),
      { canonicalPath: "/p/acme/landing", siteName: "FormForge", baseUrl: "https://app.example.com" },
    );
    expect(meta.openGraph).toEqual({
      type: "website",
      title: "My Landing",
      url: "/p/acme/landing",
      siteName: "FormForge",
      locale: "en-US",
      images: ["https://cdn/og.png"],
    });
    expect(meta.twitter).toEqual({
      card: "summary_large_image",
      title: "My Landing",
      images: ["https://cdn/og.png"],
    });
    expect(meta.alternates).toEqual({ canonical: "/p/acme/landing" });
    expect(meta.metadataBase).toEqual(new URL("https://app.example.com"));
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("omits OG image and switches the twitter card without one", () => {
    const meta = buildPageMetadata(snapshot());
    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.twitter?.card).toBe("summary");
    expect(meta.twitter?.images).toBeUndefined();
  });

  it("drops invalid baseUrls and locales", () => {
    const meta = buildPageMetadata(snapshot({ locale: "not a locale!" }), { baseUrl: "not-a-url" });
    expect(meta.metadataBase).toBeUndefined();
    expect(meta.openGraph?.locale).toBeUndefined();
  });

  it("keeps metadata indexable only for available pages", () => {
    const gone = buildUnavailableMetadata();
    expect(gone.robots).toEqual({ index: false, follow: false });
    expect(gone.title).toBe("Page not available");
  });
});

describe("classifySnapshotError", () => {
  it.each([
    ["DOC_NOT_FOUND", "not-found"],
    ["not_found", "not-found"],
    ["SNAPSHOT_MISSING", "not-found"],
    ["NO_SUCH_DOCUMENT", "not-found"],
    ["DOC_UNPUBLISHED", "gone"],
    ["GONE", "gone"],
    ["NOT_PUBLISHED", "gone"],
    ["DOCUMENT_DRAFT", "gone"],
    ["DOC_DELETED", "gone"],
    ["INTERNAL", "unknown"],
    ["REDIS_DOWN", "unknown"],
    ["NOT_IMPLEMENTED", "unknown"],
    ["", "unknown"],
    [undefined, "unknown"],
    [42, "unknown"],
  ])("classifies %s → %s", (code, expected) => {
    expect(classifySnapshotError(code)).toBe(expected);
  });

  it("never maps transient/unknown codes to gone", () => {
    // A storage blip must not imply the document is permanently gone (spec §8).
    expect(classifySnapshotError("TIMEOUT")).not.toBe("gone");
  });
});
