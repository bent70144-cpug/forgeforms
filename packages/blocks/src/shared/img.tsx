// packages/blocks — image props adapter + shared <img> (server-safe).
//
// The seam between content blocks and the T16 image pipeline (variants /
// srcset / blur placeholder). Blocks consume `ImgProps`; T16 conforms by
// feeding either a plain asset id/URL string or a resolved record.
//
// OWNED BY T21 (issue #21). T16 CONFORMANCE CONTRACT:
//   Feed `resolveImgProps` either
//     - a plain string (asset id or URL), or
//     - a resolved record `{ src, srcSet?, sizes?, blurDataURL?, width?, height?, alt? }`.
// Blocks degrade gracefully when T16 has not resolved variants yet: absent
// `srcSet`/`blurDataURL` simply produce a plain `<img>`.
import { z } from "zod";
import type { FC } from "react";

export type ImgProps = {
  src: string;
  srcSet?: string;
  sizes?: string;
  blurDataURL?: string;
  width?: number;
  height?: number;
  alt?: string;
};

/** What image-consuming block props accept before/after T16 resolution. */
export type ImageAssetRef =
  | string
  | {
      assetId?: string;
      src?: string;
      srcSet?: string;
      sizes?: string;
      blurDataURL?: string;
      width?: number;
      height?: number;
      alt?: string;
    };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Normalize any accepted asset reference into `ImgProps`, or `null` when there
 * is nothing renderable. Never throws — stored documents may carry anything.
 */
export function resolveImgProps(ref: ImageAssetRef | null | undefined): ImgProps | null {
  if (ref === null || ref === undefined) return null;

  if (typeof ref === "string") {
    const src = ref.trim();
    return src === "" ? null : { src };
  }
  if (typeof ref !== "object") return null;

  const rec = ref as Record<string, unknown>;
  const src = nonEmpty(rec.src) ? rec.src.trim() : nonEmpty(rec.assetId) ? rec.assetId.trim() : null;
  if (src === null) return null;

  const img: ImgProps = { src };
  if (nonEmpty(rec.srcSet)) img.srcSet = (rec.srcSet as string).trim();
  if (nonEmpty(rec.sizes)) img.sizes = (rec.sizes as string).trim();
  if (nonEmpty(rec.blurDataURL)) img.blurDataURL = (rec.blurDataURL as string).trim();
  if (positiveFinite(rec.width)) img.width = rec.width;
  if (positiveFinite(rec.height)) img.height = rec.height;
  if (nonEmpty(rec.alt)) img.alt = (rec.alt as string).trim();
  return img;
}

/* ---------------------------------------------------------------------------
 * Zod twin of `ImageAssetRef`, for use inside block props schemas (gallery,
 * testimonials, projects). Accepts the same two shapes: a plain asset id/URL
 * string, or a T16-resolved record (assetId or src required).
 * ------------------------------------------------------------------------- */

const ResolvedImageAsset = z
  .strictObject({
    assetId: z.string().min(1).max(200).optional(),
    src: z.string().min(1).max(4096).optional(),
    srcSet: z.string().min(1).max(8000).optional(),
    sizes: z.string().min(1).max(500).optional(),
    blurDataURL: z.string().min(1).max(8000).optional(),
    width: z.number().int().positive().max(100_000).optional(),
    height: z.number().int().positive().max(100_000).optional(),
    alt: z.string().min(1).max(500).optional(),
  })
  .refine((v) => v.assetId !== undefined || v.src !== undefined, {
    message: "Image asset reference requires an assetId or a src",
  });

export const ImageAssetRefSchema = z.union([z.string().min(1).max(4096), ResolvedImageAsset]);

/* ---------------------------------------------------------------------------
 * Shared <img> for content blocks.
 * --------------------------------------------------------------------------- */

/**
 * Graceful degradation: null img → renders nothing; missing srcSet/blur →
 * plain <img>; a blurDataURL paints a blurred background behind the image
 * while the full source loads.
 */
export const Img: FC<{
  img: ImgProps | null;
  alt: string;
  className?: string;
  eager?: boolean;
}> = ({ img, alt, className, eager }) => {
  if (img === null) return null;
  const style = img.blurDataURL
    ? {
        backgroundImage: `url("${img.blurDataURL.replaceAll('"', "%22")}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined;
  return (
    <img
      src={img.src}
      srcSet={img.srcSet}
      sizes={img.sizes}
      width={img.width}
      height={img.height}
      alt={img.alt ?? alt}
      className={className}
      style={style}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
};
