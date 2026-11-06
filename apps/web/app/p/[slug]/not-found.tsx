/** Scoped 404 for the public scroll plane (unknown/unpublished-at-404 slugs). */
export default function PublicPageNotFound() {
  return (
    <main className="ff-not-found flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--ff-bg)] px-6 text-center text-[var(--ff-fg)]">
      <p className="text-sm font-semibold text-[var(--ff-muted)]">404</p>
      <h1 className="text-2xl font-bold text-balance">Page not found</h1>
      <p className="max-w-md leading-relaxed text-[var(--ff-muted)]">
        This page does not exist or is not published yet.
      </p>
      <a
        href="/"
        className="mt-3 inline-block rounded-[var(--ff-radius)] bg-[var(--ff-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--ff-primary-fg)] no-underline transition-[filter] hover:brightness-110"
      >
        Go home
      </a>
    </main>
  );
}
