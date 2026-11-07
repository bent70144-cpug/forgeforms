// Follow-up #5 (docs/builder-audit.md, §6.6/§22.1, §14) — slug availability
// check for the builder settings panel.
//
// Ctx-scoped like every documents service (spec §3/§4): first arg is the
// kernel `Ctx`, all repository calls carry `ctx.workspaceId` (slugs are unique
// per workspace, spec §6), and the result is the kernel `Result` with kernel
// `AppError`s. The check is READ-ONLY — availability failures surface to the
// author as an inline field note; saving still enforces uniqueness at PATCH
// time (crud.ts), so a stale probe can never write a colliding slug.
//
// The checked document itself is EXCLUDED from the collision scan (renaming to
// your own current slug is a no-op, not a conflict) and a taken slug gets the
// first free `slug-2`, `slug-3`, … suggestion — mirroring `uniqueSlug` in
// crud.ts so create/duplicate/probe never disagree.
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { CrudDocumentsRepo } from './crud-ports';

/** §6.6 General field rule, shared with the settings panel's client check. */
export const SLUG_FORMAT = /^[a-z0-9-]{3,60}$/;

export const SLUG_FORMAT_MESSAGE =
  'Slug must be 3–60 characters: lowercase letters, digits and hyphens';

export function isValidSlugFormat(slug: string): boolean {
  return SLUG_FORMAT.test(slug);
}

export type SlugCheckDeps = {
  documents: Pick<CrudDocumentsRepo, 'getById' | 'findBySlug'>;
};

export type SlugCheckResult = {
  available: boolean;
  /** First free `slug-2`, `slug-3`, … variant. Present only when taken. */
  suggestion?: string;
};

/** First free `slug`, `-2`, `-3`, … within the workspace, ignoring
 * `ignoreDocumentId` (same walk as crud.ts `uniqueSlug`). */
async function firstFreeSuggestion(
  repo: SlugCheckDeps['documents'],
  workspaceId: string,
  desired: string,
  ignoreDocumentId: string,
): Promise<string> {
  for (let candidate = `${desired}-2`, n = 2; n < 1000; n++) {
    const existing = await repo.findBySlug(workspaceId, candidate);
    if (!existing || existing.id === ignoreDocumentId) return candidate;
    candidate = `${desired}-${n + 1}`;
  }
  // Practically unreachable; keep deterministic even under pathological data.
  return `${desired}-${Date.now().toString(36)}`;
}

/**
 * Is `slug` free for `documentId` in the Ctx's workspace?
 *
 * Errors: VALIDATION (slug fails the §6.6 format), NOT_FOUND (document is
 * unknown in this workspace — never leaks other workspaces' documents).
 */
export function makeCheckSlugAvailable(deps: SlugCheckDeps) {
  return async function checkSlugAvailable(
    ctx: Ctx,
    documentId: string,
    slug: string,
  ): Promise<Result<SlugCheckResult, AppError>> {
    if (!isValidSlugFormat(slug)) {
      return err(
        AppError.validation('Invalid input', [{ path: 'slug', message: SLUG_FORMAT_MESSAGE }]),
      );
    }

    const record = await deps.documents.getById(ctx.workspaceId, documentId);
    if (!record) return err(AppError.notFound(`Document ${documentId} not found`));

    const clash = await deps.documents.findBySlug(ctx.workspaceId, slug);
    if (!clash || clash.id === documentId) return ok({ available: true });

    return ok({
      available: false,
      suggestion: await firstFreeSuggestion(deps.documents, ctx.workspaceId, slug, documentId),
    });
  };
}
