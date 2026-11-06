// "Built with FormForge" branding badge (spec §14, settings.showBranding).
// SPEC-NOTE: the spec pins the badge's existence but not its target URL;
// pointing at the product root until marketing pins a canonical link.
const FORGEFORMS_URL = 'https://forgeforms.app/';

export function BrandingBadge({ visible = true }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <a
      className="ff-badge"
      href={FORGEFORMS_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Built with FormForge"
    >
      <span aria-hidden="true">⚡</span> Built with FormForge
    </a>
  );
}
