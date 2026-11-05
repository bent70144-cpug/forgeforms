// Documents API schemas for /api/v1 (spec §11, endpoints marked docs:*).
// The demo route + OpenAPI document (issue #25) are generated from these.
//
// SPEC-NOTE: `draft` (DocumentBody) and the op vocabulary in PATCH
// /documents/{id} are owned by T06 (blocks) / T07 (documents API). They are
// typed as `unknown` / permissive here so this file stays stable; T07 refines.
import { z } from 'zod';
import { CursorQuerySchema, paginated } from './pagination';

export const DocumentTypeSchema = z.enum(['form', 'page', 'portfolio']);
export const DocumentStatusSchema = z.enum(['draft', 'published', 'archived']);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentSummarySchema = z.object({
  id: z.string().uuid(),
  type: DocumentTypeSchema,
  title: z.string().max(300),
  slug: z.string().max(300),
  status: DocumentStatusSchema,
  rev: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentDetailSchema = DocumentSummarySchema.extend({
  // DocumentBody — refined by T06/T07; intentionally opaque at this layer.
  draft: z.unknown(),
  publishedVersionId: z.string().uuid().nullable(),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const ListDocumentsQuerySchema = CursorQuerySchema.extend({
  type: DocumentTypeSchema.optional(),
  status: DocumentStatusSchema.optional(),
  q: z.string().max(200).optional(),
});

export const CreateDocumentRequestSchema = z.object({
  type: DocumentTypeSchema,
  title: z.string().trim().min(1).max(300),
  templateId: z.string().min(1).optional(),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;

export const ListDocumentsResponseSchema = paginated(DocumentSummarySchema);

/**
 * PATCH /api/v1/documents/{id} — ops-based apply with optimistic concurrency
 * (`baseRev`). Op shape is owned by T07; kept permissive here on purpose.
 */
export const PatchDocumentRequestSchema = z.object({
  baseRev: z.number().int().min(0),
  ops: z.array(
    z
      .object({ op: z.string().min(1) })
      .loose(),
  ),
});
export type PatchDocumentRequest = z.infer<typeof PatchDocumentRequestSchema>;

export const PublishDocumentResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('published'),
  publishedVersionId: z.string().uuid(),
  publishedAt: z.string().datetime(),
});

export const ConflictErrorSchema = z.object({
  error: z.object({
    code: z.literal('CONFLICT'),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
