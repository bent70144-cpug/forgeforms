// Embed route: /embed/:docId (spec §10.2) — iframe-friendly minimal page.
// Server component: resolves the published snapshot (graceful fallback while the
// public snapshot endpoint from the public-plane ticket is not deployed), then
// mounts the client shell that speaks the ff:* postMessage protocol.
import type { Metadata } from "next";
import { headers } from "next/headers";

import type { Block } from "@formforge/core/templates";

import EmbedClient from "./embed-client";
import type { EmbedSnapshot } from "./embed-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FormForge",
  description: "FormForge embedded document.",
  robots: { index: false, follow: false },
};

const DOC_TYPES = new Set(["form", "page", "portfolio"]);

function isBlockArray(raw: unknown): raw is Block[] {
  return (
    Array.isArray(raw) &&
    raw.every(
      (b) =>
        typeof b === "object" &&
        b !== null &&
        typeof (b as Record<string, unknown>)["id"] === "string" &&
        typeof (b as Record<string, unknown>)["kind"] === "string" &&
        typeof (b as Record<string, unknown>)["props"] === "object",
    )
  );
}

/**
 * Defensive normalizer for `GET /api/public/snapshot/:documentId` (spec §10.1).
 * Accepts unknown JSON and degrades to `null` — the embed must never 500 because
 * the snapshot route is missing, shape-shifted, or the document is unpublished.
 */
function normalizeSnapshot(raw: unknown, documentId: string): EmbedSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const type = rec["type"];
  if (typeof type !== "string" || !DOC_TYPES.has(type)) return null;
  const title = typeof rec["title"] === "string" && rec["title"].length > 0 ? rec["title"] : "Untitled document";
  const blocks = isBlockArray(rec["blocks"]) ? rec["blocks"] : [];
  return { documentId, title, type: type as EmbedSnapshot["type"], blocks };
}

async function fetchSnapshot(origin: string, docId: string): Promise<EmbedSnapshot | null> {
  try {
    const res = await fetch(`${origin}/api/public/snapshot/${encodeURIComponent(docId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    return normalizeSnapshot(await res.json(), docId);
  } catch {
    // Snapshot endpoint not deployed / document unpublished / timeout — handled upstream.
    return null;
  }
}

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ docId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { docId } = await params;
  const { mode } = await searchParams;

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const snapshot = await fetchSnapshot(`${proto}://${host}`, docId);

  // Popup and side-tab embeds float over the host page → transparent chrome.
  const transparent = mode === "popup" || mode === "side-tab";

  return (
    <EmbedClient docId={docId} snapshot={snapshot} transparent={transparent} />
  );
}
