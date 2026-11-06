// T20 — Logic builder route (spec §14.1.4): `/d/:docId/logic`.
// Server shell: owns the page header chrome (back link, title, Results CTA) and
// passes the static links into the client builder as RSC slots. The client
// component owns the canvas, rule drawer and the autosave loop (T08 transport
// + autosave seams) — its data fetch is unchanged.
//
// Redesign note (B7): the old "← Builder" link pointed at `/d/:docId`, a route
// that does not exist in this app — it now goes to `/dashboard`.

import type { Metadata } from "next";
import Link from "next/link";

import { BTN_GHOST_SM, BTN_SECONDARY_SM } from "@/lib/ui";
import { Icon } from "@/components/ui/icons";
import { LogicBuilder } from "../../../../../components/logic/LogicBuilder";

export const metadata: Metadata = {
  title: "Logic — FormForge",
};

export default async function LogicPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  return (
    <LogicBuilder
      docId={docId}
      backLink={
        <Link href="/dashboard" className={BTN_GHOST_SM}>
          <Icon name="arrowLeft" size={14} />
          Dashboard
        </Link>
      }
      resultsLink={
        <Link href={`/d/${docId}/results`} className={BTN_SECONDARY_SM}>
          Results
          <Icon name="arrowRight" size={14} />
        </Link>
      }
    />
  );
}
