import type { ImageViewProps } from "../blocks";

/**
 * Content block: image (spec §7.2). Renders a neutral placeholder box when the
 * snapshot carries no resolved URL (e.g. asset missing from storage) — the page
 * keeps its shape instead of collapsing.
 *
 * T16 (issue #16): a resolved asset with process-image variants carries
 * `srcSet`/`sizes` + `blurDataURL` (spec §12 "WebP/AVIF variants"; §6 image
 * block). They render additively — no variants → plain <img> (graceful
 * degradation, the T21 shared-Img contract).
 */
export function ImageSection({ props }: { props: ImageViewProps }) {
  const { src, alt, caption, width, height, srcSet, sizes, blurDataURL } = props;
  const blurStyle = blurDataURL
    ? {
        backgroundImage: `url("${blurDataURL.replaceAll('"', "%22")}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : undefined;
  return (
    <figure className="ff-section-image m-0 px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        {src !== null ? (
          // Plain <img> (no next/image): keeps the renderer framework-portable;
          // width/height pass through when the snapshot carries them (CLS-safe),
          // srcSet/sizes when the T16 pipeline produced responsive variants.
          <img
            src={src}
            srcSet={srcSet ?? undefined}
            sizes={sizes ?? undefined}
            alt={alt}
            width={width ?? undefined}
            height={height ?? undefined}
            loading="lazy"
            decoding="async"
            style={blurStyle}
            className="h-auto w-full rounded-[var(--ff-radius)] object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-56 w-full items-center justify-center rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-muted)]/10 text-sm text-[var(--ff-muted)]"
          >
            Image placeholder
          </div>
        )}
        {caption !== "" ? (
          <figcaption className="mt-3 text-center text-sm text-[var(--ff-muted)]">
            {caption}
          </figcaption>
        ) : null}
      </div>
    </figure>
  );
}
