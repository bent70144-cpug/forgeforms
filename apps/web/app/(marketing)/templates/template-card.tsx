// Gallery card for a template summary. Gradient placeholder thumbnail — no images.
import Link from "next/link";

import type { TemplateSummary } from "@formforge/core/templates";

const CATEGORY_LABEL: Record<string, string> = {
  form: "Form",
  page: "Landing page",
  portfolio: "Portfolio",
};

export default function TemplateCard({ template }: { template: TemplateSummary }) {
  return (
    <Link
      href={`/templates/${template.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      {/* Thumbnail placeholder: pure gradient, no images (issue #22) */}
      <div
        aria-hidden
        className={`relative aspect-[16/10] w-full bg-gradient-to-br ${template.gradient}`}
      >
        <span className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 backdrop-blur">
          {CATEGORY_LABEL[template.category] ?? template.category}
        </span>
        {template.hasLogic && (
          <span className="absolute right-3 top-3 rounded-full bg-slate-900/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            ⚡ Logic
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <h2 className="text-base font-semibold text-slate-900 group-hover:text-indigo-700">{template.name}</h2>
        <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-slate-500">{template.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{template.blockCount} blocks</span>
          {template.questionCount > 0 && <span>· {template.questionCount} questions</span>}
          {template.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
