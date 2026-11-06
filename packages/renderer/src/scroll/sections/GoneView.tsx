/**
 * "Gone" view for unpublished/deleted documents (spec §8: public URL returns the
 * "unavailable" page — HTTP 410). SPEC-NOTE: App Router pages can only emit 200/404
 * (notFound()/redirect — Next 15 has no 410 primitive for pages), so this renders
 * the gone UI with noindex metadata; a middleware-level rewrite can upgrade it to a
 * true 410 status later (re-ticketed with the issue #30 follow-up).
 */
export function GoneView({ locale }: { locale?: string }) {
  return (
    <main
      lang={locale}
      className="ff-gone flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--ff-bg)] px-6 text-center text-[var(--ff-fg)]"
      style={{ fontFamily: "var(--ff-font-body, inherit)" }}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--ff-muted)]">410</p>
      <h1
        className="text-2xl font-bold"
        style={{ fontFamily: "var(--ff-font-heading, inherit)" }}
      >
        This page is no longer available
      </h1>
      <p className="max-w-md text-[var(--ff-muted)]">
        The page you are looking for was unpublished or deleted by its owner.
      </p>
      <a
        href="/"
        className="mt-3 inline-block rounded-[var(--ff-radius)] px-5 py-2.5 text-sm font-semibold no-underline"
        style={{ backgroundColor: "var(--ff-primary)", color: "var(--ff-primary-fg)" }}
      >
        Go home
      </a>
    </main>
  );
}
