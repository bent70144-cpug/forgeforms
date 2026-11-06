import type { Snapshot } from "../snapshot";
import { cssVarsToStyle, normalizeCssVars } from "./theme";
import { BlockSection } from "./sections/BlockSection";
import { BrandingBadge } from "./sections/BrandingBadge";

export type ScrollRendererProps = {
  snapshot: Snapshot;
};

/**
 * Scroll renderer for pages and portfolios (spec §10.2): server components
 * reading ONLY the published snapshot, static HTML, zero client JS.
 *
 * - Theme (spec §14.3) flows through `--ff-*` CSS variables on the wrapper.
 * - Unknown/empty blocks are skipped with a server-side warning (spec §7.1).
 * - The branding badge honours settings.showBranding.
 */
export function ScrollRenderer({ snapshot }: ScrollRendererProps) {
  const vars = normalizeCssVars(snapshot.cssVars);
  const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
  const locale = snapshot.locale ?? "en";
  const showBranding = snapshot.settings?.showBranding !== false;

  if (blocks.length === 0) {
    console.warn(`[ff-scroll] snapshot has no blocks — rendering an empty page (doc: ${snapshot.documentId ?? "?"})`);
  }

  return (
    <div
      lang={locale}
      className="ff-scroll flex min-h-screen flex-col bg-[var(--ff-bg)] text-[var(--ff-fg)]"
      style={cssVarsToStyle(vars)}
    >
      <main className="flex w-full flex-1 flex-col">
        {blocks.map((block, index) => (
          <BlockSection key={block?.id ?? `block-${String(index)}`} block={block} />
        ))}
      </main>
      {showBranding ? <BrandingBadge /> : null}
    </div>
  );
}
