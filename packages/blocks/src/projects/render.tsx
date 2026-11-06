// packages/blocks — `projects` public renderer (server-safe).
// Card per project: cover image (T16 seam), title, description, tags, link.
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { Img } from "../shared/img";
import { resolveImgProps } from "../shared/img";
import { safeHref } from "../shared/safe-href";
import type { ProjectsProps } from "./schema";

export const ProjectsRender: FC<RenderProps<ProjectsProps>> = ({ props }) => {
  if (props.items.length === 0) return null;
  return (
    <div className="ff-projects" data-block-kind="projects">
      {props.items.map((item, index) => {
        const cover = item.coverAssetId === undefined ? null : resolveImgProps(item.coverAssetId);
        const body = (
          <>
            {cover !== null ? (
              <Img img={cover} alt={`Cover of ${item.title}`} className="ff-projects__cover" />
            ) : null}
            <h3 className="ff-projects__title">{item.title}</h3>
            {item.description !== "" ? <p className="ff-projects__description">{item.description}</p> : null}
            {item.tags.length > 0 ? (
              <ul className="ff-projects__tags">
                {item.tags.map((tag, i) => (
                  <li key={i} className="ff-projects__tag">
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        );
        return item.link !== undefined ? (
          <a
            key={`${item.title}-${index}`}
            className="ff-projects__card ff-projects__card--linked"
            href={safeHref(item.link)}
          >
            {body}
          </a>
        ) : (
          <div key={`${item.title}-${index}`} className="ff-projects__card">
            {body}
          </div>
        );
      })}
    </div>
  );
};
