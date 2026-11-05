// packages/blocks — props shared by every question block (spec §7.2 note:
// "Every question block also supports generic props: description, required,
// buttonText, imageAssetId, prefillParam").
// OWNED BY T06 (issue #6).
import { z } from "zod";

// SPEC-NOTE: `prefillParam` format is not pinned by the spec; a URL-param-safe
// pattern is enforced so it can be embedded in public URLs unchanged.
export const QuestionPropsBase = z.strictObject({
  description: z.string().max(2000).optional(),
  required: z.boolean().default(false),
  buttonText: z.string().min(1).max(200).optional(),
  imageAssetId: z.string().min(1).optional(),
  prefillParam: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).optional(),
});

export type QuestionPropsBase = z.infer<typeof QuestionPropsBase>;
