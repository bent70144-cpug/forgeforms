// packages/blocks — `gallery` props schema (spec §7.2: assetIds[], layout
// grid/masonry, columns). Image entries flow through the T16 adapter seam
// (shared/img): plain asset ids today, resolved {src,srcSet,blur} records later.
// OWNED BY T21 (issue #21).
import { z } from "zod";
import { ImageAssetRefSchema } from "../shared/img";

export const GalleryLayout = z.enum(["grid", "masonry"]);

export const GalleryProps = z.strictObject({
  assetIds: z.array(ImageAssetRefSchema).max(50).default([]),
  layout: GalleryLayout.default("grid"),
  columns: z.number().int().min(1).max(6).default(3),
});

export type GalleryLayout = z.infer<typeof GalleryLayout>;
export type GalleryProps = z.infer<typeof GalleryProps>;

/** Placeholder until a real asset is chosen; renders a sample slot, not an error. */
const SAMPLE_ASSET_ID = "ast_sample001";

export const galleryDefaultProps = (): GalleryProps => ({
  assetIds: [SAMPLE_ASSET_ID],
  layout: "grid",
  columns: 3,
});
