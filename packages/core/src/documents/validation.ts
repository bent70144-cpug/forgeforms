/**
 * T10 — default DraftValidator.
 *
 * SPEC-NOTE / INTEGRATION-DEBT: the canonical DocumentBody Zod schema lands in
 * `packages/schema` (spec §7). Until then this structural guard enforces the
 * publish-critical minimum from §7 (schemaVersion=1, type, theme tokens, blocks
 * with stable ids, endings/logic shape) so garbage drafts cannot go live. Swap
 * this validator for the schema package's `DocumentBody.safeParse` wrapper at
 * integration — the DraftValidator port stays identical.
 */
import { z } from 'zod';
import type { DraftValidationIssue, DraftValidator } from './ports';

const BlockShape = z.looseObject({
  id: z.string().min(1),
  kind: z.string().min(1),
});

const DraftShape = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(['form', 'page', 'portfolio']),
  theme: z.object({
    tokens: z.record(z.string(), z.string()),
    fontHeading: z.string().optional(),
    fontBody: z.string().optional(),
    radius: z.enum(['none', 'sm', 'md', 'lg', 'full']).optional(),
  }),
  settings: z
    .looseObject({
      seo: z
        .looseObject({
          title: z.string().optional(),
          description: z.string().optional(),
          ogImageAssetId: z.string().optional(),
        })
        .optional(),
      locale: z.string().optional(),
      progressBar: z.boolean().optional(),
      autoAdvance: z.boolean().optional(),
      showBranding: z.boolean().optional(),
      captcha: z.boolean().optional(),
      closeAt: z.string().optional(),
      maxSubmissions: z.number().int().positive().optional(),
      notifyEmails: z.array(z.string()).optional(),
    })
    .optional(),
  blocks: z.array(BlockShape),
  endings: z
    .array(
      z.looseObject({
        id: z.string().min(1),
        title: z.string(),
        body: z.string().optional(),
        redirectUrl: z.string().optional(),
      }),
    )
    .optional(),
  logic: z.looseObject({ rules: z.array(z.unknown()).optional() }).optional(),
});

/** Publish-time guard per spec §8 step 1 (schema portion of "validate fully"). */
export const defaultDraftValidator: DraftValidator = {
  async validate(body: unknown): Promise<readonly DraftValidationIssue[]> {
    const parsed = DraftShape.safeParse(body);
    if (parsed.success) return [];
    return parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.') || '(root)',
      message: issue.message,
    }));
  },
};
