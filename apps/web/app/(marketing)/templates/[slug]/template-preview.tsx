// Server-side presentational preview of a template DocumentBody (spec §7).
// This is a marketing-surface preview for the templates gallery, NOT the product
// renderer — the conversational/scroll renderers live in @formforge/renderer (M3+).
// SPEC-NOTE: richText props are template-authored, trusted strings; at publish time
// the snapshot builder sanitizes rich text (spec §8). The seed templates only ever
// ship simple <p>/<h3>/<h4>/<ul>/<strong> markup.
//
// Structure: a muted "desk" frame (page tokens) holding the self-themed
// miniature page. The themed root keeps the scoped --ff-* token overrides —
// inside it every color resolves to the template's own theme, so all classes
// below use var(--ff-*) rather than fixed palette classes. Only dynamic values
// (generated placeholder tints, masonry heights, column counts) stay inline;
// static styling is Tailwind. Icons are inline SVG — no emoji glyphs.
import type { CSSProperties, ReactNode } from "react";
import type { Block, DocumentBody } from "@formforge/core/templates";

import { Icon } from "@/components/ui/icons";

const RADIUS_PX: Record<string, string> = {
  none: "0px",
  sm: "4px",
  md: "10px",
  lg: "18px",
  full: "9999px",
};

// --- prop accessors (block props are `Record<string, unknown>` at this layer) ---
function str(b: Block, key: string, fallback = ""): string {
  const v = b.props[key];
  return typeof v === "string" ? v : fallback;
}
function num(b: Block, key: string, fallback = 0): number {
  const v = b.props[key];
  return typeof v === "number" ? v : fallback;
}
function optObj(b: Block, key: string): Record<string, unknown> {
  const v = b.props[key];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function arr(b: Block, key: string): Record<string, unknown>[] {
  const v = b.props[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}
function strList(b: Block, key: string): string[] {
  const v = b.props[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const QUESTION_KINDS = new Set([
  "short-text",
  "long-text",
  "email",
  "number",
  "single-select",
  "multi-select",
  "dropdown",
  "rating",
  "nps",
  "file-upload",
]);

// Filled star (rating scales). Themed via --ff-chart-2 so light/dark flip with
// the page tokens; the path is drawn filled, not stroked.
function StarGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="var(--ff-chart-2)"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M12 2.8l2.9 5.88 6.5.95-4.7 4.58 1.1 6.47L12 17.63l-5.8 3.05 1.1-6.47-4.7-4.58 6.5-.95z" />
    </svg>
  );
}

// Play triangle (video placeholder).
function PlayGlyph({ size = 30 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M8.2 5.4v13.2L19 12z" />
    </svg>
  );
}

function placeholderGradient(i: number): string {
  // Deterministic pastel variation for thumbnails and gallery placeholders (no images).
  const hue = (i * 47 + 210) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 82%), hsl(${(hue + 40) % 360} 65% 68%))`;
}

function placeholderFor(b: Block): string {
  if (str(b, "placeholder")) return str(b, "placeholder");
  if (b.kind === "email") return "you@example.com";
  if (b.kind === "number") return "0";
  return "Type your answer…";
}

function QuestionPreview({ b }: { b: Block }) {
  const label = str(b, "label", "(untitled question)");
  const description = str(b, "description");
  const required = b.props["required"] === true;
  const options = arr(b, "options").map((o) => (typeof o["label"] === "string" ? o["label"] : ""));

  let control: ReactNode = null;
  switch (b.kind) {
    case "short-text":
    case "email":
    case "number":
      control = (
        <div className="flex h-10 items-center rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 text-sm text-[var(--ff-muted)]">
          {placeholderFor(b)}
        </div>
      );
      break;
    case "long-text":
      control = (
        <div className="min-h-20 rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg)] px-3 py-2 text-sm text-[var(--ff-muted)]">
          {placeholderFor(b)}
        </div>
      );
      break;
    case "single-select":
      control = (
        <div className="flex flex-col gap-2">
          {options.map((o) => (
            <div key={o} className="flex items-center gap-2 text-sm">
              <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-[var(--ff-border)]" />
              {o}
            </div>
          ))}
          {b.props["allowOther"] === true && (
            <div className="flex items-center gap-2 text-sm text-[var(--ff-muted)]">
              <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-[var(--ff-border)]" />
              Other…
            </div>
          )}
        </div>
      );
      break;
    case "multi-select":
      control = (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <span
              key={o}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ff-border)] px-3 py-1 text-xs"
            >
              <span className="inline-block h-3 w-3 rounded-[3px] border-[1.5px] border-[var(--ff-border)]" />
              {o}
            </span>
          ))}
        </div>
      );
      break;
    case "dropdown":
      control = (
        <div className="flex h-10 items-center justify-between rounded-[var(--ff-radius)] border border-[var(--ff-border)] px-3 text-sm">
          <span className="text-[var(--ff-muted)]">{options.length} options</span>
          <Icon name="chevronDown" size={14} className="text-[var(--ff-muted)] opacity-60" />
        </div>
      );
      break;
    case "rating": {
      const scale = Math.min(Math.max(num(b, "scale", 5), 3), 10);
      control = (
        <div className="flex flex-wrap gap-1" role="img" aria-label={`Rating scale of ${scale} stars`}>
          {Array.from({ length: scale }, (_, i) => (
            <StarGlyph key={i} />
          ))}
        </div>
      );
      break;
    }
    case "nps":
      control = (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ff-muted)]">
          <span>{str(b, "leftLabel", "Not likely")}</span>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 11 }, (_, i) => (
              <span
                key={i}
                className="flex h-7 w-7 items-center justify-center rounded-[var(--ff-radius)] border border-[var(--ff-border)] text-xs tabular-nums"
              >
                {i}
              </span>
            ))}
          </div>
          <span>{str(b, "rightLabel", "Very likely")}</span>
        </div>
      );
      break;
    case "file-upload":
      control = (
        <div className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-[var(--ff-radius)] border-2 border-dashed border-[var(--ff-border)] px-4 py-4 text-xs text-[var(--ff-muted)]">
          <Icon name="upload" size={16} />
          <span>
            {strList(b, "accept").join(", ") || "any file"} · max {num(b, "maxSizeMb", 10)} MB
          </span>
        </div>
      );
      break;
  }

  return (
    <div className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg)] p-4">
      <p className="text-sm font-medium">
        {label} {required && <span className="text-rose-500">*</span>}
      </p>
      {description && <p className="mt-1 text-xs text-[var(--ff-muted)]">{description}</p>}
      <div className="mt-3">{control}</div>
    </div>
  );
}

function ContentPreview({ b }: { b: Block }) {
  switch (b.kind) {
    case "hero": {
      const cta = optObj(b, "cta");
      return (
        <div className="overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,var(--ff-primary),color-mix(in_srgb,var(--ff-primary)_55%,var(--ff-fg)))] px-6 py-12 text-center sm:px-10 sm:py-16">
          <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-[var(--ff-primary-fg)] sm:text-4xl">
            {str(b, "title", "Hero title")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[color-mix(in_srgb,var(--ff-primary-fg)_82%,transparent)] sm:text-base">
            {str(b, "subtitle")}
          </p>
          {typeof cta["label"] === "string" && (
            <span className="mt-6 inline-block rounded-[var(--ff-radius)] bg-[var(--ff-primary-fg)] px-5 py-2.5 text-sm font-semibold text-[var(--ff-primary)]">
              {cta["label"]}
            </span>
          )}
        </div>
      );
    }
    case "text":
      return (
        <div
          className="[&_h3]:text-lg [&_h3]:font-semibold [&_h4]:text-sm [&_h4]:font-semibold [&_li]:mt-1 [&_p]:mt-2 [&_p]:text-sm [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: str(b, "richText") }}
        />
      );
    case "image":
      return (
        <figure className="space-y-2">
          <div
            className="h-40 w-full rounded-[var(--ff-radius)]"
            style={{ background: placeholderGradient(str(b, "alt").length) }}
          />
          {(str(b, "caption") || str(b, "alt")) && (
            <figcaption className="text-xs text-[var(--ff-muted)]">{str(b, "caption") || str(b, "alt")}</figcaption>
          )}
        </figure>
      );
    case "gallery": {
      const columns = Math.min(Math.max(num(b, "columns", 3), 1), 4);
      const layout = str(b, "layout", "grid");
      return layout === "masonry" ? (
        <div className="gap-3" style={{ columnCount: columns, columnGap: "0.75rem" }}>
          {Array.from({ length: columns * 3 }, (_, i) => (
            <div
              key={i}
              className="mb-3 break-inside-avoid rounded-[var(--ff-radius)]"
              style={{ background: placeholderGradient(i), height: `${120 + ((i * 37) % 90)}px` }}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns * 2 }, (_, i) => (
            <div
              key={i}
              className="aspect-[4/3] rounded-[var(--ff-radius)]"
              style={{ background: placeholderGradient(i) }}
            />
          ))}
        </div>
      );
    }
    case "video":
      return (
        <div
          className="flex aspect-video items-center justify-center rounded-[var(--ff-radius)] bg-[color-mix(in_srgb,var(--ff-fg)_90%,transparent)] text-[color-mix(in_srgb,var(--ff-bg)_82%,transparent)]"
          role="img"
          aria-label="Video placeholder"
        >
          <PlayGlyph />
        </div>
      );
    case "testimonials":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {arr(b, "items").map((t, i) => (
            <blockquote
              key={i}
              className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg)] p-4"
            >
              <p className="text-sm italic">“{typeof t["quote"] === "string" ? t["quote"] : ""}”</p>
              <footer className="mt-3 text-xs text-[var(--ff-muted)]">
                {typeof t["name"] === "string" ? t["name"] : ""}
                {typeof t["role"] === "string" && ` · ${t["role"]}`}
              </footer>
            </blockquote>
          ))}
        </div>
      );
    case "faq":
      return (
        <div className="divide-y divide-[var(--ff-border)]">
          {arr(b, "items").map((f, i) => (
            <details key={i} className="group py-3">
              <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
                {typeof f["q"] === "string" ? f["q"] : ""}
                <Icon
                  name="plus"
                  size={12}
                  className="float-right mt-0.5 opacity-50 transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="mt-2 text-sm text-[var(--ff-muted)]">{typeof f["a"] === "string" ? f["a"] : ""}</p>
            </details>
          ))}
        </div>
      );
    case "pricing":
      return (
        <div className="grid gap-4 sm:grid-cols-3">
          {arr(b, "tiers").map((t, i) => {
            const cta = t["cta"] && typeof t["cta"] === "object" ? (t["cta"] as Record<string, unknown>) : {};
            const features = Array.isArray(t["features"]) ? t["features"].filter((f): f is string => typeof f === "string") : [];
            return (
              <div
                key={i}
                className={`flex flex-col rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg)] p-4${
                  i === 1 ? " ring-2 ring-[var(--ff-primary)]" : ""
                }`}
              >
                <p className="text-sm font-semibold">{typeof t["name"] === "string" ? t["name"] : ""}</p>
                <p className="mt-1 text-2xl font-bold text-[var(--ff-primary)]">
                  {typeof t["price"] === "string" ? t["price"] : ""}
                </p>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs text-[var(--ff-muted)]">
                  {features.map((f) => (
                    <li key={f} className="flex gap-1.5">
                      <Icon name="check" size={12} className="mt-0.5 shrink-0 text-[var(--ff-primary)]" />
                      {f}
                    </li>
                  ))}
                </ul>
                {typeof cta["label"] === "string" && (
                  <span className="mt-4 inline-block rounded-[var(--ff-radius)] bg-[var(--ff-primary)] px-3 py-2 text-center text-xs font-semibold text-[var(--ff-primary-fg)]">
                    {cta["label"]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      );
    case "projects":
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {arr(b, "items").map((p, i) => {
            const title = typeof p["title"] === "string" ? p["title"] : "";
            const tags = Array.isArray(p["tags"]) ? p["tags"].filter((t): t is string => typeof t === "string") : [];
            return (
              <article
                key={i}
                className="overflow-hidden rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg)]"
              >
                <div className="h-28" style={{ background: placeholderGradient(i + title.length) }} />
                <div className="space-y-1.5 p-3">
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-xs text-[var(--ff-muted)]">
                    {typeof p["description"] === "string" ? p["description"] : ""}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-[color-mix(in_srgb,var(--ff-primary)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--ff-primary)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      );
    case "contact-links":
      return (
        <ul className="flex flex-wrap gap-2">
          {arr(b, "links").map((l, i) => {
            const url = typeof l["url"] === "string" ? l["url"] : "#";
            const type = typeof l["type"] === "string" ? l["type"] : "link";
            return (
              <li key={i}>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ff-border)] px-3 py-1.5 text-xs font-medium capitalize"
                  title={url}
                >
                  {type}
                </span>
              </li>
            );
          })}
        </ul>
      );
    case "button":
      return (
        <span
          className={`inline-block rounded-[var(--ff-radius)] px-5 py-2.5 text-sm font-semibold${
            str(b, "style", "primary") === "primary"
              ? " bg-[var(--ff-primary)] text-[var(--ff-primary-fg)]"
              : " border border-[var(--ff-border)]"
          }`}
        >
          {str(b, "label", "Button")}
        </span>
      );
    case "form-embed":
      return (
        <div className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-[var(--ff-radius)] border-2 border-dashed border-[var(--ff-primary)] bg-[color-mix(in_srgb,var(--ff-primary)_6%,transparent)] p-6 text-center">
          <p className="text-sm font-semibold text-[var(--ff-primary)]">Embedded form</p>
          <p className="max-w-sm text-xs text-[var(--ff-muted)]">
            Placeholder — bind one of your published forms after instantiating this template.
          </p>
        </div>
      );
    case "section":
      return (
        <div className="rounded-[var(--ff-radius)] px-4 py-6" style={{ background: str(b, "background") || "transparent" }}>
          {(b.children ?? []).map((c) => (
            <div key={c.id} className="[&>*+*]:mt-4">
              <BlockPreview b={c} />
            </div>
          ))}
        </div>
      );
    case "columns": {
      const count = Math.min(Math.max(num(b, "count", 2), 2), 4);
      return (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
          {(b.children ?? []).map((c) => (
            <BlockPreview key={c.id} b={c} />
          ))}
        </div>
      );
    }
    default:
      // Unknown kinds render as nothing, per the registry rules (spec §7.1).
      return null;
  }
}

function BlockPreview({ b }: { b: Block }) {
  if (b.hidden) return null;
  return QUESTION_KINDS.has(b.kind) ? <QuestionPreview b={b} /> : <ContentPreview b={b} />;
}

/** Full-document preview used by the template gallery detail page. */
export default function TemplatePreview({ body }: { body: DocumentBody }) {
  const tokens = body.theme.tokens;
  const radius = body.theme.radius === "full" ? "14px" : (RADIUS_PX[body.theme.radius] ?? RADIUS_PX["md"]);
  // Scoped --ff-* overrides: inside this root every var(--ff-*) class resolves
  // to the template's own theme, which is what makes the preview self-themed.
  const themeStyle: CSSProperties = {
    "--ff-bg": tokens["color.bg"] ?? "#ffffff",
    "--ff-fg": tokens["color.fg"] ?? "#0f172a",
    "--ff-primary": tokens["color.primary"] ?? "#4f46e5",
    "--ff-primary-fg": tokens["color.primaryFg"] ?? "#ffffff",
    "--ff-muted": tokens["color.muted"] ?? "#64748b",
    "--ff-border": tokens["color.border"] ?? "#e2e8f0",
    "--ff-radius": radius,
    fontFamily: `'${body.theme.fontBody}', system-ui, sans-serif`,
  } as CSSProperties;

  return (
    // Muted desk frame (page tokens — outside the themed root on purpose).
    <div className="bg-[color-mix(in_srgb,var(--ff-fg)_3%,var(--ff-bg))] p-4 sm:p-6">
      <div
        className="space-y-6 overflow-hidden rounded-[18px] border border-[color-mix(in_srgb,var(--ff-fg)_10%,transparent)] bg-[var(--ff-bg)] p-4 text-[var(--ff-fg)] shadow-sm sm:p-8"
        style={themeStyle}
      >
        {body.blocks.map((b) => (
          <BlockPreview key={b.id} b={b} />
        ))}

        {body.endings.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-semibold text-[var(--ff-muted)]">Ending screens</p>
            {body.endings.map((e) => (
              <div
                key={e.id}
                className="rounded-[var(--ff-radius)] border border-dashed border-[var(--ff-border)] p-4 text-center"
              >
                <p className="text-sm font-semibold">{e.title}</p>
                {e.body && <p className="mt-1 text-xs text-[var(--ff-muted)]">{e.body}</p>}
              </div>
            ))}
          </div>
        )}

        {body.logic.rules.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--ff-muted)]">
            <Icon name="sparkles" size={14} className="shrink-0 text-[var(--ff-primary)]" />
            Includes branching logic — {body.logic.rules.length} rule{body.logic.rules.length === 1 ? "" : "s"} route
            respondents automatically.
          </p>
        )}
      </div>
    </div>
  );
}
