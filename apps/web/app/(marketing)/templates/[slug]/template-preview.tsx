// Server-side presentational preview of a template DocumentBody (spec §7).
// This is a marketing-surface preview for the templates gallery, NOT the product
// renderer — the conversational/scroll renderers live in @formforge/renderer (M3+).
// SPEC-NOTE: richText props are template-authored, trusted strings; at publish time
// the snapshot builder sanitizes rich text (spec §8). The seed templates only ever
// ship simple <p>/<h3>/<h4>/<ul>/<strong> markup.
import type { CSSProperties, ReactNode } from "react";
import type { Block, DocumentBody } from "@formforge/core/templates";

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
  const radius = "var(--ff-radius, 10px)";

  let control: ReactNode = null;
  switch (b.kind) {
    case "short-text":
    case "email":
    case "number":
      control = (
        <div
          className="flex h-10 items-center px-3 text-sm text-slate-500"
          style={{ border: "1px solid var(--ff-border)", borderRadius: radius, background: "var(--ff-bg)" }}
        >
          {placeholderFor(b)}
        </div>
      );
      break;
    case "long-text":
      control = (
        <div
          className="min-h-20 px-3 py-2 text-sm text-slate-500"
          style={{ border: "1px solid var(--ff-border)", borderRadius: radius, background: "var(--ff-bg)" }}
        >
          {placeholderFor(b)}
        </div>
      );
      break;
    case "single-select":
      control = (
        <div className="flex flex-col gap-2">
          {options.map((o) => (
            <div key={o} className="flex items-center gap-2 text-sm">
              <span className="inline-block h-4 w-4 rounded-full" style={{ border: "2px solid var(--ff-border)" }} />
              {o}
            </div>
          ))}
          {b.props["allowOther"] === true && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="inline-block h-4 w-4 rounded-full" style={{ border: "2px solid var(--ff-border)" }} />
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
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
              style={{ border: "1px solid var(--ff-border)" }}
            >
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ border: "1.5px solid var(--ff-border)" }} />
              {o}
            </span>
          ))}
        </div>
      );
      break;
    case "dropdown":
      control = (
        <div className="flex h-10 items-center justify-between px-3 text-sm" style={{ border: "1px solid var(--ff-border)", borderRadius: radius }}>
          <span className="text-slate-500">{options.length} options</span>
          <span aria-hidden className="text-slate-400">▾</span>
        </div>
      );
      break;
    case "rating": {
      const scale = Math.min(Math.max(num(b, "scale", 5), 3), 10);
      control = (
        <div className="flex gap-1 text-xl text-amber-400" aria-hidden="true">
          {Array.from({ length: scale }, (_, i) => (
            <span key={i} aria-hidden>★</span>
          ))}
        </div>
      );
      break;
    }
    case "nps":
      control = (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{str(b, "leftLabel", "Not likely")}</span>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} className="flex h-7 w-7 items-center justify-center text-[10px]" style={{ border: "1px solid var(--ff-border)", borderRadius: radius }}>
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
        <div className="flex min-h-16 flex-col items-center justify-center gap-1 border-2 border-dashed px-4 py-4 text-xs text-slate-500" style={{ borderRadius: radius }}>
          <span className="text-lg" aria-hidden>⬆</span>
          <span>
            {strList(b, "accept").join(", ") || "any file"} · max {num(b, "maxSizeMb", 10)} MB
          </span>
        </div>
      );
      break;
  }

  return (
    <div className="p-4" style={{ border: "1px solid var(--ff-border)", borderRadius: radius, background: "var(--ff-bg)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--ff-fg)" }}>
        {label} {required && <span className="text-rose-500">*</span>}
      </p>
      {description && <p className="mt-1 text-xs" style={{ color: "var(--ff-muted)" }}>{description}</p>}
      <div className="mt-3">{control}</div>
    </div>
  );
}

function ContentPreview({ b }: { b: Block }) {
  const radius = "var(--ff-radius, 10px)";
  switch (b.kind) {
    case "hero": {
      const cta = optObj(b, "cta");
      return (
        <div
          className="overflow-hidden px-6 py-12 text-center sm:px-10 sm:py-16"
          style={{ borderRadius: RADIUS_PX["md"], background: "linear-gradient(135deg, var(--ff-primary), color-mix(in srgb, var(--ff-primary) 55%, #0f172a))" }}
        >
          <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {str(b, "title", "Hero title")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/80 sm:text-base">{str(b, "subtitle")}</p>
          {typeof cta["label"] === "string" && (
            <span className="mt-6 inline-block bg-white px-5 py-2.5 text-sm font-semibold text-slate-900" style={{ borderRadius: radius }}>
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
          style={{ color: "var(--ff-fg)" }}
          dangerouslySetInnerHTML={{ __html: str(b, "richText") }}
        />
      );
    case "image":
      return (
        <figure className="space-y-2">
          <div className="h-40 w-full" style={{ borderRadius: radius, background: placeholderGradient(str(b, "alt").length) }} />
          {(str(b, "caption") || str(b, "alt")) && (
            <figcaption className="text-xs" style={{ color: "var(--ff-muted)" }}>
              {str(b, "caption") || str(b, "alt")}
            </figcaption>
          )}
        </figure>
      );
    case "gallery": {
      const columns = Math.min(Math.max(num(b, "columns", 3), 1), 4);
      const layout = str(b, "layout", "grid");
      return layout === "masonry" ? (
        <div className="gap-3" style={{ columnCount: columns, columnGap: "0.75rem" }}>
          {Array.from({ length: columns * 3 }, (_, i) => (
            <div key={i} className="mb-3 break-inside-avoid" style={{ borderRadius: radius, background: placeholderGradient(i), height: `${120 + ((i * 37) % 90)}px` }} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns * 2 }, (_, i) => (
            <div key={i} className="aspect-[4/3]" style={{ borderRadius: radius, background: placeholderGradient(i) }} />
          ))}
        </div>
      );
    }
    case "video":
      return (
        <div className="flex aspect-video items-center justify-center bg-slate-900/90 text-white/80" style={{ borderRadius: radius }} role="img" aria-label="Video placeholder">
          <span className="text-3xl" aria-hidden>▶</span>
        </div>
      );
    case "testimonials":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {arr(b, "items").map((t, i) => (
            <blockquote key={i} className="p-4" style={{ border: "1px solid var(--ff-border)", borderRadius: radius, background: "var(--ff-bg)" }}>
              <p className="text-sm italic" style={{ color: "var(--ff-fg)" }}>
                “{typeof t["quote"] === "string" ? t["quote"] : ""}”
              </p>
              <footer className="mt-3 text-xs" style={{ color: "var(--ff-muted)" }}>
                {typeof t["name"] === "string" ? t["name"] : ""}
                {typeof t["role"] === "string" && ` · ${t["role"]}`}
              </footer>
            </blockquote>
          ))}
        </div>
      );
    case "faq":
      return (
        <div className="divide-y" style={{ borderColor: "var(--ff-border)" }}>
          {arr(b, "items").map((f, i) => (
            <details key={i} className="group py-3">
              <summary className="cursor-pointer list-none text-sm font-medium marker:hidden" style={{ color: "var(--ff-fg)" }}>
                {typeof f["q"] === "string" ? f["q"] : ""}
                <span className="float-right text-xs opacity-50 group-open:rotate-45" aria-hidden>＋</span>
              </summary>
              <p className="mt-2 text-sm" style={{ color: "var(--ff-muted)" }}>{typeof f["a"] === "string" ? f["a"] : ""}</p>
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
            const highlight: CSSProperties = i === 1 ? { boxShadow: "0 0 0 2px var(--ff-primary)" } : {};
            return (
              <div key={i} className="flex flex-col p-4" style={{ border: "1px solid var(--ff-border)", borderRadius: radius, background: "var(--ff-bg)", ...highlight }}>
                <p className="text-sm font-semibold" style={{ color: "var(--ff-fg)" }}>{typeof t["name"] === "string" ? t["name"] : ""}</p>
                <p className="mt-1 text-2xl font-bold" style={{ color: "var(--ff-primary)" }}>{typeof t["price"] === "string" ? t["price"] : ""}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs" style={{ color: "var(--ff-muted)" }}>
                  {features.map((f) => (
                    <li key={f} className="flex gap-1.5">
                      <span aria-hidden style={{ color: "var(--ff-primary)" }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                {typeof cta["label"] === "string" && (
                  <span className="mt-4 inline-block px-3 py-2 text-center text-xs font-semibold" style={{ borderRadius: radius, background: "var(--ff-primary)", color: "var(--ff-primary-fg)" }}>
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
              <article key={i} className="overflow-hidden" style={{ border: "1px solid var(--ff-border)", borderRadius: radius, background: "var(--ff-bg)" }}>
                <div className="h-28" style={{ background: placeholderGradient(i + title.length) }} />
                <div className="space-y-1.5 p-3">
                  <p className="text-sm font-semibold" style={{ color: "var(--ff-fg)" }}>{title}</p>
                  <p className="text-xs" style={{ color: "var(--ff-muted)" }}>{typeof p["description"] === "string" ? p["description"] : ""}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {tags.map((t) => (
                      <span key={t} className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "color-mix(in srgb, var(--ff-primary) 12%, transparent)", color: "var(--ff-primary)" }}>
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium capitalize"
                  style={{ border: "1px solid var(--ff-border)", borderRadius: "9999px", color: "var(--ff-fg)" }}
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
          className="inline-block px-5 py-2.5 text-sm font-semibold"
          style={{
            borderRadius: radius,
            ...(str(b, "style", "primary") === "primary"
              ? { background: "var(--ff-primary)", color: "var(--ff-primary-fg)" }
              : { border: "1px solid var(--ff-border)", color: "var(--ff-fg)" }),
          }}
        >
          {str(b, "label", "Button")}
        </span>
      );
    case "form-embed":
      return (
        <div
          className="flex min-h-32 flex-col items-center justify-center gap-1 border-2 border-dashed p-6 text-center"
          style={{ borderRadius: radius, borderColor: "var(--ff-primary)", background: "color-mix(in srgb, var(--ff-primary) 6%, transparent)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--ff-primary)" }}>Embedded form</p>
          <p className="max-w-sm text-xs" style={{ color: "var(--ff-muted)" }}>
            Placeholder — bind one of your published forms after instantiating this template.
          </p>
        </div>
      );
    case "section":
      return (
        <div className="px-4 py-6" style={{ borderRadius: radius, background: str(b, "background") || "transparent" }}>
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
  const style: CSSProperties = {
    "--ff-bg": tokens["color.bg"] ?? "#ffffff",
    "--ff-fg": tokens["color.fg"] ?? "#0f172a",
    "--ff-primary": tokens["color.primary"] ?? "#4f46e5",
    "--ff-primary-fg": tokens["color.primaryFg"] ?? "#ffffff",
    "--ff-muted": tokens["color.muted"] ?? "#64748b",
    "--ff-border": tokens["color.border"] ?? "#e2e8f0",
    "--ff-radius": radius,
    fontFamily: `'${body.theme.fontBody}', system-ui, sans-serif`,
    background: tokens["color.bg"] ?? "#ffffff",
    borderRadius: RADIUS_PX["lg"],
    border: "1px solid rgba(15, 23, 42, 0.08)",
  } as CSSProperties;

  return (
    <div className="space-y-6 p-4 sm:p-8" style={style}>
      {body.blocks.map((b) => (
        <BlockPreview key={b.id} b={b} />
      ))}

      {body.endings.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ff-muted)" }}>
            Ending screens
          </p>
          {body.endings.map((e) => (
            <div key={e.id} className="p-4 text-center" style={{ border: "1px dashed var(--ff-border)", borderRadius: "var(--ff-radius, 10px)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--ff-fg)" }}>{e.title}</p>
              {e.body && <p className="mt-1 text-xs" style={{ color: "var(--ff-muted)" }}>{e.body}</p>}
            </div>
          ))}
        </div>
      )}

      {body.logic.rules.length > 0 && (
        <p className="text-xs" style={{ color: "var(--ff-muted)" }}>
          ⚡ Includes branching logic — {body.logic.rules.length} rule{body.logic.rules.length === 1 ? "" : "s"} route respondents automatically.
        </p>
      )}
    </div>
  );
}
