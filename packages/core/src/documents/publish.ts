/**
 * T10 — publishDocument service (spec §8 "Publish", issue #10).
 *
 * Flow:
 *  1. validate the draft fully (DocumentBody shape → logic lint → asset existence);
 *  2. insert an immutable `document_versions` row (append-only, no update path);
 *  3. build the §8 snapshot and upsert `snapshots` with an etag;
 *  4. set documents.status='published' + published_version_id (spec §6 columns);
 *  5. purge CDN cache by tag `doc:<id>` (KV routing entry: Phase 2 seam);
 *  6. return { url }.
 *
 * Idempotency (issue #10): re-publishing an unchanged draft does NOT create a
 * new version row — the previous version is reused and the same URL returned.
 */
import { type Ctx } from "../shared/ctx.ts";
import { AppError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { canonicalHash } from './hash';
import { uuidv7 } from './ids';
import type { BlockJson, DocumentBodyJson, PublishOutcome } from './model';
import { docTag, PUBLISH_ISSUE_CODES, snapshotCacheKeys, type DraftValidationIssue, type PublishPipelineDeps } from './ports';
import { buildSnapshot, snapshotEtag } from './snapshot';
import { scanSensitiveFields } from './sensitive-fields';

export type PublishDocument = (
  ctx: Ctx,
  documentId: string,
) => Promise<Result<PublishOutcome, AppError>>;

export function makePublishDocument(deps: PublishPipelineDeps): PublishDocument {
  return async (ctx, documentId): Promise<Result<PublishOutcome, AppError>> => {
    // Tenant-scoped load (spec §3: every service scopes by ctx.workspaceId).
    const doc = await deps.documents.getById(ctx.workspaceId, documentId);
    if (!doc) {
      return err(
        new AppError('NOT_FOUND', `Document ${documentId} not found`, [
          { path: 'id', message: 'unknown document' },
        ]),
      );
    }
    if (doc.status === 'archived') {
      return err(new AppError('CONFLICT', 'Archived documents cannot be published'));
    }

    // 1. Full draft validation. The DraftValidator contract guarantees the
    // validated body has the §7 structural shape when it reports no issues.
    const body = doc.draft as DocumentBodyJson;
    const schemaIssues = await deps.validator.validate(doc.draft);
    // T20 (issue #20): pass the draft's ending ids so the engine's lint can
    // verify `end:<id>` goto targets (dangling target blocks publish).
    const endingIds = (body.endings ?? []).map((ending) => ending.id);
    const lintIssues = schemaIssues.length === 0
      ? deps.compiler.compile(body.logic?.rules ?? [], body.blocks ?? [], endingIds).issues
      : [];
    // B7 follow-up #4 (§8.1 FORM_EMBED_MISSING): the form-embed target check is
    // a cross-entity rule — ONLY the server can resolve whether a referenced
    // document exists and is published inside this workspace (the builder
    // loads no document index client-side, so there is no client supplement;
    // the code reaches the Issues drawer through the 422 merge). Gated on the
    // schema phase like the logic lint: a malformed documentId is already a
    // schema-level issue and would double-report here.
    const embedIssues = schemaIssues.length === 0
      ? await collectEmbedTargetIssues(deps, ctx, body, documentId)
      : [];
    const allIssues = [...schemaIssues, ...lintIssues, ...embedIssues];
    if (allIssues.length > 0) {
      return err(new AppError('VALIDATION', 'Draft failed validation', allIssues));
    }

    // Idempotency gate: unchanged draft → reuse the published version.
    const draftHash = canonicalHash(doc.draft);
    if (doc.status === 'published' && doc.publishedVersionId !== null) {
      const existing = await deps.versions.getById(ctx.workspaceId, documentId, doc.publishedVersionId);
      if (existing && canonicalHash(existing.body) === draftHash) {
        const history = await deps.versions.listByDocument(ctx.workspaceId, documentId);
        const warnings = scanSensitiveFields(body);
        const outcome: PublishOutcome = {
          url: await deps.publicUrl.documentUrl(doc),
          documentId: doc.id,
          versionId: existing.id,
          version: ordinalOf(history, existing.id),
          reused: true,
          ...(warnings.length > 0 ? { warnings } : {}),
        };
        return ok(outcome);
      }
    }

    // 3-before-2: build the snapshot FIRST (asset resolution may still fail),
    // so an invalid draft writes nothing at all — not even a version row.
    const versionId = uuidv7();
    const built = await buildSnapshot({
      document: { id: doc.id, workspaceId: doc.workspaceId, title: doc.title, type: doc.type },
      versionId,
      body,
      assets: deps.assets,
      compiler: deps.compiler,
      // T29 (spec §17): sanitize rich text during snapshot build (defense in
      // depth with the save-path sanitizer in crud.ts).
      ...(deps.sanitizeRichText !== undefined ? { sanitizeRichText: deps.sanitizeRichText } : {}),
    });
    if (built.issues.length > 0) {
      return err(new AppError('VALIDATION', 'Draft failed validation', built.issues));
    }

    // 2. Immutable version row (append-only). Version ids are app-generated
    // UUIDv7 (spec §4); the ordinal is the row's 1-based history position.
    const version = await deps.versions.insert({
      id: versionId,
      documentId: doc.id,
      workspaceId: ctx.workspaceId,
      schemaVersion: body.schemaVersion ?? 1,
      body: doc.draft,
      createdBy: ctx.actor.id,
      createdAt: ctx.now(),
    });

    await deps.snapshots.upsert({
      documentId: doc.id,
      versionId: version.id,
      rendered: built.snapshot,
      etag: snapshotEtag(built.snapshot),
      builtAt: ctx.now(),
    });

    // 4. Flip the lifecycle pointer (status + published_version_id per §6).
    const updated = await deps.documents.updatePublishState(ctx.workspaceId, documentId, {
      status: 'published',
      publishedVersionId: version.id,
      updatedAt: ctx.now(),
    });

    // 5. Purge CDN by tag; exact keys for the snapshot + routing entries.
    await deps.cdn.purgeTag(docTag(documentId));
    await deps.cdn.purgeKeys(snapshotCacheKeys(updated));
    // SPEC-NOTE: spec §8 step 5 also updates a KV routing entry; that table is
    // Phase 2 (custom domains) — the CdnPurgeHook.seam above covers cache only.

    // 6. Public URL (p95 target < 10 s; measured in __tests__/publish.test.ts).
    const history = await deps.versions.listByDocument(ctx.workspaceId, documentId);
    // T29 (spec §17): publish-time sensitive-field warning (non-blocking).
    const warnings = scanSensitiveFields(body);
    return ok({
      url: await deps.publicUrl.documentUrl(updated),
      documentId: updated.id,
      versionId: version.id,
      version: ordinalOf(history, version.id),
      reused: false,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  };
}

/** 1-based position of a version in the ordered history; -1 when unknown. */
export function ordinalOf(
  history: ReadonlyArray<{ id: string }>,
  versionId: string,
): number {
  const index = history.findIndex((v) => v.id === versionId);
  return index === -1 ? -1 : index + 1;
}

// ---------------------------------------------------------------------------
// §8.1 FORM_EMBED_MISSING — form-embed target check (B7 follow-up #4)
// ---------------------------------------------------------------------------

const FORM_EMBED_KIND = 'form-embed';
/** Same depth-first bracket notation the snapshot asset walk emits. */
const embedPath = (blockPath: ReadonlyArray<number>): string =>
  `blocks[${blockPath.join('][')}].props.documentId`;

/**
 * Verify every `form-embed` block's `props.documentId` against THIS workspace:
 * the target must exist and be published (status='published' with a live
 * published version) — otherwise the live page ships a broken iframe (spec
 * §8 step 1 "validate fully"; §8.1 FORM_EMBED_MISSING).
 *
 * Deliberately server-side only: `PublishPipelineDeps.documents` is the sole
 * status source, and publishing a document that embeds a draft (or deleted)
 * form would 410/404 for every respondent. Self-embeds are always rejected —
 * the frame would recurse into itself at render time.
 *
 * Idempotency note: this runs BEFORE the unchanged-draft reuse gate, so a
 * draft whose embed target was since unpublished/taken down cannot silently
 * keep re-publishing a broken live page.
 */
export async function collectEmbedTargetIssues(
  deps: PublishPipelineDeps,
  ctx: Ctx,
  body: DocumentBodyJson,
  selfDocumentId: string,
): Promise<DraftValidationIssue[]> {
  const issues: DraftValidationIssue[] = [];
  /** One repo lookup per distinct target id; the verdict is reused per block. */
  const verdicts = new Map<string, Omit<DraftValidationIssue, 'path' | 'blockId'> | null>();

  await walk(body.blocks ?? [], []);

  async function walk(blocks: readonly BlockJson[], path: ReadonlyArray<number>): Promise<void> {
    for (const [index, block] of blocks.entries()) {
      const blockPath = [...path, index];
      if (block.kind === FORM_EMBED_KIND) {
        const targetId = block.props?.['documentId'];
        if (typeof targetId === 'string' && targetId !== '') {
          const cached = verdicts.get(targetId);
          const verdict = cached !== undefined
            ? cached
            : await embedTargetIssue(deps, ctx, targetId, selfDocumentId);
          verdicts.set(targetId, verdict);
          if (verdict !== null) {
            issues.push({ ...verdict, path: embedPath(blockPath), blockId: block.id });
          }
        }
      }
      if (block.children?.length) {
        await walk(block.children, blockPath);
      }
    }
  }

  return issues;
}

/** The §8.1 issue for one embed target, or null when the target is publishable. */
async function embedTargetIssue(
  deps: PublishPipelineDeps,
  ctx: Ctx,
  targetId: string,
  selfDocumentId: string,
): Promise<Omit<DraftValidationIssue, 'path' | 'blockId'> | null> {
  if (targetId === selfDocumentId) {
    return {
      code: PUBLISH_ISSUE_CODES.formEmbedMissing,
      message: 'A form cannot embed itself — the frame would recurse forever.',
    };
  }
  // Tenant-scoped: getById never leaks another workspace's rows (spec §3).
  const target = await deps.documents.getById(ctx.workspaceId, targetId);
  if (!target) {
    return {
      code: PUBLISH_ISSUE_CODES.formEmbedMissing,
      message: `The embedded form "${targetId}" no longer exists (deleted or moved out of this workspace).`,
    };
  }
  if (target.status !== 'published' || target.publishedVersionId === null) {
    return {
      code: PUBLISH_ISSUE_CODES.formEmbedMissing,
      message: `The embedded form "${target.title ?? targetId}" is not published — publish it first.`,
    };
  }
  return null;
}
