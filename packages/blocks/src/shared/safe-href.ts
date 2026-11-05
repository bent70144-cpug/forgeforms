// packages/blocks — href guard for renderer output.
// OWNED BY T06 (issue #6).
//
// SPEC-NOTE: not required by §7.2, but §17 (security checklist) forbids script
// execution from user content; block props are user-supplied and rendered into
// public pages, so `javascript:` / `data:` URLs collapse to "#".

const BLOCKED_HREF_PATTERN = /^\s*(javascript|data|vbscript):/i;

/** Return the href if it is safe, otherwise "#". */
export function safeHref(href: string): string {
  return BLOCKED_HREF_PATTERN.test(href) ? "#" : href;
}
