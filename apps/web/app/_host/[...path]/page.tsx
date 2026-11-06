import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
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
 * Public render for custom hostnames (spec §2 `_host/[...path]`; §10.1
 * "Middleware maps Host → documentId via routing table, rewrites to `_host`").
 *
 * Reached ONLY through the middleware rewrite: the middleware resolved the
 * request's Host to a VERIFIED domain's documentId via the routing table and
 * forwarded it as the `x-ff-document-id` request header. Direct navigations to
 * /_host/... (no header) 404 — the route is not publicly addressable.
 *
 * SPEC-NOTE: like /p/[slug], the snapshot reader is T10's placeholder until the
 * T07/T12 composition root lands; the render contract (scroll renderer, gone
 * view, noindex metadata) matches the path-based public plane exactly. Forms
 * on custom domains render through the conversational plane in a follow-up
 * (same INTEGRATION-DEBT as /p/[slug]).
 */
export const revalidate = 60;

type HostPageProps = { params: Promise<{ path?: string[] }> };

const loadSnapshot = cache(async (documentId: string) => getPublishedSnapshot(documentId));

export async function generateMetadata({ params }: HostPageProps): Promise<Metadata> {
  await params;
  const headerList = await headers();
  const documentId = headerList.get("x-ff-document-id");
  if (!documentId) return buildUnavailableMetadata() as Metadata;
  const result = await loadSnapshot(documentId);
  if (!result.ok) {
    // Gone/unavailable states must stay out of search indexes (spec §8: 410).
    return buildUnavailableMetadata() as Metadata;
  }
  return buildPageMetadata(result.value, { canonicalPath: "/" }) as Metadata;
}

export default async function CustomHostPage({ params }: HostPageProps) {
  await params;
  const headerList = await headers();
  const documentId = headerList.get("x-ff-document-id");
  // Not rewritten by the middleware → not a routed custom hostname.
  if (!documentId) notFound();

  const result = await loadSnapshot(documentId);
  if (!result.ok) {
    const kind = classifySnapshotError(result.error?.code);
    if (kind === "gone") {
      // The document behind a verified hostname was unpublished → gone view
      // (spec §8: the public URL returns the "unavailable" page, HTTP 410).
      return <GoneView />;
    }
    if (kind === "unknown") {
      console.error(`[_host] snapshot reader error for doc ${documentId}:`, result.error);
    }
    notFound();
  }

  const snapshot = result.value;
  if (snapshot.type === "form") {
    // SPEC-NOTE: forms render through the conversational plane (T12); on the
    // path plane (/p/[slug]) the same debt exists. 404 keeps parity for now.
    notFound();
  }

  return (
    <>
      <ScrollRenderer snapshot={snapshot} />
      {/* T29 (spec §17): "Report abuse" link on every public page. */}
      <footer className="px-5 pb-8 pt-4 text-center">
        <ReportAbuseLink documentRef={snapshot.documentId} />
      </footer>
    </>
  );
}
