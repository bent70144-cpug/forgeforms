// T16 — image pipeline: intrinsic-dimension sniffing, variant planning,
// srcset assembly and the T21 conformance mapping (spec §12 process-image:
// "WebP/AVIF variants", §8 snapshot step 3: asset ids → URLs).

import { describe, expect, it } from "vitest";
import {
  IMAGE_SIZES_DEFAULT,
  SRCSET_SIZES_ATTR,
  blurPlaceholder,
  imageDimensions,
  isRasterImageMime,
  planImageVariants,
  resolveImageAssetRef,
  srcSetFor,
  variantKey,
  type AssetRowLike,
} from "./variants.ts";

/** PNG with a 32×20 IHDR (bytes 16..24 big-endian width/height). */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const jpegWith = (w: number, h: number): Uint8Array => {
  // SOI + a properly sized APP0 (segment length includes its own 2 bytes) +
  // SOF0 with the real height/width ordering (height first!).
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x0c, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff];
  return new Uint8Array([...soi, ...app0, ...sof0]);
};

describe("imageDimensions — header parsing (no decoder deps)", () => {
  it("reads PNG IHDR", () => {
    expect(imageDimensions("image/png", pngHeader(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it("reads JPEG SOF markers", () => {
    expect(imageDimensions("image/jpeg", jpegWith(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("reads GIF logical screen descriptor", () => {
    const gif = new TextEncoder().encode("GIF89a");
    const bytes = new Uint8Array(gif.length + 6);
    bytes.set(gif);
    const view = new DataView(bytes.buffer);
    view.setUint16(gif.length, 320, true);
    view.setUint16(gif.length + 2, 240, true);
    expect(imageDimensions("image/gif", bytes)).toEqual({ width: 320, height: 240 });
  });

  it("reads WebP VP8X canvas size", () => {
    // RIFF(4) size(4) WEBP(4) VP8X(4) chunksize(4) flags(4) | w-1 (24bit LE) h-1 (24bit LE)
    const bytes = new Uint8Array(30);
    bytes.set(new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8X"));
    // 639 = 0x7F 0x02 0x00 (little-endian 24-bit), 479 = 0xDF 0x01 0x00
    bytes.set([0x7f, 0x02, 0x00], 24);
    bytes.set([0xdf, 0x01, 0x00], 27);
    expect(imageDimensions("image/webp", bytes)).toEqual({ width: 640, height: 480 });
  });

  it("returns null for avif (no pure-TS parser) and non-images", () => {
    expect(imageDimensions("image/avif", new Uint8Array(64))).toBeNull();
    expect(imageDimensions("application/pdf", new Uint8Array(64))).toBeNull();
  });
});

describe("planImageVariants — WebP/AVIF responsive ladder", () => {
  it("plans webp+avif at every size below the intrinsic width", () => {
    const plan = planImageVariants("media/ws/a/photo.png", { width: 1000, height: 600 });
    expect(plan.width).toBe(1000);
    expect(plan.height).toBe(600);
    expect(plan.variants.map((v) => `${v.format}@${v.width}`)).toEqual([
      "webp@320", "avif@320", "webp@640", "avif@640", "webp@960", "avif@960",
    ]);
    expect(plan.variants[0]!.key).toBe("media/ws/a/photo.320w.webp");
    expect(plan.sizes).toBe(SRCSET_SIZES_ATTR);
    expect(plan.blurDataURL.startsWith("data:image/svg+xml,")).toBe(true);
  });

  it("keeps the ladder bounded for huge images and non-degenerate for tiny ones", () => {
    const huge = planImageVariants("k.png", { width: 4000, height: 3000 });
    expect(huge.variants.some((v) => v.width === 1280)).toBe(true);
    const tiny = planImageVariants("k.png", { width: 120, height: 90 });
    expect(tiny.variants.map((v) => `${v.format}@${v.width}`)).toEqual(["webp@120", "avif@120"]);
  });
});

describe("variantKey + srcSetFor", () => {
  it("derives `<base>.<width>w.<format>` keys", () => {
    expect(variantKey("media/ws/a/photo.png", 320, "webp")).toBe("media/ws/a/photo.320w.webp");
    expect(variantKey("media/ws/a/photo", 640, "avif")).toBe("media/ws/a/photo.640w.avif");
  });

  it("assembles an HTML srcset with signed urls + width descriptors", async () => {
    const plan = planImageVariants("media/ws/a/photo.png", { width: 700, height: 500 });
    const srcSet = await srcSetFor(plan, (key) => `https://cdn/${key}?sig=1`);
    expect(srcSet).toBe(
      [
        "https://cdn/media/ws/a/photo.320w.webp?sig=1 320w",
        "https://cdn/media/ws/a/photo.320w.avif?sig=1 320w",
        "https://cdn/media/ws/a/photo.640w.webp?sig=1 640w",
        "https://cdn/media/ws/a/photo.640w.avif?sig=1 640w",
      ].join(", "),
    );
  });

  it("exposes the default sizes ladder (IMAGE_SIZES_DEFAULT)", () => {
    expect(IMAGE_SIZES_DEFAULT).toEqual([320, 640, 960, 1280]);
  });
});

describe("resolveImageAssetRef — T21 ImageAssetRef conformance", () => {
  const row: AssetRowLike = {
    id: "asset-1",
    key: "media/ws/a/photo.png",
    mime: "image/png",
    variants: {
      width: 1000,
      height: 600,
      sizes: SRCSET_SIZES_ATTR,
      blurDataURL: blurPlaceholder(1000, 600),
      variants: [
        { key: "media/ws/a/photo.320w.webp", format: "webp", width: 320 },
        { key: "media/ws/a/photo.320w.avif", format: "avif", width: 320 },
        { key: "media/ws/a/photo.640w.webp", format: "webp", width: 640 },
        { key: "media/ws/a/photo.640w.avif", format: "avif", width: 640 },
      ],
    },
  };

  it("maps an asset row to the resolved ImageAssetRef record shape", async () => {
    const ref = await resolveImageAssetRef(row, (key) => `https://cdn/${key}`);
    expect(ref).not.toBeNull();
    expect(ref!.assetId).toBe("asset-1");
    expect(ref!.src).toBe("https://cdn/media/ws/a/photo.png");
    expect(ref!.width).toBe(1000);
    expect(ref!.height).toBe(600);
    expect(ref!.sizes).toBe(SRCSET_SIZES_ATTR);
    expect(ref!.srcSet).toContain("photo.320w.webp 320w");
    expect(ref!.blurDataURL).toMatch(/^data:image\/svg\+xml,/);
  });

  it("returns null for non-raster assets and null variants (plain <img> degradation)", async () => {
    expect(await resolveImageAssetRef({ ...row, mime: "application/pdf" }, (k) => k)).toBeNull();
    expect(await resolveImageAssetRef({ ...row, variants: null }, (k) => k)).toBeNull();
  });

  it("isRasterImageMime matches the pipeline inputs", () => {
    expect(isRasterImageMime("image/png")).toBe(true);
    expect(isRasterImageMime("image/webp")).toBe(true);
    expect(isRasterImageMime("image/svg+xml")).toBe(false);
    expect(isRasterImageMime("text/csv")).toBe(false);
  });
});
