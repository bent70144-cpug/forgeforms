// §10 — gallery editor "Add image…" row opens the host asset picker.
// Static-render tests (node env, no jsdom — the package's test posture); the
// live click-through (seam → append) is covered in apps/web's jsdom suite.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GalleryEditor } from "./editor";
import { GalleryProps, galleryDefaultProps } from "./schema";

describe("gallery editor Add image… (§10 asset picker)", () => {
  it("renders the Add image… button next to the manual assets textarea", () => {
    const props = GalleryProps.parse(galleryDefaultProps());
    const html = renderToStaticMarkup(
      h(GalleryEditor, { blockId: "blk_gal001", props, onChange: () => {} }),
    );
    expect(html).toContain('data-kind="gallery"');
    expect(html).toContain("Add image…");
    expect(html).toContain("Assets (one id/URL per line)"); // manual path kept
    expect(html).toContain('data-testid="gallery-add-image"');
  });

  it("disables the picker row with the editor", () => {
    const props = GalleryProps.parse(galleryDefaultProps());
    const html = renderToStaticMarkup(
      h(GalleryEditor, { blockId: "blk_gal001", props, onChange: () => {}, disabled: true }),
    );
    expect(html).toContain('disabled="" data-testid="gallery-add-image"');
  });

  it("the appended shapes parse against the props schema (plain id + alt record)", () => {
    const props = GalleryProps.parse(galleryDefaultProps());
    const plain = GalleryProps.parse({ ...props, assetIds: [...props.assetIds, "ast_new001"] });
    expect(plain.assetIds[1]).toBe("ast_new001");
    const withAlt = GalleryProps.parse({
      ...props,
      assetIds: [...props.assetIds, { assetId: "ast_new002", alt: "Launch day" }],
    });
    expect(withAlt.assetIds[1]).toEqual({ assetId: "ast_new002", alt: "Launch day" });
  });
});
