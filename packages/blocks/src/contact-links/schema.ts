// packages/blocks — `contact-links` props schema (spec §7.2: links[{type,url}]).
// `type` is an open-ish enum: the common contact surfaces plus "other", so new
// link kinds do not corrupt stored documents.
// OWNED BY T21 (issue #21).
import { z } from "zod";

export const ContactLinkType = z.enum([
  "email",
  "phone",
  "website",
  "github",
  "x",
  "twitter",
  "linkedin",
  "instagram",
  "youtube",
  "dribbble",
  "other",
]);

export const ContactLink = z.strictObject({
  type: ContactLinkType.default("other"),
  // Stored raw (email addresses have no scheme); scheme added at render.
  url: z.string().min(1).max(2048),
});

export const ContactLinksProps = z.strictObject({
  links: z.array(ContactLink).max(20).default([{ type: "email", url: "hello@example.com" }]),
});

export type ContactLinkType = z.infer<typeof ContactLinkType>;
export type ContactLink = z.infer<typeof ContactLink>;
export type ContactLinksProps = z.infer<typeof ContactLinksProps>;

export const contactLinksDefaultProps = (): ContactLinksProps => ({
  links: [{ type: "email", url: "hello@example.com" }],
});
