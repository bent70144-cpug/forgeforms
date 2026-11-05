// Cursor pagination conventions (spec §4): `?limit=50&cursor=<opaque>` →
// `{ data: [...], nextCursor: string | null }`.
import { z } from 'zod';

export const LIMIT_DEFAULT = 50;
export const LIMIT_MAX = 100;

/** Shared query params for list endpoints. Values arrive as strings from the URL. */
export const CursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIMIT_MAX).default(LIMIT_DEFAULT).optional(),
  cursor: z.string().min(1).optional(),
});

/** Envelope for every list response. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export type CursorQuery = z.infer<typeof CursorQuerySchema>;
