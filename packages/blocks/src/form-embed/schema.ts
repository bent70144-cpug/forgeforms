// packages/blocks — `form-embed` props schema (spec §7.2 action block:
// documentId of a published form). The id must be a public document short id
// (`doc_` + 22 base58 chars, spec §4). Existence + published state is enforced
// at publish time by the document service (spec §8), not by the schema.
// OWNED BY T21 (issue #21).
import { z } from "zod";

/** Public document ids: `doc_<22 base58 chars>` (spec §4, shared/ids.ts). */
export const DOCUMENT_ID_PATTERN = /^doc_[1-9A-HJ-NP-Za-km-z]{22}$/;

export const FormEmbedProps = z.strictObject({
  documentId: z.string().regex(DOCUMENT_ID_PATTERN, {
    message: "documentId must be a public document id (doc_…)",
  }),
});

export type FormEmbedProps = z.infer<typeof FormEmbedProps>;

/** Syntactically valid placeholder; renders the graceful "unpublished" frame. */
const PLACEHOLDER_DOCUMENT_ID = `doc_${"1".repeat(22)}`;

export const formEmbedDefaultProps = (): FormEmbedProps => ({
  documentId: PLACEHOLDER_DOCUMENT_ID,
});

/** The iframe src a published document is served from (spec §10.2). */
export function embedFrameSrc(documentId: string): string {
  return `/embed/${documentId}`;
}
