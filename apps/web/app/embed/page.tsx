// Embed docs page: /embed (issue #22 — "public docs page for embed code").
// Server component; the snippet URLs are rendered with the live request origin
// so copy-paste works without a build-time env var. Renders WITHOUT the
// marketing layout, so it carries its own token canvas (aurora glass: glow
// backdrop + glass explainer hero); the only client JS is the bundled
// CodeBlock (copy-to-clipboard) — CSP-safe on /embed/*.
//
// NOTE (route precedence): this static route does not collide with the dynamic
// /embed/[docId] frame — Next.js resolves static segments first.
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { headers } from "next/headers";
import Link from "next/link";

import { CodeBlock } from "@/components/embed/code-block";
import { BADGE_ACCENT } from "@/lib/ui";
import { EMBED_LOADER_VERSION } from "../api/public/embed/embed.js/loader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Embed a FormForge document",
  description: "Embed any published FormForge document on your site: standard div, popup, side tab or a plain iframe.",
};

async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

const LOADER_PATH = "/api/public/embed/embed.js";

const HERO_STYLE: CSSProperties = {
  background: "var(--ff-glass)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  boxShadow: "var(--ff-glow-soft)",
};

const HEADING_STYLE: CSSProperties = { fontFamily: "var(--ff-font-heading)" };

// Gradient-text accent word (token-driven, no deps).
function Grad({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        backgroundImage: "var(--ff-grad)",
        color: "transparent",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      }}
    >
      {children}
    </span>
  );
}

// Inline code chip — same recipe for attribute names, values and aliases.
function Chip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[4px] bg-[color-mix(in_srgb,var(--ff-fg)_4%,transparent)] px-1 font-mono text-[13px] text-[var(--ff-fg)]">
      {children}
    </code>
  );
}

// Type-style chip (table payloads, value lists) — smaller + muted per spec.
function TypeChip({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs text-[var(--ff-muted)]">{children}</code>;
}

function BrandRow() {
  return (
    <Link href="/" aria-label="FormForge home" className="inline-flex shrink-0 items-center gap-2 no-underline">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-lg"
        style={{
          background: "var(--ff-grad)",
          color: "var(--ff-primary-fg)",
          boxShadow: "var(--ff-glow)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
        </svg>
      </span>
      <span className="text-[1.0625rem] font-semibold tracking-tight text-[var(--ff-fg)]" style={HEADING_STYLE}>
        FormForge
      </span>
    </Link>
  );
}

// Aurora glow backdrop — decorative only, clipped to the viewport, painted
// behind the (positioned) content via DOM order (no negative z-index, which
// would slip under the root's opaque canvas).
function AuroraBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute -top-48 left-1/2 h-[32rem] w-[56rem] -translate-x-1/2 rounded-full opacity-25"
        style={{ background: "radial-gradient(closest-side, var(--ff-primary), transparent)" }}
      />
      <div
        className="absolute right-[-12rem] top-1/3 h-[26rem] w-[26rem] rounded-full opacity-15"
        style={{ background: "radial-gradient(closest-side, var(--ff-accent), transparent)" }}
      />
      <div
        className="absolute bottom-[-10rem] left-[-8rem] h-[24rem] w-[24rem] rounded-full opacity-10"
        style={{ background: "radial-gradient(closest-side, var(--ff-primary-2), transparent)" }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-14 border-t border-[var(--ff-border)] pt-8">
      <h2 className="flex items-center gap-3 text-xl font-semibold tracking-tight text-[var(--ff-fg)]" style={HEADING_STYLE}>
        <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full" style={{ background: "var(--ff-grad)" }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function PanelTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <div className="ff-panel w-full overflow-hidden p-0 text-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="bg-[color-mix(in_srgb,var(--ff-fg)_2%,var(--ff-bg))]">
              {head.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="border-b border-[var(--ff-border)] px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--ff-muted)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i} className="border-b border-[var(--ff-border)] transition-colors duration-200 last:border-0 hover:bg-[color:color-mix(in_srgb,var(--ff-primary)_4%,transparent)]">
                {cells.map((cell, j) => (
                  <td
                    key={j}
                    className="px-3 py-2.5 align-top leading-relaxed text-[var(--ff-muted)]"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Param({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] font-medium text-[var(--ff-fg)]">{children}</span>;
}

export default async function EmbedDocsPage() {
  const origin = await appOrigin();
  const loaderUrl = `${origin}${LOADER_PATH}`;

  return (
    <div className="min-h-screen bg-[var(--ff-bg)] text-[var(--ff-fg)]">
      <AuroraBackdrop />
      <main className="relative mx-auto w-full max-w-3xl px-6 py-12">
        <div className="flex justify-center">
          <BrandRow />
        </div>

        {/* Glass explainer hero — gradient badge, heading accent, mono snippet preview. */}
        <section className="ff-panel relative mt-10 overflow-hidden p-6 text-center sm:p-10" style={HERO_STYLE}>
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px" style={{ background: "var(--ff-grad)" }} />
          <span className={BADGE_ACCENT}>Public docs · loader v{EMBED_LOADER_VERSION}</span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance" style={HEADING_STYLE}>
            Embed forms <Grad>anywhere</Grad>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[var(--ff-muted)]">
            Publish a document, then paste one script tag into any page. The loader (v{EMBED_LOADER_VERSION}) injects the
            frame, auto-resizes its height, and forwards completion events. No build step, no dependencies, works on plain
            HTML.
          </p>
          {/* Mono snippet preview — quick-start one-liner (full modes below). */}
          <CodeBlock
            code={`<script src="${loaderUrl}" data-formforge-doc="doc_xxxxxxxx" async></script>`}
            label="HTML"
          />
        </section>

        <Section title="Inline — the standard div">
          <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
            The frame renders exactly where the script sits and grows with its content.
          </p>
          <CodeBlock code={`<script\n  src="${loaderUrl}"\n  data-formforge-doc="doc_xxxxxxxx"\n  async\n></script>`} label="HTML" />
        </Section>

        <Section title="Popup">
          <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
            Renders a button; the form opens in a centered overlay. Close with the button, backdrop click or{" "}
            <kbd className="rounded-[4px] border border-[var(--ff-border-strong)] bg-[var(--ff-card)] px-1.5 py-0.5 font-mono text-xs text-[var(--ff-fg)]">
              Esc
            </kbd>
            .
          </p>
          <CodeBlock code={`<script\n  src="${loaderUrl}"\n  data-formforge-doc="doc_xxxxxxxx"\n  data-formforge-mode="popup"\n  data-formforge-label="Give feedback"\n  async\n></script>`} label="HTML" />
        </Section>

        <Section title="Side tab">
          <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
            A tab pinned to the right edge of the viewport; the form slides out from the side.
          </p>
          <CodeBlock code={`<script\n  src="${loaderUrl}"\n  data-formforge-doc="doc_xxxxxxxx"\n  data-formforge-mode="side-tab"\n  data-formforge-label="Feedback"\n  async\n></script>`} label="HTML" />
        </Section>

        <Section title="Multiple embeds / config on the div">
          <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
            Put the configuration on <Chip>div</Chip> elements instead
            and load the script once — <Chip>data-formforge-mode</Chip>{" "}
            also accepts the aliases <Chip>div</Chip> and{" "}
            <Chip>full-page</Chip> for <em>inline</em>.
          </p>
          <CodeBlock code={`<div data-formforge-embed="doc_aaa" data-formforge-mode="inline"></div>\n<div data-formforge-embed="doc_bbb" data-formforge-mode="popup" data-formforge-label="Open"></div>\n<script src="${loaderUrl}" async></script>`} label="HTML" />
        </Section>

        <Section title="Plain iframe (no auto-resize)">
          <p className="mt-2 text-sm leading-relaxed text-[var(--ff-muted)]">
            If you cannot run scripts, use the frame URL directly. It renders the published snapshot read-only; the page
            shows a graceful fallback while nothing is published.
          </p>
          <CodeBlock code={`<iframe\n  src="${origin}/embed/doc_xxxxxxxx?mode=inline"\n  style="width:100%;height:600px;border:0"\n  title="FormForge form"\n></iframe>`} label="HTML" />
        </Section>

        <Section title="Attributes">
          <PanelTable
            head={["Attribute", "Meaning"]}
            rows={[
              [
                <Param key="a1">data-formforge-doc</Param>,
                <>Document id to embed (script tag) — or set <TypeChip>data-formforge-embed</TypeChip> on a div</>,
              ],
              [
                <Param key="a2">data-formforge-mode</Param>,
                <><TypeChip>inline</TypeChip> (default) · <TypeChip>popup</TypeChip> · <TypeChip>side-tab</TypeChip></>,
              ],
              [<Param key="a3">data-formforge-label</Param>, <>Trigger / tab label; also the iframe title</>],
              [
                <Param key="a4">data-formforge-origin</Param>,
                <>Override the FormForge origin (defaults to the loader URL origin)</>,
              ],
            ]}
          />
        </Section>

        <Section title="postMessage API (spec §10.2)">
          <PanelTable
            head={["Message", "Direction", "Payload"]}
            rows={[
              [<Param key="m1">ff:ready</Param>, <>frame → host</>, <>—</>],
              [
                <Param key="m2">ff:height</Param>,
                <>frame → host</>,
                <><TypeChip>{"{ value: number }"}</TypeChip> content height in px</>,
              ],
              [
                <Param key="m3">ff:complete</Param>,
                <>frame → host</>,
                <><TypeChip>{"{ submissionToken }"}</TypeChip></>,
              ],
              [
                <Param key="m4">ff:request-height</Param>,
                <>host → frame</>,
                <>ask the frame to re-measure (also sent on window resize)</>,
              ],
            ]}
          />
          <p className="mt-3 text-sm leading-relaxed text-[var(--ff-muted)]">
            The loader only accepts messages from its own iframes whose origin matches the FormForge origin, so other
            scripts on the host page cannot spoof heights. For programmatic use, the container and{" "}
            <Chip>window</Chip> receive bubbling{" "}
            <Chip>CustomEvent</Chip>s:
          </p>
          <CodeBlock code={`document.addEventListener("formforge:complete", function (event) {\n  var detail = event.detail; // { docId, mode, submissionToken }\n  console.log("submission finished", detail);\n});`} label="JavaScript" />
          <p className="mt-3 text-sm leading-relaxed text-[var(--ff-muted)]">
            <Chip>window.FormForgeEmbed</Chip> exposes{" "}
            <Chip>{"{ version, records, scan() }"}</Chip> — call{" "}
            <Chip>scan()</Chip> after injecting markup dynamically.
          </p>
        </Section>

        <p className="mt-14 border-t border-[var(--ff-border)] pt-8 text-sm text-[var(--ff-muted)]">
          See all three modes live on the{" "}
          <Link className="font-medium text-[var(--ff-fg)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--ff-primary-2)]" href="/embed/demo">
            embed demo page
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
