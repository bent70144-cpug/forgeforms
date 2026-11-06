import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  GoneView,
  ScrollRenderer,
  buildPageMetadata,
  buildUnavailableMetadata,
  classifySnapshotError,
  getPublishedSnapshot,
} from "@formforge/renderer";
import { ReportAbuseLink } from "@/components/public/report-abuse-link";

/**
 * Public scroll plane (spec §10.1 `GET /p/:slug`): server components that read
 * ONLY the published snapshot via getPublishedSnapshot — never builder tables
 * (spec §10.2). ISR keeps output static-leaning so published pages keep serving
 * from cache even when the database is stopped (spec §15 M3 acceptance).
 */
export const revalidate = 60;

type PublicPageProps = { params: Promise<{ slug: string }> };

// Deduplicate the reader call between generateMetadata and the page (per request).
const loadSnapshot = cache(async (slug: string) => getPublishedSnapshot(slug));

export async function generateMetadata({ params }: PublicPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadSnapshot(slug);
  if (!result.ok) {
    // Gone/unavailable states must stay out of search indexes (spec §8: 410).
    return buildUnavailableMetadata() as Metadata;
  }
  return buildPageMetadata(result.value, { canonicalPath: `/p/${slug}` }) as Metadata;
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
      return <GoneView />;
    }
    if (kind === "unknown") {
      console.error(`[p/${slug}] snapshot reader error:`, result.error);
    }
    // not-found (and unknown/internal reader errors) → 404, never a crash.
    notFound();
  }

  const snapshot = result.value;
  // Forms render through the conversational plane (T12), not the scroll renderer.
  if (snapshot.type === "form") {
    console.warn(`[p/${slug}] form document requested on scroll plane (doc: ${snapshot.documentId ?? "?"})`);
    notFound();
  }

  return (
    <>
      <ScrollRenderer snapshot={snapshot} />
      {/* T29 (spec §17): "Report abuse" link on every public page. */}
      <footer style={{ textAlign: "center", padding: "0 1.25rem 2rem", fontSize: "0.8rem" }}>
        <ReportAbuseLink documentRef={snapshot.documentId ?? slug} />
      </footer>
    </>
  );
}
