/** Scoped 404 for the public scroll plane (unknown/unpublished-at-404 slugs). */
export default function PublicPageNotFound() {
  return (
    <main className="ff-not-found flex min-h-screen flex-col items-center justify-center gap-3 bg-white px-6 text-center text-slate-900">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">404</p>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="max-w-md text-slate-500">
        This page does not exist or is not published yet.
      </p>
      <a
        href="/"
        className="mt-3 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white no-underline"
      >
        Go home
      </a>
    </main>
  );
}
