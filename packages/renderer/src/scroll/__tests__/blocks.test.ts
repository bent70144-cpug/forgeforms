import { describe, expect, it } from "vitest";
import {
  isBlockRenderable,
  normalizeButtonProps,
  normalizeHeroProps,
  normalizeImageProps,
  normalizeSectionProps,
  normalizeTextProps,
  pickAssetUrl,
  renderRichText,
  resolveBackground,
  safeHref,
} from "../blocks";

describe("pickAssetUrl", () => {
  it("finds the first non-empty URL among the known keys", () => {
    expect(pickAssetUrl({ src: "https://cdn/x.png" })).toBe("https://cdn/x.png");
    expect(pickAssetUrl({ assetUrl: "https://cdn/y.webp", src: "" })).toBe("https://cdn/y.webp");
    expect(pickAssetUrl({ imageUrl: " https://cdn/z.jpg " })).toBe("https://cdn/z.jpg");
  });

  it("unwraps nested {url} / {src} objects", () => {
    expect(pickAssetUrl({ image: { url: "https://cdn/n.png" } })).toBe("https://cdn/n.png");
    expect(pickAssetUrl({ image: { src: "https://cdn/n2.png" } })).toBe("https://cdn/n2.png");
  });

  it("returns null when nothing resolves (unresolved asset id only)", () => {
    expect(pickAssetUrl({ assetId: "ast_123" })).toBeNull();
    expect(pickAssetUrl({})).toBeNull();
  });
});

describe("safeHref", () => {
  it("allows http(s), root-relative, hash, mailto and tel links", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com/x")).toBe("http://example.com/x");
    expect(safeHref("/pricing")).toBe("/pricing");
    expect(safeHref("#top")).toBe("#top");
    expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeHref("tel:+123")).toBe("tel:+123");
  });

  it("blocks javascript:, data: and other exotic schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>1</script>")).toBeNull();
    expect(safeHref("vbscript:x")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref(42)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});

describe("normalizeHeroProps", () => {
  it("maps title, subtitle, resolved image and CTA", () => {
    const view = normalizeHeroProps({
      title: "Hello",
      subtitle: "World",
      imageSrc: "https://cdn/hero.png",
      cta: { label: "Start", href: "/start" },
    });
    expect(view).toEqual({
      title: "Hello",
      subtitle: "World",
      imageUrl: "https://cdn/hero.png",
      cta: { label: "Start", href: "/start" },
    });
  });

  it("drops CTAs with unsafe or missing hrefs and unresolved labels", () => {
    expect(normalizeHeroProps({ title: "T", cta: { label: "X", href: "javascript:x" } }).cta).toBeNull();
    expect(normalizeHeroProps({ title: "T", cta: { label: "X" } }).cta).toBeNull();
    expect(normalizeHeroProps({ title: "T", cta: { href: "/ok" } }).cta).toBeNull();
  });

  it("degrades missing props to empty strings / nulls", () => {
    expect(normalizeHeroProps({})).toEqual({ title: "", subtitle: "", imageUrl: null, cta: null });
    expect(normalizeHeroProps({ title: 7 }).title).toBe("");
  });
});

describe("normalizeTextProps", () => {
  it("passes through sanitized HTML from the snapshot", () => {
    expect(normalizeTextProps({ richText: "<p>Hi</p>" }).html).toBe("<p>Hi</p>");
  });

  it("accepts html/text key fallbacks", () => {
    expect(normalizeTextProps({ html: "<b>x</b>" }).html).toBe("<b>x</b>");
    expect(normalizeTextProps({ text: "plain" }).html).toBe("plain");
  });

  it("degrades Tiptap JSON to escaped paragraphs", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "One" }, { type: "text", text: " two" }] },
        { type: "paragraph", content: [{ type: "text", text: "<script>x</script>" }] },
      ],
    };
    const html = normalizeTextProps({ richText: doc }).html;
    expect(html).toBe("<p>One two</p><p>&lt;script&gt;x&lt;/script&gt;</p>");
  });

  it("returns empty HTML for scalar garbage", () => {
    expect(normalizeTextProps({ richText: 42 }).html).toBe("");
    expect(normalizeTextProps({}).html).toBe("");
  });
});

describe("renderRichText", () => {
  it("escapes entities in the Tiptap JSON path", () => {
    const html = renderRichText({ type: "doc", content: [{ type: "text", text: `a & b "c" <d>` }] });
    expect(html).toBe('<p>a &amp; b &quot;c&quot; &lt;d&gt;</p>');
  });
});

describe("normalizeImageProps", () => {
  it("maps src/alt/caption and optional dimensions", () => {
    expect(
      normalizeImageProps({ src: "https://cdn/i.png", alt: "An image", caption: "Cap", width: "800", height: 600 }),
    ).toEqual({
      src: "https://cdn/i.png",
      alt: "An image",
      caption: "Cap",
      width: 800,
      height: 600,
      srcSet: null,
      sizes: null,
      blurDataURL: null,
    });
  });

  it("keeps src null when the asset was not resolved", () => {
    expect(normalizeImageProps({ assetId: "ast_1", alt: "alt" }).src).toBeNull();
    expect(normalizeImageProps({ alt: "alt", width: Number.NaN }).width).toBeNull();
  });

  // T16 (issue #16) — resolved ImageAssetRef record under `src` (spec §8:
  // publish resolves asset ids → { src, srcSet, sizes, blurDataURL, ... }).
  it("carries the T16 variant fields from a resolved record (srcSet + sizes + blur)", () => {
    const props = normalizeImageProps({
      src: {
        assetId: "ast_1",
        src: "https://cdn/photo.png",
        srcSet: "https://cdn/photo.320w.webp 320w, https://cdn/photo.640w.avif 640w",
        sizes: "(max-width: 640px) 100vw, 640px",
        blurDataURL: "data:image/svg+xml,%3Csvg…%3E",
        width: 1000,
        height: 600,
      },
      alt: "A photo",
    });
    expect(props.src).toBe("https://cdn/photo.png");
    expect(props.srcSet).toContain("photo.320w.webp 320w");
    expect(props.sizes).toBe("(max-width: 640px) 100vw, 640px");
    expect(props.blurDataURL).toMatch(/^data:image\/svg\+xml,/);
    expect(props.width).toBe(1000);
    expect(props.height).toBe(600);
  });

  it("accepts flat srcSet/sizes/blurDataURL props (snapshot-builder flattening)", () => {
    const props = normalizeImageProps({
      src: "https://cdn/photo.png",
      srcSet: "https://cdn/photo.320w.webp 320w",
      sizes: "100vw",
      blurDataURL: "data:image/svg+xml,%3Csvg%3E",
      alt: "flat",
    });
    expect(props.srcSet).toBe("https://cdn/photo.320w.webp 320w");
    expect(props.sizes).toBe("100vw");
    expect(props.blurDataURL).toMatch(/^data:image\/svg\+xml,/);
  });
});

describe("normalizeButtonProps", () => {
  it("maps label/href/style variants", () => {
    expect(normalizeButtonProps({ label: "Go", href: "/x", style: "secondary" })).toEqual({
      label: "Go",
      href: "/x",
      variant: "secondary",
    });
    expect(normalizeButtonProps({ text: "Go", url: "/y", style: "outline" }).variant).toBe("outline");
  });

  it("defaults unknown styles to primary and nulls unsafe hrefs", () => {
    expect(normalizeButtonProps({ label: "Go", href: "/x" }).variant).toBe("primary");
    expect(normalizeButtonProps({ label: "Go", href: "javascript:x" }).href).toBeNull();
  });
});

describe("normalizeSectionProps", () => {
  it("maps known paddings and defaults to md", () => {
    expect(normalizeSectionProps({ padding: "lg" }).padding).toBe("lg");
    expect(normalizeSectionProps({ padding: "nope" }).padding).toBe("md");
    expect(normalizeSectionProps({}).padding).toBe("md");
  });

  it("resolves backgrounds: colors, var(), and token aliases", () => {
    expect(normalizeSectionProps({ background: "#112233" }).background).toBe("#112233");
    expect(normalizeSectionProps({ background: "muted" }).background).toBe("var(--ff-muted)");
    expect(normalizeSectionProps({ background: "color.bg" }).background).toBe("var(--ff-bg)");
    expect(normalizeSectionProps({ background: "var(--ff-primary)" }).background).toBe("var(--ff-primary)");
  });

  it("refuses unknown token names as backgrounds", () => {
    expect(normalizeSectionProps({ background: "url(javascript:x)" }).background).toBeNull();
    expect(normalizeSectionProps({ background: "weird-token" }).background).toBeNull();
    expect(resolveBackground(42)).toBeNull();
  });
});

describe("isBlockRenderable", () => {
  it("accepts blocks with a kind", () => {
    expect(isBlockRenderable({ id: "b1", kind: "hero", props: {} })).toBe(true);
  });

  it("rejects hidden, malformed and kind-less blocks", () => {
    expect(isBlockRenderable({ id: "b1", kind: "hero", hidden: true })).toBe(false);
    expect(isBlockRenderable({ id: "b1" })).toBe(false);
    expect(isBlockRenderable(undefined)).toBe(false);
    expect(isBlockRenderable(null)).toBe(false);
    expect(isBlockRenderable("hero" as never)).toBe(false);
  });
});
