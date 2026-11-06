// packages/blocks — `faq` props schema (spec §7.2: items[{q,a}]).
// OWNED BY T21 (issue #21).
import { z } from "zod";

export const FaqItem = z.strictObject({
  q: z.string().min(1).max(1000),
  a: z.string().min(1).max(5000),
});

export const FaqProps = z.strictObject({
  items: z.array(FaqItem).max(50).default([
    {
      q: "What is FormForge?",
      a: "A form, page and portfolio builder with logic, analytics and embeds.",
    },
  ]),
});

export type FaqItem = z.infer<typeof FaqItem>;
export type FaqProps = z.infer<typeof FaqProps>;

export const faqDefaultProps = (): FaqProps => ({
  items: [
    {
      q: "What is FormForge?",
      a: "A form, page and portfolio builder with logic, analytics and embeds.",
    },
  ],
});
