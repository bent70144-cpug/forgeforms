// Documents API schemas for /api/v1 (spec §11, endpoints marked docs:*).
// The OpenAPI document (issue #25) is generated from these.
//
// T07 (issue #7) refinements: the PATCH ops vocabulary now composes the
// canonical `DocumentOpSchema` (src/ops.ts) instead of a permissive stub, and
// the GET /documents/{id} builder envelope + PATCH response schemas are pinned.
import { z } from 'zod';
import { PatchDocumentOpsSchema } from '../ops';
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
 * GET /api/v1/documents/{id} — the builder envelope (spec §11 "Get draft +
 * metadata"; T08 DocumentTransport contract). `body` is the current draft.
 */
export const DocumentEnvelopeSchema = DocumentSummarySchema.extend({
  body: z.unknown(),
  publishedVersionId: z.string().uuid().nullable(),
});
export type DocumentEnvelope = z.infer<typeof DocumentEnvelopeSchema>;

/**
 * PATCH /api/v1/documents/{id} — ops-based apply with optimistic concurrency
 * (`baseRev`); ops are the §8 vocabulary from src/ops.ts.
 */
export const PatchDocumentRequestSchema = PatchDocumentOpsSchema;
export type PatchDocumentRequest = z.infer<typeof PatchDocumentRequestSchema>;

/** PATCH 200 response — the authoritative rev + resulting draft body. */
export const PatchDocumentResponseSchema = z.object({
  rev: z.number().int().min(0),
  updatedAt: z.string().datetime(),
  body: z.unknown(),
});
export type PatchDocumentResponse = z.infer<typeof PatchDocumentResponseSchema>;

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
