"use client";

// Copy-to-clipboard code block for the /embed docs page.
// Client component (bundled by Next — safe under the strict-nonce CSP on
// /embed/*: no inline <script> — inline *styles* are allowed by the public
// CSP's style-src 'unsafe-inline'). Meridian "ink well": the inverse of the
// paper canvas — ink background, paper text, hairline border, quiet mono
// language label and a ghost-on-dark copy button. Syntax colors are token
// mixes lifted toward the paper pole so they stay readable on the well in
// both light and night mode.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Icon } from "@/components/ui/icons";

/* ---------- token highlighter (dependency-free, presentation-only) ----------
 * A tiny scanner splits the snippet into colored spans. The plain text of the
 * code is never altered — selecting/copying from the <pre> still yields the
 * exact snippet. Colors derive from app tokens so light/dark both flip.
 */
type TokKind = "str" | "tag" | "attr" | "kw" | "num" | "call" | "com" | "pun" | "txt";

/* Every hue is mixed toward var(--ff-bg) (paper): on the ink well that lifts
 * contrast past WCAG AA, and when night mode flips the well to light ink the
 * same mix darkens the hues back into contrast. */
const TOK_CLASS: Record<TokKind, string> = {
  str: "text-[color:color-mix(in_srgb,var(--ff-accent)_62%,var(--ff-bg))]",
  tag: "text-[color:color-mix(in_srgb,var(--ff-primary)_68%,var(--ff-bg))]",
  attr: "text-[color:color-mix(in_srgb,var(--ff-primary)_54%,var(--ff-bg))]",
  kw: "text-[color:color-mix(in_srgb,var(--ff-primary)_58%,var(--ff-bg))] font-medium",
  num: "text-[color:color-mix(in_srgb,var(--ff-warning)_64%,var(--ff-bg))]",
  call: "text-[color:color-mix(in_srgb,var(--ff-primary-2)_66%,var(--ff-bg))]",
  com: "text-[color:color-mix(in_srgb,var(--ff-muted)_62%,var(--ff-bg))] italic",
  pun: "text-[color:color-mix(in_srgb,var(--ff-muted)_62%,var(--ff-bg))]",
  txt: "",
};

type Tok = { t: string; c: TokKind };

function pushGap(out: Tok[], code: string, from: number, to: number): void {
  if (to > from) out.push({ t: code.slice(from, to), c: "txt" });
}

/** HTML-ish: strings terracotta, tag names ultramarine, attribute words a lighter ultramarine, punctuation muted. */
function tokenizeHtml(code: string): Tok[] {
  const out: Tok[] = [];
  const re = /("[^"]*"|'[^']*')|(<\/?[A-Za-z][\w-]*|\/?>)|(=)|([A-Za-z_][\w-]*)/g;
  let last = 0;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    pushGap(out, code, last, m.index);
    if (m[1] !== undefined) out.push({ t: m[1], c: "str" });
    else if (m[2] !== undefined) out.push({ t: m[2], c: "tag" });
    else if (m[3] !== undefined) out.push({ t: m[3], c: "pun" });
    else if (m[4] !== undefined) out.push({ t: m[4], c: "attr" });
    last = re.lastIndex;
  }
  pushGap(out, code, last, code.length);
  return out;
}

const JS_KEYWORD =
  /^(?:var|let|const|function|return|new|if|else|typeof|true|false|null|undefined|window|document)$/;

/** JS-ish: comments muted, strings terracotta, keywords ultramarine, numbers amber, calls deep ultramarine. */
function tokenizeJs(code: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(\s*\()?/g;
  let last = 0;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    pushGap(out, code, last, m.index);
    if (m[1] !== undefined) {
      out.push({ t: m[1], c: "com" });
    } else if (m[2] !== undefined) {
      out.push({ t: m[2], c: "str" });
    } else if (m[3] !== undefined) {
      out.push({ t: m[3], c: "num" });
    } else if (m[4] !== undefined) {
      // Identifier — keyword wins, otherwise a call site when "(" follows.
      out.push({ t: m[4], c: JS_KEYWORD.test(m[4]) ? "kw" : m[5] !== undefined ? "call" : "txt" });
      if (m[5] !== undefined) out.push({ t: m[5], c: "txt" });
    }
    last = re.lastIndex;
  }
  pushGap(out, code, last, code.length);
  return out;
}

function tokenize(code: string, label?: string): Tok[] {
  const lang = (label ?? "").trim().toLowerCase();
  if (lang.startsWith("java") || lang === "js" || lang === "ts") return tokenizeJs(code);
  if (lang.startsWith("htm") || lang === "xml" || lang === "svg") return tokenizeHtml(code);
  return [{ t: code, c: "txt" }];
}

const BODY_STYLE: CSSProperties = {
  fontFamily: "var(--ff-font-mono)",
};

/** Paper-mixed text/icon helpers for the ink well (contrast-safe both modes). */
const WELL_TEXT = "color-mix(in srgb, var(--ff-bg) 92%, var(--ff-fg))";
const WELL_MUTED = "color-mix(in srgb, var(--ff-bg) 62%, var(--ff-fg))";
const WELL_HAIRLINE = "color-mix(in srgb, var(--ff-bg) 16%, transparent)";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure context) — copy is a
      // progressive enhancement; the code stays selectable either way.
    }
  }

  const toks = tokenize(code, label);

  return (
    <figure
      className="relative mt-3 overflow-hidden rounded-[var(--ff-radius)] border border-[color:var(--ff-border-strong)] shadow-[var(--ff-shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--ff-shadow-md)]"
      style={{ background: "var(--ff-fg)", color: WELL_TEXT }}
    >
      <figcaption
        className="flex items-center justify-between gap-2 border-b px-3 py-2"
        style={{ borderColor: WELL_HAIRLINE }}
      >
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: WELL_MUTED }}
        >
          <Icon name="code" size={11} />
          {label ?? "code"}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-200 hover:bg-[color:color-mix(in_srgb,var(--ff-bg)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: WELL_MUTED, outlineColor: WELL_MUTED }}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
        </button>
      </figcaption>

      <pre
        className="overflow-x-auto p-4 text-[13px] leading-relaxed"
        style={{ ...BODY_STYLE, color: WELL_TEXT }}
      >
        <code>
          {toks.map((tok, i) =>
            tok.c === "txt" ? (
              <span key={i}>{tok.t}</span>
            ) : (
              <span key={i} className={TOK_CLASS[tok.c]}>
                {tok.t}
              </span>
            ),
          )}
        </code>
      </pre>
    </figure>
  );
}
