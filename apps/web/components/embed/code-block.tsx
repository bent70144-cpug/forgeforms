"use client";

// Copy-to-clipboard code block for the /embed docs page.
// Client component (bundled by Next — safe under the strict-nonce CSP on
// /embed/*: no inline <script> — inline *styles* are allowed by the public
// CSP's style-src 'unsafe-inline'). Premium "aurora glass" panel: gradient
// top bar with a language chip, tokenized mono body, glow border on hover.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Icon } from "@/components/ui/icons";
import { ICON_BTN } from "@/lib/ui";

/* ---------- token highlighter (dependency-free, presentation-only) ----------
 * A tiny scanner splits the snippet into colored spans. The plain text of the
 * code is never altered — selecting/copying from the <pre> still yields the
 * exact snippet. Colors derive from app tokens so light/dark both flip.
 */
type TokKind = "str" | "tag" | "attr" | "kw" | "num" | "call" | "com" | "pun" | "txt";

const TOK_CLASS: Record<TokKind, string> = {
  str: "text-[color:var(--ff-accent)]",
  tag: "text-[color:color-mix(in_srgb,var(--ff-primary-2)_80%,var(--ff-fg))]",
  attr: "text-[color:color-mix(in_srgb,var(--ff-primary)_72%,var(--ff-fg))]",
  kw: "text-[color:color-mix(in_srgb,var(--ff-primary)_76%,var(--ff-fg))] font-medium",
  num: "text-[color:var(--ff-warning)]",
  call: "text-[color:var(--ff-primary-2)]",
  com: "text-[color:var(--ff-muted)] italic",
  pun: "text-[color:var(--ff-muted)]",
  txt: "",
};

type Tok = { t: string; c: TokKind };

function pushGap(out: Tok[], code: string, from: number, to: number): void {
  if (to > from) out.push({ t: code.slice(from, to), c: "txt" });
}

/** HTML-ish: strings cyan, tag names sky, attribute words violet, punctuation muted. */
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

/** JS-ish: comments muted, strings cyan, keywords violet, numbers amber, calls sky. */
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

const BAR_STYLE: CSSProperties = {
  background:
    "linear-gradient(135deg, color-mix(in srgb, var(--ff-primary) 22%, var(--ff-card)) 0%, color-mix(in srgb, var(--ff-primary-2) 16%, var(--ff-card)) 100%)",
};

const LANG_CHIP_STYLE: CSSProperties = {
  background: "var(--ff-grad)",
  color: "var(--ff-primary-fg)",
};

const BODY_STYLE: CSSProperties = {
  background: "var(--ff-bg-2)",
  fontFamily: "var(--ff-font-mono)",
};

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
      className="group relative mt-3 overflow-hidden rounded-[14px] border border-[var(--ff-glass-border)] shadow-[var(--ff-shadow-sm)] transition-[border-color,box-shadow] duration-200 hover:border-[var(--ff-border-strong)] hover:shadow-[var(--ff-glow-soft)]"
      style={{ background: "var(--ff-card)" }}
    >
      <figcaption
        className="flex items-center justify-between gap-2 border-b border-[var(--ff-glass-border)] px-3 py-2"
        style={BAR_STYLE}
      >
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={LANG_CHIP_STYLE}
        >
          <Icon name="code" size={11} />
          {label ?? "code"}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className={ICON_BTN}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
        </button>
      </figcaption>

      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-[var(--ff-fg)]" style={BODY_STYLE}>
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

      {/* hairline gradient energy strip (also keeps <figcaption> a valid first child) */}
      <div aria-hidden="true" className="h-px w-full" style={{ background: "var(--ff-grad)" }} />
    </figure>
  );
}
