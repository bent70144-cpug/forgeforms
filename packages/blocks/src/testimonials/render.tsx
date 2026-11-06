// packages/blocks — `testimonials` public renderer (server-safe).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { Img } from "../shared/img";
import { resolveImgProps } from "../shared/img";
import type { TestimonialsProps } from "./schema";

export const TestimonialsRender: FC<RenderProps<TestimonialsProps>> = ({ props }) => {
  if (props.items.length === 0) return null;
  return (
    <div className="ff-testimonials" data-block-kind="testimonials">
      {props.items.map((item, index) => {
        const avatar = item.avatarAssetId === undefined ? null : resolveImgProps(item.avatarAssetId);
        return (
          <figure key={`${item.name}-${index}`} className="ff-testimonials__item">
            <blockquote className="ff-testimonials__quote">“{item.quote}”</blockquote>
            <figcaption className="ff-testimonials__attribution">
              {avatar !== null ? (
                <Img img={avatar} alt={`Portrait of ${item.name}`} className="ff-testimonials__avatar" />
              ) : null}
              <span>
                <span className="ff-testimonials__name">{item.name}</span>
                {item.role !== "" ? <span className="ff-testimonials__role"> — {item.role}</span> : null}
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
};
