// packages/blocks — `video` props schema (spec §7.2: url, YouTube/Vimeo
// allowlist). The allowlist is enforced at the schema level, so non-allowlisted
// URLs are rejected on save, on publish (parseDocument) and in the editor.
// OWNED BY T21 (issue #21).
import { z } from "zod";
import { isAllowedVideoUrl } from "./url";

export const VideoProps = z.strictObject({
  url: z
    .string()
    .min(1)
    .max(2048)
    .refine(isAllowedVideoUrl, { message: "Video URL must point at YouTube or Vimeo" }),
});

export type VideoProps = z.infer<typeof VideoProps>;

export const videoDefaultProps = (): VideoProps => ({
  url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
});
