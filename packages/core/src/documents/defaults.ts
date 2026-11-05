/**
 * T10 — default seam implementations used by the composition root until the
 * owning modules land. Each is deliberately minimal and marked with the
 * ticket that supersedes it.
 */
import type { Routing } from './model';
import type { AssetUrlResolver, DraftValidationIssue, LogicCompiler, PublicUrlBuilder } from './ports';

/** INTEGRATION-DEBT: awaiting the logic module (spec §9). Pass-through compile. */
export const passthroughLogicCompiler: LogicCompiler = {
  compile(): { routing: Routing; issues: readonly DraftValidationIssue[] } {
    // Empty routing: the conversational renderer falls back to spec §9 "default
    // next" semantics, which needs no compiled map.
    return { routing: {}, issues: [] };
  },
};

/** INTEGRATION-DEBT: awaiting the assets module (spec §6 assets, §8 step 3). */
export function devAssetUrlResolver(baseUrl: string): AssetUrlResolver {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async resolve(assetId: string): Promise<string | null> {
      return `${base}/${assetId}`;
    },
  };
}

/**
 * INTEGRATION-DEBT: awaiting tenancy (workspace slug lookup). Builds the §10.1
 * path URL with the workspace id as the segment placeholder.
 */
export function defaultPublicUrlBuilder(baseUrl: string): PublicUrlBuilder {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async documentUrl(doc): Promise<string> {
      return `${base}/p/${doc.workspaceId}/${doc.slug}`;
    },
  };
}

/**
 * Optional pass-through sanitizer. INTEGRATION-DEBT: the rich-text allowlist
 * sanitizer belongs to the blocks/rendering work (spec §17 requires sanitizing
 * on save AND on snapshot build); wire the real one in via buildSnapshot args.
 */
export function passthroughRichTextSanitizer(node: unknown): unknown {
  return node;
}
