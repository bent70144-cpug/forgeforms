// packages/blocks — `section` props schema (spec §7.2 layout block: background,
// padding, children). Children live on the block node (`Block.children`), not
// in props — they arrive at Render via `RenderProps.children` (BlockView).
// OWNED BY T21 (issue #21).
import { z } from "zod";

export const SectionPadding = z.enum(["none", "sm", "md", "lg", "xl"]);

export const SectionProps = z.strictObject({
  // Theme token alias ("bg", "primary", …), CSS color or var() reference;
  // validated at render (see ./background.ts).
  background: z.string().max(100).optional(),
  padding: SectionPadding.default("md"),
});

export type SectionPadding = z.infer<typeof SectionPadding>;
export type SectionProps = z.infer<typeof SectionProps>;

export const sectionDefaultProps = (): SectionProps => ({
  background: "none",
  padding: "md",
});
