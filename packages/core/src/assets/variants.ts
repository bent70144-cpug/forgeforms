// T16 (issue #16) — image variant pipeline (spec §12 job `process-image`:
// "WebP/AVIF variants"; §6 image block; ticket acceptance: "Generated image
// variants served with srcset + blur placeholder in renderer").
//
// No native image decoder is available in this build (sharp is a native dep
// the sandbox cannot re-encode with), so the pipeline is split:
//   - dimension parsing: REAL — reads PNG/GIF/JPEG/WebP headers byte-exact;
//   - variant planning: REAL — pure ladder computation (widths × formats);
//   - blur placeholder: REAL inline-SVG LQIP (degrades gracefully, no decode);
//   - re-encoding: INTEGRATION-DEBT — the transcoding worker must re-encode
//     bytes per planned variant with sharp/r2 (`AssetTranscoder` seam below);
//     until wired, variants reference their planned object keys and the job
//     stores the plan so signed srcset URLs resolve at render time.
//
// T21 CONFORMANCE CONTRACT (packages/blocks/src/shared/img.tsx): output feeds
// `resolveImgProps` — a record `{ assetId, src, srcSet, sizes, blurDataURL,
// width, height }`. Verified by a conformance test in @formforge/renderer.

export const IMAGE_SIZES_DEFAULT: readonly number[] = Object.freeze([320, 640, 960, 1280]);
/** Standard responsive `sizes` hint for full-width content images. */
export const SRCSET_SIZES_ATTR = "(max-width: 640px) 100vw, 640px";
export const IMAGE_FORMATS: readonly ("webp" | "avif")[] = Object.freeze(["webp", "avif"]);

const RASTER_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

export function isRasterImageMime(mime: string): boolean {
  return RASTER_MIMES.has(mime.toLowerCase());
}

export type ImageDimensions = { width: number; height: number };

/**
 * Intrinsic dimensions from the file header — no decoder, first bytes only
 * (mirrors the upload-confirm readRange window). `null` when unparseable
 * (avif needs an ISO-BMFF box walk; transcoding supplies it later).
 */
export function imageDimensions(mime: string, bytes: Uint8Array): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const normalized = mime.toLowerCase();

  if (normalized === "image/png" && bytes.length >= 24) {
    // IHDR width/height live at offsets 16/20 (big-endian).
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return valid(width, height);
  }

  if (normalized === "image/gif" && bytes.length >= 10) {
    // Logical screen descriptor: 16-bit little-endian at offsets 6/8.
    return valid(view.getUint16(6, true), view.getUint16(8, true));
  }

  if (normalized === "image/jpeg") {
    // Walk segment markers for SOF0..SOF15 (excluding DHT/DAC/JPG).
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        // height at +5, width at +7 (big-endian, 16-bit each)
        return valid(view.getUint16(offset + 7), view.getUint16(offset + 5));
      }
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength <= 2) break;
      offset += 2 + segmentLength;
    }
    return null;
  }

  if (normalized === "image/webp" && bytes.length >= 30) {
    const fourcc = new TextDecoder().decode(bytes.slice(12, 16));
    if (fourcc === "VP8X") {
      // Canvas size stored as 24-bit LE (value - 1) at offsets 24/27.
      const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return valid(width, height);
    }
    if (fourcc === "VP8 ") {
      // Lossy VP8 frame: 14-bit width/height at offsets 26/28 (LE).
      return valid(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    }
    if (fourcc === "VP8L") {
      // Lossless: packed 14-bit bits at offset 21: w-1 in bits 0..13, h-1 in 14..27.
      const bits = view.getUint32(21, true);
      return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    return null;
  }

  return null;
}

function valid(width: number, height: number): ImageDimensions | null {
  return width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { width, height } : null;
}

/* ------------------------------------------------------------------ *
 * Variant planning
 * ------------------------------------------------------------------ */

/** `<dir>/<base>.<width>w.<format>` — sibling of the original object key (extension stripped). */
export function variantKey(key: string, width: number, format: "webp" | "avif"): string {
  const dot = key.lastIndexOf(".");
  const slash = key.lastIndexOf("/");
  const base = dot > slash && dot > 0 ? key.slice(0, dot) : key;
  return `${base}.${width}w.${format}`;
}

export type PlannedVariants = {
  width: number;
  height: number;
  variants: Array<{ key: string; format: "webp" | "avif"; width: number }>;
  sizes: string;
  blurDataURL: string;
};

/**
 * Plan the responsive ladder for an intrinsic size: every default size
 * strictly below the intrinsic width, in both formats; tiny images fall back
 * to a single intrinsic-size pair so `srcset` is never empty.
 */
export function planImageVariants(key: string, dims: ImageDimensions): PlannedVariants {
  const sizes = IMAGE_SIZES_DEFAULT.filter((w) => w < dims.width);
  const effective = sizes.length > 0 ? sizes : [dims.width];
  const variants = effective.flatMap((width) =>
    IMAGE_FORMATS.map((format) => ({ key: variantKey(key, width, format), format, width })),
  );
  return {
    width: dims.width,
    height: dims.height,
    variants,
    sizes: SRCSET_SIZES_ATTR,
    blurDataURL: blurPlaceholder(dims.width, dims.height),
  };
}

/** Assemble an HTML `srcset` value: `<signedUrl> <width>w` entries. */
export async function srcSetFor(
  plan: Pick<PlannedVariants, "variants">,
  sign: (key: string) => Promise<string> | string,
): Promise<string> {
  const entries: string[] = [];
  for (const variant of plan.variants) {
    entries.push(`${await sign(variant.key)} ${variant.width}w`);
  }
  return entries.join(", ");
}

/* ------------------------------------------------------------------ *
 * Blur placeholder (LQIP)
 * ------------------------------------------------------------------ */

/**
 * Inline-SVG low-quality placeholder (data URI). Deterministic for a given
 * aspect ratio so snapshots cache stably; browsers paint it behind the image
 * while the full source loads (T21 `Img` blurDataURL behavior).
 */
export function blurPlaceholder(width: number, height: number): string {
  const w = Math.max(1, Math.min(48, Math.round(width / 20) || 1));
  const h = Math.max(1, Math.min(48, Math.round((width > 0 ? height / width : 1) * w) || 1));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><filter id="b"><feGaussianBlur stdDeviation="1.5"/></filter></defs>` +
    `<rect width="100%" height="100%" fill="#e8e6e1"/>` +
    `<rect width="100%" height="100%" fill="#d6d3cd" filter="url(#b)"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* ------------------------------------------------------------------ *
 * T21 conformance mapping
 * ------------------------------------------------------------------ */

/** Structural subset of the asset row (avoids importing the db layer). */
export type AssetRowLike = {
  id: string;
  key: string;
  mime: string;
  variants: {
    width: number;
    height: number;
    sizes: string;
    blurDataURL: string;
    variants: Array<{ key: string; format: "webp" | "avif"; width: number }>;
  } | null;
};

/**
 * Map an asset row (+ signer) to the resolved record `resolveImgProps` and
 * `ImageAssetRefSchema` accept. `null` → blocks render a plain `<img>` from
 * the raw asset id (graceful degradation, T21 contract).
 */
export async function resolveImageAssetRef(
  row: AssetRowLike,
  sign: (key: string) => Promise<string> | string,
): Promise<{
  assetId: string;
  src: string;
  srcSet: string;
  sizes: string;
  blurDataURL: string;
  width: number;
  height: number;
} | null> {
  if (!isRasterImageMime(row.mime) || !row.variants) return null;
  return {
    assetId: row.id,
    src: await sign(row.key),
    srcSet: await srcSetFor(row.variants, sign),
    sizes: row.variants.sizes,
    blurDataURL: row.variants.blurDataURL,
    width: row.variants.width,
    height: row.variants.height,
  };
}
