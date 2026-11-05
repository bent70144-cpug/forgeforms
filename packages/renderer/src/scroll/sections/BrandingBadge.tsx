/** Branding badge shown when document.settings.showBranding is true (spec §10.2/§14). */
export function BrandingBadge() {
  return (
    <footer className="ff-branding flex w-full items-center justify-center border-t border-[var(--ff-border)] px-6 py-4">
      <a
        href="/"
        className="text-xs no-underline text-[var(--ff-muted)] hover:text-[var(--ff-fg)]"
      >
        Made with <span className="font-semibold">FormForge</span>
      </a>
    </footer>
  );
}
