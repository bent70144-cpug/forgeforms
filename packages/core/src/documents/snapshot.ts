/**
 * T10 — snapshot building (spec §8 step 3) and the public snapshot reader.
 *
 * The builder is pure aside from the injected `assets` resolver: theme tokens →
 * CSS variable map, asset ids → CDN URLs, logic → compiled routing map, rich
 * text passed through the injected sanitizer. The reader serves renderers and
 * ingest and returns deep-frozen snapshots (spec §6: rendered is immutable).
 */
import { err, ok, AppError, type Ctx, type Result } from '../bridge';
import { canonicalHash, deepFreeze, structuralClone } from './hash';
import type {
  BlockJson,
  DocumentBodyJson,
  DocumentRecord,
  PublishedSnapshot,
  Snapshot,
  SnapshotSeo,
} from './model';
import type {
  AssetUrlResolver,
  DraftValidationIssue,
  LogicCompiler,
  PublishedReadDeps,
} from './ports';

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export type BuildSnapshotArgs = {
  document: Readonly<Pick<DocumentRecord, 'id' | 'title' | 'type'>>;
  versionId: string;
  body: DocumentBodyJson;
  assets: AssetUrlResolver;
  compiler: LogicCompiler;
  /** Sanitizes Tiptap JSON props (allowlist HTML). Default: pass-through. */
  sanitizeRichText?: (node: unknown) => unknown;
};

export type BuildSnapshotResult = { snapshot: Snapshot; issues: readonly DraftValidationIssue[] };

const ASSET_ID_PROP = /[Aa]ssetId$/;
const ASSET_IDS_PROP = /[Aa]ssetIds$/;
const RICH_TEXT_PROP = 'richText';

/** "color.bg" → "--color-bg" (spec §8: resolve theme → CSS variable map). */
export function themeToCssVars(tokens: Readonly<Record<string, string>>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    const name = `--${key.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
    if (name.length > 2) vars[name] = value;
  }
  return vars;
}

/** Walks blocks, replacing asset ids with resolved CDN URLs (structural clone). */
export async function resolveBlockAssetUrls(
  blocks: readonly BlockJson[],
  assets: AssetUrlResolver,
  sanitizeRichText?: (node: unknown) => unknown,
): Promise<{ blocks: BlockJson[]; issues: DraftValidationIssue[] }> {
  const issues: DraftValidationIssue[] = [];
  const cloned: BlockJson[] = structuralClone([...blocks]);
  const resolved = await walkBlocks(cloned, [], issues);
  return { blocks: resolved, issues };

  async function walkBlocks(
    list: BlockJson[],
    path: ReadonlyArray<number>,
    sink: DraftValidationIssue[],
  ): Promise<BlockJson[]> {
    for (const [index, block] of list.entries()) {
      const blockPath = [...path, index];
      if (block.props) {
        for (const key of Object.keys(block.props)) {
          const value = block.props[key];
          if (key === RICH_TEXT_PROP && value !== undefined && value !== null) {
            block.props[key] = sanitizeRich(value);
            continue;
          }
          if (ASSET_ID_PROP.test(key) && typeof value === 'string') {
            const url = await assets.resolve(value);
            if (url === null) {
              sink.push({
                path: `blocks[${blockPath.join('][')}].props.${key}`,
                message: `Asset not found: ${value}`,
              });
            } else {
              block.props[key] = url;
            }
          } else if (ASSET_IDS_PROP.test(key) && Array.isArray(value)) {
            const urls: string[] = [];
            for (const [i, id] of value.entries()) {
              if (typeof id !== 'string') continue;
              const url = await assets.resolve(id);
              if (url === null) {
                sink.push({
                  path: `blocks[${blockPath.join('][')}].props.${key}[${i}]`,
                  message: `Asset not found: ${id}`,
                });
              } else {
                urls.push(url);
              }
            }
            block.props[key] = urls;
          }
        }
      }
      if (block.children?.length) {
        block.children = await walkBlocks(block.children, blockPath, sink);
      }
    }
    return list;
  }

  function sanitizeRich(node: unknown): unknown {
    return sanitizeRichText ? sanitizeRichText(node) : node;
  }
}

/** Builds the §8 Snapshot. `issues` is non-empty when required assets are missing. */
export async function buildSnapshot(args: BuildSnapshotArgs): Promise<BuildSnapshotResult> {
  const { document, versionId, body, assets, compiler } = args;

  // T20 (issue #20): endings supplied so compiled routing verifies `end:<id>`
  // targets identically to the publish-time lint.
  const compiled = compiler.compile(
    body.logic?.rules ?? [],
    body.blocks,
    (body.endings ?? []).map((ending) => ending.id),
  );
  const { blocks, issues: assetIssues } = await resolveBlockAssetUrls(
    body.blocks ?? [],
    assets,
    args.sanitizeRichText,
  );
  const issues = [...compiled.issues, ...assetIssues];

  const seo = body.settings?.seo ?? {};
  const ogImageUrl =
    seo.ogImageAssetId !== undefined ? await assets.resolve(seo.ogImageAssetId) : undefined;
  if (seo.ogImageAssetId !== undefined && ogImageUrl === null) {
    issues.push({
      path: 'settings.seo.ogImageAssetId',
      message: `Asset not found: ${seo.ogImageAssetId}`,
    });
  }

  const snapshot: Snapshot = {
    documentId: document.id,
    versionId,
    type: body.type ?? document.type,
    title: seo.title ?? document.title,
    seo: {
      title: seo.title ?? document.title,
      ...(seo.description !== undefined ? { description: seo.description } : {}),
      ...(ogImageUrl !== undefined && ogImageUrl !== null ? { ogImageUrl } : {}),
    } satisfies SnapshotSeo,
    locale: body.settings?.locale ?? 'en',
    cssVars: themeToCssVars(body.theme?.tokens ?? {}),
    blocks,
    endings: structuralClone(body.endings ?? []),
    routing: compiled.routing,
    settings: {
      progressBar: body.settings?.progressBar ?? true,
      autoAdvance: body.settings?.autoAdvance ?? true,
      showBranding: body.settings?.showBranding ?? true,
      captcha: body.settings?.captcha ?? false,
      ...(body.settings?.closeAt !== undefined ? { closeAt: body.settings.closeAt } : {}),
    },
  };

  return { snapshot, issues };
}

/** Etag over the rendered payload (spec §6 snapshots.etag). */
export function snapshotEtag(rendered: Snapshot): string {
  return canonicalHash(rendered);
}

// ---------------------------------------------------------------------------
// Read (public plane)
// ---------------------------------------------------------------------------

export type GetPublishedSnapshot = (slug: string) => Promise<Result<PublishedSnapshot, AppError>>;

/**
 * Public snapshot reader (spec §10 — renderers/ingest read ONLY the snapshot).
 *
 * - unknown slug → NOT_FOUND (404)
 * - known but not published (draft or archived, or no published version) →
 *   UNPUBLISHED (410 Gone) per spec §8
 * - returned snapshot is deep-frozen so callers cannot mutate the cached body.
 */
export function makeGetPublishedSnapshot(deps: PublishedReadDeps): GetPublishedSnapshot {
  return async (slug: string): Promise<Result<PublishedSnapshot, AppError>> => {
    const { workspaceSlug, docSlug } = parsePublicSlug(slug);
    const doc = await deps.documents.findBySlug(workspaceSlug, docSlug);
    if (!doc) {
      return err(new AppError('NOT_FOUND', `No published document for slug "${slug}"`));
    }
    if (doc.status !== 'published' || doc.publishedVersionId === null) {
      return err(
        new AppError('UNPUBLISHED', `Document "${docSlug}" is not currently published`),
      );
    }
    const record = await deps.snapshots.getByDocumentId(doc.id);
    if (!record || record.versionId !== doc.publishedVersionId) {
      // Invariant violation: published pointer without a matching snapshot.
      return err(
        new AppError('INTERNAL', `Snapshot for document ${doc.id} is missing or stale`),
      );
    }
    return ok({
      documentId: doc.id,
      versionId: record.versionId,
      etag: record.etag,
      snapshot: deepFreeze(structuralClone(record.rendered)),
    });
  };
}

/** Accepts "doc-slug" or "workspace-slug/doc-slug" (spec §10.1 path form). */
export function parsePublicSlug(slug: string): { workspaceSlug: string | null; docSlug: string } {
  const trimmed = slug.replace(/^\/+|\/+$/g, '');
  const parts = trimmed.split('/').filter((p) => p.length > 0);
  if (parts.length >= 2) {
    return { workspaceSlug: parts[0] ?? null, docSlug: parts[parts.length - 1] ?? trimmed };
  }
  return { workspaceSlug: null, docSlug: trimmed };
}

// re-export for module consumers typing route handlers
export type { Ctx, Result };
