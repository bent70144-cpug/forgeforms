// packages/blocks — `gallery` public renderer (server-safe).
// Grid → CSS grid; masonry → CSS multi-columns. Missing/invalid asset refs are
// skipped gracefully (never crash on stored data).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { Img } from "../shared/img";
import { resolveImgProps } from "../shared/img";
import type { GalleryProps } from "./schema";

export const GalleryRender: FC<RenderProps<GalleryProps>> = ({ props }) => {
  const items = props.assetIds
    .map((ref) => resolveImgProps(ref))
    .filter((img): img is NonNullable<typeof img> => img !== null);
  if (items.length === 0) return null;

  const style =
    props.layout === "masonry"
      ? { columnCount: props.columns, columnGap: "1rem" }
      : {
          display: "grid",
          gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
          gap: "1rem",
        };

  return (
    <div
      className={`ff-gallery ff-gallery--${props.layout}`}
      data-block-kind="gallery"
      data-columns={props.columns}
      style={style}
    >
      {items.map((img, index) => (
        <figure
          key={`${img.src}-${index}`}
          className="ff-gallery__item"
          style={props.layout === "masonry" ? { breakInside: "avoid", margin: "0 0 1rem" } : { margin: 0 }}
        >
          <Img img={img} alt={`Gallery image ${index + 1}`} className="ff-gallery__image" />
        </figure>
      ))}
    </div>
  );
};
