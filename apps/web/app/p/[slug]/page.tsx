import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ScrollRenderer,
  buildPageMetadata,
  buildUnavailableMetadata,
  classifySnapshotError,
} from "@formforge/renderer";
import { ReportAbuseLink } from "@/components/public/report-abuse-link";
import { Icon } from "@/components/ui/icons";
import { BTN_PRIMARY } from "@/lib/ui";
import { documentsApi } from "@/lib/api/documents";

/**
 * Public scroll plane (spec §10.1 `GET /p/:slug`): server components that read
 * ONLY the published snapshot via getPublishedSnapshot — never builder tables
 * (spec §10.2). ISR keeps output static-leaning so published pages keep serving
 * from cache even when the database is stopped (spec §15 M3 acceptance).
 *
 * Chrome note (2026 redesign): the document itself renders through the
 * renderer with its own per-document theme; everything AROUND it (gone/unavailable
 * state, abuse-link footer) is app chrome on the aurora-glass token canvas.
 */
export const revalidate = 60;

type PublicPageProps = { params: Promise<{ slug: string }> };

// Deduplicate the reader call between generateMetadata and the page (per request).
// The REAL reader (T10 makeGetPublishedSnapshot over the SQL/in-memory deps)
// wired by the documents API module — replaces the renderer bridge placeholder.
const loadSnapshot = cache(async (slug: string) => documentsApi.getPublishedSnapshot(slug));

export async function generateMetadata({ params }: PublicPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadSnapshot(slug);
  if (!result.ok) {
    // Gone/unavailable states must stay out of search indexes (spec §8: 410).
    return buildUnavailableMetadata() as Metadata;
  }
  return buildPageMetadata(result.value, { canonicalPath: `/p/${slug}` }) as Metadata;
}

/**
 * "Gone" chrome for unpublished/deleted documents (spec §8: HTTP 410 semantics).
 * Centered aurora-glass card — gradient icon tile, clear message, muted support
 * line. Same messaging/semantics as the previous renderer `GoneView`; the
 * document rendering surface is untouched.
 */
function GoneCard() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--ff-bg)] px-6 py-16 text-[var(--ff-fg)]">
      <div
        className="ff-panel w-full max-w-md p-8 text-center"
        style={{
          background: "var(--ff-glass)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: "var(--ff-glow-soft)",
        }}
      >
        <span
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-[14px]"
          style={{
            background: "var(--ff-grad)",
            color: "var(--ff-primary-fg)",
            boxShadow: "var(--ff-glow)",
          }}
        >
          <Icon name="alert" size={22} />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-[var(--ff-muted)]">410</p>
        <h1
          className="mt-2 text-2xl font-semibold tracking-tight text-balance text-[var(--ff-fg)]"
          style={{ fontFamily: "var(--ff-font-heading)" }}
        >
          This page is no longer available
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ff-muted)]">
          The page you are looking for was unpublished or deleted by its owner.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
          If you own this document, republish it to restore access.
        </p>
        <Link href="/" className={`${BTN_PRIMARY} mt-6`}>
          Go home
        </Link>
      </div>
    </main>
  );
}

export default async function PublicPage({ params }: PublicPageProps) {
  const { slug } = await params;
  const result = await loadSnapshot(slug);

  if (!result.ok) {
    const kind = classifySnapshotError(result.error?.code);
    if (kind === "gone") {
      // SPEC-NOTE: Next.js App Router pages can only emit 200/404 (notFound()/redirect);
      // a true 410 status needs middleware/route-handler support (spec §10.1 middleware
      // is owned elsewhere). We render the gone view + noindex so unpublished docs are
      // never a crash and drop out of indexes (INTEGRATION-DEBT: upgrade to HTTP 410).
      return <GoneCard />;
    }
    if (kind === "unknown") {
      console.error(`[p/${slug}] snapshot reader error:`, result.error);
    }
    // not-found (and unknown/internal reader errors) → 404, never a crash.
    notFound();
  }

  // Core reader returns { documentId, versionId, etag, snapshot } — unwrap the
  // rendered snapshot for the scroll renderer (bridge returned the bare shape).
  const snapshot = result.value.snapshot;
  const documentId = result.value.documentId ?? slug;
  // Forms render through the conversational plane (T12), not the scroll renderer.
  if (snapshot.type === "form") {
    console.warn(`[p/${slug}] form document requested on scroll plane (doc: ${documentId})`);
    notFound();
  }

  return (
    <>
      <ScrollRenderer snapshot={snapshot} />
      {/* T29 (spec §17): "Report abuse" link on every public page. */}
      <footer className="px-5 pb-10 pt-6 text-center">
        <ReportAbuseLink documentRef={documentId} />
      </footer>
    </>
  );
}
