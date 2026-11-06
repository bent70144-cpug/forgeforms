// packages/blocks — `video` public renderer (server-safe).
// Converts the allowlisted page URL to a canonical embed-player URL and renders
// a privacy-friendly iframe. Degrades to a plain link when the video id cannot
// be derived (never crashes on stored data).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { toEmbedUrl } from "./url";
import type { VideoProps } from "./schema";

export const VideoRender: FC<RenderProps<VideoProps>> = ({ props }) => {
  const embedUrl = toEmbedUrl(props.url);
  if (embedUrl === null) {
    return (
      <p className="ff-video ff-video--fallback" data-block-kind="video">
        <a href={props.url} rel="noopener noreferrer nofollow" target="_blank">
          Watch the video
        </a>
      </p>
    );
  }
  return (
    <div className="ff-video" data-block-kind="video">
      <iframe
        className="ff-video__frame"
        src={embedUrl}
        title="Embedded video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
};
