// T21 — image props adapter: the seam between content blocks and the T16 image
// pipeline (variants/srcset/blur). Blocks consume `ImgProps`; T16 conforms by
// feeding either a plain asset id/URL string or a resolved record.
import { describe, expect, it } from "vitest";
import { resolveImgProps } from "./img";

describe("resolveImgProps (T16 adapter surface)", () => {
  it("accepts a plain asset id string with graceful fallback (no variants)", () => {
    expect(resolveImgProps("ast_0001")).toEqual({ src: "ast_0001" });
  });

  it("accepts a plain URL string", () => {
    expect(resolveImgProps("https://cdn.example.com/a.jpg")).toEqual({
      src: "https://cdn.example.com/a.jpg",
    });
  });

  it("trims whitespace-only strings to null", () => {
    expect(resolveImgProps("   ")).toBeNull();
    expect(resolveImgProps("")).toBeNull();
  });

  it("passes through the T16 resolved shape (srcSet + blur)", () => {
    const ref = {
      src: "https://cdn.example.com/a-800w.jpg",
      srcSet: "https://cdn.example.com/a-400w.jpg 400w, https://cdn.example.com/a-800w.jpg 800w",
      blurDataURL: "data:image/webp;base64,AAAA",
      width: 800,
      height: 600,
      alt: "Cover",
    };
    expect(resolveImgProps(ref)).toEqual(ref);
  });

  it("falls back to assetId when src is absent", () => {
    expect(resolveImgProps({ assetId: "ast_0002" })).toEqual({ src: "ast_0002" });
  });

  it("keeps srcSet/blur when only the asset id is resolved so far", () => {
    expect(resolveImgProps({ assetId: "ast_0003", srcSet: "a 400w", blurDataURL: "data:x" })).toEqual({
      src: "ast_0003",
      srcSet: "a 400w",
      blurDataURL: "data:x",
    });
  });

  it("drops malformed optional fields instead of crashing", () => {
    const malformed = { src: "s", srcSet: 42, blurDataURL: {}, width: -5, height: Number.NaN } as unknown as Parameters<
      typeof resolveImgProps
    >[0];
    expect(resolveImgProps(malformed)).toEqual({ src: "s" });
  });

  it("returns null for null/undefined/malformed refs", () => {
    expect(resolveImgProps(null)).toBeNull();
    expect(resolveImgProps(undefined)).toBeNull();
    expect(resolveImgProps(42 as unknown as string)).toBeNull();
    expect(resolveImgProps({})).toBeNull();
    expect(resolveImgProps({ src: "" })).toBeNull();
  });
});
