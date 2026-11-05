import type { ReactElement } from "react";
import type { SnapshotBlock } from "../../bridge";
import {
  isBlockRenderable,
  normalizeButtonProps,
  normalizeHeroProps,
  normalizeImageProps,
  normalizeSectionProps,
  normalizeTextProps,
} from "../blocks";
import { ButtonSection } from "./ButtonSection";
import { HeroSection } from "./HeroSection";
import { ImageSection } from "./ImageSection";
import { SectionSection } from "./SectionSection";
import { TextSection } from "./TextSection";

/** Guard against pathological nesting in malformed snapshots. */
const MAX_SECTION_DEPTH = 8;

/**
 * Dispatch one snapshot block to its section renderer (spec §7.2 MVP content
 * blocks: hero, text, image, section, button). Unknown kinds (gallery, video,
 * testimonials, …) render as nothing and warn server-side — spec §7.1:
 * "unknown kind in a stored document renders as nothing (never crashes)".
 */
export function BlockSection({
  block,
  depth = 0,
}: {
  block: SnapshotBlock;
  depth?: number;
}): ReactElement | null {
  if (!isBlockRenderable(block)) return null;
  const kind = block.kind ?? "";
  const props = block.props ?? {};

  switch (kind) {
    case "hero":
      return <HeroSection props={normalizeHeroProps(props)} />;
    case "text":
      return <TextSection props={normalizeTextProps(props)} />;
    case "image":
      return <ImageSection props={normalizeImageProps(props)} />;
    case "button":
      return <ButtonSection props={normalizeButtonProps(props)} />;
    case "section": {
      if (depth >= MAX_SECTION_DEPTH) {
        console.warn(`[ff-scroll] section nesting exceeds ${MAX_SECTION_DEPTH} levels — skipped (id: ${block.id ?? "?"})`);
        return null;
      }
      const children = Array.isArray(block.children) ? block.children : [];
      return (
        <SectionSection props={normalizeSectionProps(props)}>
          {children.map((child, index) => (
            <BlockSection key={child?.id ?? `child-${String(index)}`} block={child} depth={depth + 1} />
          ))}
        </SectionSection>
      );
    }
    default:
      // Server-side only (no "use client" anywhere on the scroll path).
      console.warn(`[ff-scroll] skipping unknown block kind "${kind}" (id: ${block.id ?? "?"})`);
      return null;
  }
}
