// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { Snapshot, SnapshotBlock } from "../../snapshot";
import { ScrollRenderer } from "../ScrollRenderer";
import { GoneView } from "../sections/GoneView";

function snapshot(blocks: SnapshotBlock[], overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    documentId: "doc-1",
    versionId: "ver-1",
    type: "page",
    title: "Landing",
    locale: "en",
    cssVars: { "color.bg": "#ffffff", primary: "#0a0a0a" },
    blocks,
    settings: { showBranding: true },
    ...overrides,
  };
}

describe("ScrollRenderer (SSR)", () => {
  it("renders hero, text, image, section and button blocks with theme vars", () => {
    const html = renderToString(
      ScrollRenderer({
        snapshot: snapshot([
          {
            id: "h1",
            kind: "hero",
            props: {
              title: "Hello FormForge",
              subtitle: "Build pages fast",
              imageSrc: "https://cdn/hero.png",
              cta: { label: "Start", href: "/start" },
            },
          },
          { id: "t1", kind: "text", props: { richText: "<p>Rich <b>text</b></p>" } },
          { id: "i1", kind: "image", props: { src: "https://cdn/i.png", alt: "An image", caption: "Cap" } },
          {
            id: "s1",
            kind: "section",
            props: { background: "muted", padding: "lg" },
            children: [{ id: "b1", kind: "button", props: { label: "Go", href: "/go", style: "outline" } }],
          },
        ]),
      }),
    );
    expect(html).toContain("Hello FormForge");
    expect(html).toContain('href="/start"');
    expect(html).toContain('src="https://cdn/hero.png"');
    expect(html).toContain("<p>Rich <b>text</b></p>");
    expect(html).toContain('src="https://cdn/i.png"');
    expect(html).toContain('alt="An image"');
    expect(html).toContain("background-color:var(--ff-muted)");
    expect(html).toContain('href="/go"');
    expect(html).toContain("Go");
    // theme vars on the wrapper (normalized from "color.bg"/"primary")
    expect(html).toContain("--ff-bg:#ffffff");
    expect(html).toContain("--ff-primary:#0a0a0a");
    // branding badge (showBranding defaults true)
    expect(html).toContain("FormForge");
    expect(html).toContain('lang="en"');
  });

  it("renders an image placeholder when the asset URL is unresolved", () => {
    const html = renderToString(
      ScrollRenderer({ snapshot: snapshot([{ id: "i1", kind: "image", props: { alt: "mising" } }]) }),
    );
    expect(html).toContain("Image placeholder");
    expect(html).not.toContain("<img");
  });

  // T16 (issue #16) acceptance — "Generated image variants served with srcset
  // + blur placeholder in renderer": a resolved ImageAssetRef (asset row with
  // process-image variants, signed URLs) renders srcset/sizes + the LQIP blur.
  it("serves T16 image variants with srcset + blur placeholder", () => {
    const html = renderToString(
      ScrollRenderer({
        snapshot: snapshot([
          {
            id: "i1",
            kind: "image",
            props: {
              src: {
                assetId: "ast_1",
                src: "https://cdn/photo.png",
                srcSet: "https://cdn/photo.320w.webp 320w, https://cdn/photo.640w.avif 640w",
                sizes: "(max-width: 640px) 100vw, 640px",
                blurDataURL: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E",
                width: 1000,
                height: 600,
              },
              alt: "A photo",
            },
          },
        ]),
      }),
    );
    expect(html).toContain('src="https://cdn/photo.png"');
    expect(html).toContain('srcSet="https://cdn/photo.320w.webp 320w, https://cdn/photo.640w.avif 640w"');
    expect(html).toContain('sizes="(max-width: 640px) 100vw, 640px"');
    expect(html).toContain('width="1000"');
    expect(html).toContain('height="600"');
    expect(html).toContain("background-image:url(");
    expect(html).toContain("data:image/svg+xml");
  });

  it("keeps a plain <img> when the snapshot carries no variant fields", () => {
    const html = renderToString(
      ScrollRenderer({ snapshot: snapshot([{ id: "i1", kind: "image", props: { src: "https://cdn/i.png", alt: "p" } }]) }),
    );
    expect(html).toContain("<img");
    expect(html).not.toContain("srcSet");
    expect(html).not.toContain("background-image");
  });

  it("skips unknown blocks without crashing and warns server-side", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderToString(
      ScrollRenderer({
        snapshot: snapshot([
          { id: "u1", kind: "gallery", props: {} },
          { id: "h1", kind: "hero", props: { title: "Still here" } },
        ]),
      }),
    );
    expect(html).toContain("Still here");
    expect(html).not.toContain("gallery");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown block kind "gallery"'));
    warn.mockRestore();
  });

  it("honours showBranding: false and custom locale", () => {
    const html = renderToString(
      ScrollRenderer({
        snapshot: snapshot([{ id: "h1", kind: "hero", props: { title: "X" } }], {
          settings: { showBranding: false },
          locale: "de",
        }),
      }),
    );
    expect(html).not.toContain("FormForge");
    expect(html).toContain('lang="de"');
  });

  it("renders an empty page (with warning) for a blocks-less snapshot", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderToString(ScrollRenderer({ snapshot: snapshot([]) }));
    expect(html).toContain("ff-scroll");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no blocks"));
    warn.mockRestore();
  });
});

describe("GoneView (SSR)", () => {
  it("renders the unavailable page without client JS", () => {
    const html = renderToString(GoneView({ locale: "en" }));
    expect(html).toContain("This page is no longer available");
    expect(html).toContain("410");
    expect(html).toContain('href="/"');
  });
});
