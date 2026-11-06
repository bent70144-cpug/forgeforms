// packages/schema — theme (spec §7).
// OWNED BY T06 (issue #6).
import { z } from "zod";

export const Theme = z.object({
  tokens: z.record(z.string(), z.string()), // e.g. "color.bg": "#fbf9f4"
  fontHeading: z.string().default("Inter"),
  fontBody: z.string().default("Inter"),
  radius: z.enum(["none", "sm", "md", "lg", "full"]).default("md"),
});

export type Theme = z.infer<typeof Theme>;

/** Fully-defaulted theme, e.g. for new documents and the builder theme panel. */
export const DEFAULT_THEME: Theme = Theme.parse({ tokens: {} });
