// packages/blocks — `hero` props schema (spec §7.2: title, subtitle,
// imageAssetId, cta{label,href}).
// OWNED BY T06 (issue #6).
import { z } from "zod";

export const HeroProps = z.strictObject({
  title: z.string().min(1).max(300),
  subtitle: z.string().max(1000).default(""),
  imageAssetId: z.string().min(1).optional(),
  cta: z
    .strictObject({
      label: z.string().min(1).max(200),
      // Relative URLs are allowed (e.g. "/signup"); scheme checked at render.
      href: z.string().min(1).max(2048),
    })
    .optional(),
});

export type HeroProps = z.infer<typeof HeroProps>;

export const heroDefaultProps = (): HeroProps => ({
  title: "Hero title",
  subtitle: "",
});
