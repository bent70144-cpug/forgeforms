// packages/blocks — `pricing` props schema (spec §7.2: tiers[{name,price,
// features[],cta}]). `price` stays a free-form string ("$0", "€19/mo", "Custom")
// because §7.2 does not pin currency/units.
// OWNED BY T21 (issue #21).
import { z } from "zod";

export const PricingCta = z.strictObject({
  label: z.string().min(1).max(200),
  // Relative URLs are allowed (e.g. "/signup"); scheme checked at render.
  href: z.string().min(1).max(2048),
});

export const PricingTier = z.strictObject({
  name: z.string().min(1).max(200),
  price: z.string().max(100).default(""),
  features: z.array(z.string().min(1).max(500)).max(20).default([]),
  cta: PricingCta.optional(),
});

export const PricingProps = z.strictObject({
  tiers: z
    .array(PricingTier)
    .max(10)
    .default([
      { name: "Free", price: "$0", features: ["Up to 3 forms", "100 submissions/mo"] },
      { name: "Pro", price: "$19", features: ["Unlimited forms", "Custom domains"], cta: { label: "Start free trial", href: "/signup" } },
    ]),
});

export type PricingCta = z.infer<typeof PricingCta>;
export type PricingTier = z.infer<typeof PricingTier>;
export type PricingProps = z.infer<typeof PricingProps>;

export const pricingDefaultProps = (): PricingProps => ({
  tiers: [
    { name: "Free", price: "$0", features: ["Up to 3 forms", "100 submissions/mo"] },
    {
      name: "Pro",
      price: "$19",
      features: ["Unlimited forms", "Custom domains"],
      cta: { label: "Start free trial", href: "/signup" },
    },
  ],
});
