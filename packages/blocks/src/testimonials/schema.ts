// packages/blocks — `testimonials` props schema (spec §7.2:
// items[{quote,name,role,avatarAssetId}]). Avatar references flow through the
// T16 adapter seam (shared/img).
// OWNED BY T21 (issue #21).
import { z } from "zod";
import { ImageAssetRefSchema } from "../shared/img";

export const TestimonialItem = z.strictObject({
  quote: z.string().min(1).max(2000),
  name: z.string().min(1).max(200),
  role: z.string().max(200).default(""),
  avatarAssetId: ImageAssetRefSchema.optional(),
});

export const TestimonialsProps = z.strictObject({
  items: z.array(TestimonialItem).max(20).default([
    {
      quote: "FormForge replaced three tools for us — forms, landing pages and portfolios.",
      name: "Ada Lovelace",
      role: "CTO, Analytical Engines",
    },
  ]),
});

export type TestimonialItem = z.infer<typeof TestimonialItem>;
export type TestimonialsProps = z.infer<typeof TestimonialsProps>;

export const testimonialsDefaultProps = (): TestimonialsProps => ({
  items: [
    {
      quote: "FormForge replaced three tools for us — forms, landing pages and portfolios.",
      name: "Ada Lovelace",
      role: "CTO, Analytical Engines",
    },
  ],
});
