/**
 * T10 — CdnPurgeHook implementations (spec §8 step 5 / unpublish).
 *
 * `noopCdnPurge` is the default for this milestone (issue #10: "CDN purge hook
 * behind interface (log/no-op impl now)"). The real Cloudflare tag-purge client
 * plugs in via the same interface at the composition root (Phase 2, edge/domains).
 */
import type { CdnPurgeHook } from './ports';

/** Production default: logs nothing, purges nothing, never fails. */
export const noopCdnPurge: CdnPurgeHook = {
  async purgeTag(): Promise<void> {
    /* no-op */
  },
  async purgeKeys(): Promise<void> {
    /* no-op */
  },
};

/** Test/dev implementation: records every purge call for assertions. */
export class InMemoryCdnPurge implements CdnPurgeHook {
  readonly tags: string[] = [];
  readonly keys: string[] = [];

  async purgeTag(tag: string): Promise<void> {
    this.tags.push(tag);
  }

  async purgeKeys(keys: readonly string[]): Promise<void> {
    this.keys.push(...keys);
  }

  /** True when the tag and both cache keys were purged (publish/unpublish contract). */
  purgedEverythingFor(doc: { id: string; workspaceId: string; slug: string }): boolean {
    return (
      this.tags.includes(`doc:${doc.id}`) &&
      this.keys.includes(`snapshot:${doc.id}`) &&
      this.keys.includes(`route:${doc.workspaceId}/${doc.slug}`)
    );
  }
}
