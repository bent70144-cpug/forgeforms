// packages/blocks — `button` props schema (spec §7.2: label, href, style).
// OWNED BY T06 (issue #6).
import { z } from "zod";

// SPEC-NOTE: §7.2 lists `style` without pinning the variants; these three are
// the common set used across the design tokens (§14.3) and can be extended.
export const ButtonStyle = z.enum(["primary", "secondary", "ghost"]);

export const ButtonProps = z.strictObject({
  label: z.string().min(1).max(200),
  // Relative URLs are allowed (e.g. "/thanks"); scheme checked at render.
  href: z.string().min(1).max(2048),
  style: ButtonStyle.default("primary"),
});

export type ButtonStyle = z.infer<typeof ButtonStyle>;
export type ButtonProps = z.infer<typeof ButtonProps>;

export const buttonDefaultProps = (): ButtonProps => ({
  label: "Button",
  href: "#",
  style: "primary",
});
