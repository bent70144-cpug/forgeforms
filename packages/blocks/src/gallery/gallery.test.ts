// T21 — `gallery` schema + editor round-trip (spec §7.2: assetIds[], layout
// grid/masonry, columns).
import { describe, expect, it } from "vitest";
import { GalleryProps, galleryDefaultProps } from "./schema";
import { resolveImgProps } from "../shared/img";

describe("gallery props schema", () => {
  it("parses defaultProps (registration-time proof)", () => {
    expect(GalleryProps.parse(galleryDefaultProps())).toEqual({
      assetIds: ["ast_sample001"],
      layout: "grid",
      columns: 3,
    });
  });

  it("fills defaults for layout and columns", () => {
    const props = GalleryProps.parse({ assetIds: ["ast_0001"] });
    expect(props.layout).toBe("grid");
    expect(props.columns).toBe(3);
  });

  it("accepts the T16 resolved asset record shape", () => {
    const props = GalleryProps.parse({
      assetIds: [{ src: "https://cdn.example.com/a-800w.jpg", srcSet: "a 400w", blurDataURL: "data:x" }],
    });
    expect(resolveImgProps(props.assetIds[0])).toMatchObject({ src: "https://cdn.example.com/a-800w.jpg" });
  });

  it("rejects columns outside 1–6", () => {
    expect(GalleryProps.safeParse({ assetIds: [], columns: 0 }).success).toBe(false);
    expect(GalleryProps.safeParse({ assetIds: [], columns: 7 }).success).toBe(false);
    expect(GalleryProps.safeParse({ assetIds: [], columns: 2.5 }).success).toBe(false);
  });

  it("rejects an unknown layout", () => {
    expect(GalleryProps.safeParse({ assetIds: [], layout: "carousel" }).success).toBe(false);
  });

  it("rejects an empty asset reference", () => {
    expect(GalleryProps.safeParse({ assetIds: [""] }).success).toBe(false);
    expect(GalleryProps.safeParse({ assetIds: [{}] }).success).toBe(false);
  });

  it("rejects unknown prop keys (strict)", () => {
    expect(GalleryProps.safeParse({ assetIds: [], bogus: 1 }).success).toBe(false);
  });

  it("round-trips an editor edit (layout → masonry, columns → 2)", () => {
    const props = GalleryProps.parse(galleryDefaultProps());
    const edited: unknown = { ...props, layout: "masonry", columns: 2 };
    expect(GalleryProps.parse(edited)).toEqual({ assetIds: ["ast_sample001"], layout: "masonry", columns: 2 });
  });
});
