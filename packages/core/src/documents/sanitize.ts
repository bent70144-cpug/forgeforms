/**
 * T29 — rich-text allowlist sanitizer (spec §17: "Rich text sanitized on save
 * AND on snapshot build (allowlist); no raw HTML blocks").
 *
 * Security stance (dependency-free, allowlist-only — nothing is "escaped and
 * passed through" unserialized):
 *
 *  - HTML-string input is TOKENIZED and re-emitted: only allowlisted tags are
 *    written back, only allowlisted attributes survive, all text is decoded
 *    once (entity normalization) and re-escaped on output. It is therefore
 *    impossible for `<script>`, event handlers, `javascript:` URLs, unknown
 *    tags or any raw markup to survive — output contains only tags this file
 *    emits itself.
 *  - Tiptap JSON input is SERIALIZED from the node/marks allowlist; text nodes
 *    are escaped. Unknown node types are transparent (children serialized),
 *    unknown marks are dropped.
 *  - Dropped-with-content tags (script/style/iframe/object/embed/template/…)
 *    consume their entire subtree — their body never becomes text.
 *  - `javascript:`/`data:`/`vbscript:` hrefs (including whitespace/entity
 *    encoded variants like `jav\u0000ascript:`) are rejected; only http(s),
 *    mailto, tel, relative and fragment hrefs survive.
 *
 * Renderers (packages/renderer `renderRichText`) pass snapshot HTML through
 * `dangerouslySetInnerHTML`, so this sanitizer is THE security boundary.
 */

// ---------------------------------------------------------------------------
// Allowlists
// ---------------------------------------------------------------------------

/** Tags that survive sanitization. Everything else is dropped or unwrapped. */
export const RICH_TEXT_ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre',
  'blockquote', 'a',
]);

/** Void (self-closing) tags on the allowlist. */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr']);

/** Attributes that survive, per tag. All other attributes are dropped. */
const ALLOWED_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'title']),
};

/** Tags whose entire content is dropped (never unwrapped into text). */
const DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'noframes',
  'noembed', 'template', 'textarea', 'xmp', 'plaintext', 'title',
  'svg', 'math',
]);

/** href schemes/shape allowed on <a>. Checked after entity decoding + CR/LF/TAB stripping. */
const SAFE_HREF_PATTERN = /^(https?:\/\/|mailto:|tel:|\/|#|\?|\.\/|\.\.\/)/i;

/** Tiptap node types that serialize to HTML. Unknown types stay transparent. */
const TIPTAP_NODES: ReadonlySet<string> = new Set([
  // lowercased — node.type is normalized with toLowerCase() before lookup
  'doc', 'paragraph', 'heading', 'bulletlist', 'orderedlist', 'listitem',
  'blockquote', 'codeblock', 'text', 'hardbreak', 'horizontalrule',
]);

const TIPTAP_MARKS: ReadonlySet<string> = new Set([
  'bold', 'italic', 'underline', 'strike', 'code', 'link',
]);

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

/** Decode the entities a sanitizer must normalize (&amp;, numeric, hex). Deliberately small. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);?/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? safeCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? safeCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function safeCodePoint(code: number): string {
  // Never let decoding resurrect a control char used in scheme smuggling.
  if (code <= 0x1f || code === 0x7f) return '\uFFFD';
  return String.fromCodePoint(code);
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip the characters browsers ignore inside URL schemes (smuggling vector). */
function normalizeUrl(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

function isSafeHref(raw: string): boolean {
  return SAFE_HREF_PATTERN.test(normalizeUrl(raw));
}

// ---------------------------------------------------------------------------
// HTML tokenizer / re-emitter
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'open'; tag: string; attrs: Map<string, string>; selfClosing: boolean }
  | { kind: 'close'; tag: string }
  | { kind: 'raw-block'; tag: string };

/** True when `<` at `i` begins a real tag (letters, '/', '!' or '?'). */
function startsTag(html: string, i: number): boolean {
  const next = html[i + 1] ?? '';
  return next === '!' || next === '?' || next === '/' || /[a-zA-Z]/.test(next);
}

function findTagEnd(html: string, start: number): number {
  // Returns the index just after '>'; handles quoted attribute values.
  let inQuote: string | null = null;
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!;
    if (inQuote !== null) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") inQuote = ch;
    else if (ch === '>') return i + 1;
  }
  return -1; // unterminated tag — treated as text
}

function parseTagBody(body: string): { tag: string; attrs: Map<string, string>; selfClosing: boolean } | null {
  const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(body);
  if (!nameMatch) return null;
  const tag = nameMatch[1]!.toLowerCase();
  const selfClosing = body.trimEnd().endsWith('/');
  const attrs = new Map<string, string>();
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
  let rest = body.slice(nameMatch[0].length);
  if (selfClosing) rest = rest.trimEnd().replace(/\/$/, '');
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(rest)) !== null) {
    const name = match[1]!.toLowerCase();
    const value = match[3] ?? match[4] ?? match[2] ?? '';
    if (!attrs.has(name)) attrs.set(name, decodeEntities(value));
  }
  return { tag, attrs, selfClosing };
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let textStart = 0;
  let i = 0;
  const pushText = (end: number) => {
    if (end > textStart) tokens.push({ kind: 'text', value: html.slice(textStart, end) });
  };

  while (i < html.length) {
    if (html[i] !== '<' || !startsTag(html, i)) {
      i++;
      continue;
    }
    // Comment / doctype / processing instruction — dropped entirely.
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      const stop = end === -1 ? html.length : end + 3;
      pushText(i);
      tokens.push({ kind: 'raw-block', tag: '#comment' });
      i = stop;
      textStart = i;
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const end = html.indexOf('>', i);
      const stop = end === -1 ? html.length : end + 1;
      pushText(i);
      tokens.push({ kind: 'raw-block', tag: '#declaration' });
      i = stop;
      textStart = i;
      continue;
    }
    const tagEnd = findTagEnd(html, i);
    if (tagEnd === -1) break; // unterminated '<' — the rest is text
    const body = html.slice(i + 1, tagEnd - 1);
    const closing = body.startsWith('/');
    const parsed = parseTagBody(body);
    if (!parsed) {
      // Not a tag after all — literal text.
      i++;
      continue;
    }
    pushText(i);
    tokens.push(
      closing
        ? { kind: 'close', tag: parsed.tag }
        : { kind: 'open', tag: parsed.tag, attrs: parsed.attrs, selfClosing: parsed.selfClosing },
    );
    i = tagEnd;
    textStart = i;
  }
  pushText(html.length);
  return tokens;
}

/** Serialize one allowlisted open tag with only its allowlisted attributes. */
function emitOpenTag(tag: string, attrs: Map<string, string>): string {
  if (tag === 'a') {
    const href = attrs.get('href');
    if (href !== undefined && !isSafeHref(href)) {
      // Unsafe href → keep the anchor as plain markup without href.
      return '<a>';
    }
    const title = attrs.get('title');
    const titleAttr = title !== undefined && title.trim() !== '' ? ` title="${escapeHtmlText(title)}"` : '';
    const hrefAttr = href !== undefined ? ` href="${escapeHtmlText(href)}"` : '';
    // rel is always forced: snapshot HTML may be rendered on any public page.
    return `<a${hrefAttr}${titleAttr} rel="noopener noreferrer nofollow">`;
  }
  return `<${tag}>`;
}

/**
 * Sanitize an HTML string (allowlist tokenizer) or serialize a Tiptap JSON
 * document. Anything else (numbers, null, …) becomes an empty string.
 */
export function sanitizeRichTextHtml(input: unknown): string {
  if (typeof input === 'string') return sanitizeHtmlString(input);
  if (input !== null && typeof input === 'object') return serializeTiptap(input);
  return '';
}

function sanitizeHtmlString(html: string): string {
  const tokens = tokenize(html);
  const out: string[] = [];
  const openStack: string[] = [];
  // Depth of the DROP_WITH_CONTENT subtree currently being consumed.
  let skipping: { tag: string; depth: number } | null = null;

  for (const token of tokens) {
    if (skipping !== null) {
      if (token.kind === 'open' && token.tag === skipping.tag && !token.selfClosing) {
        skipping.depth++;
      } else if (token.kind === 'close' && token.tag === skipping.tag) {
        skipping.depth--;
        if (skipping.depth === 0) skipping = null;
      }
      continue;
    }
    switch (token.kind) {
      case 'text': {
        out.push(escapeHtmlText(decodeEntities(token.value)));
        break;
      }
      case 'raw-block':
        break; // comments/doctype dropped
      case 'open': {
        if (DROP_WITH_CONTENT.has(token.tag)) {
          if (!token.selfClosing) skipping = { tag: token.tag, depth: 1 };
          break;
        }
        if (!RICH_TEXT_ALLOWED_TAGS.has(token.tag)) break; // unwrap: children only
        out.push(emitOpenTag(token.tag, token.attrs));
        if (!token.selfClosing && !VOID_TAGS.has(token.tag)) openStack.push(token.tag);
        break;
      }
      case 'close': {
        if (DROP_WITH_CONTENT.has(token.tag)) break;
        if (!RICH_TEXT_ALLOWED_TAGS.has(token.tag)) break;
        const idx = openStack.lastIndexOf(token.tag);
        if (idx === -1) break; // stray close — dropped
        // Close any inner open tags left unclosed (keeps output balanced).
        for (let k = openStack.length - 1; k >= idx; k--) {
          out.push(`</${openStack[k]}>`);
        }
        openStack.length = idx;
        break;
      }
    }
  }
  while (openStack.length > 0) out.push(`</${openStack.pop()}>`);
  return out.join('');
}

// ---------------------------------------------------------------------------
// Tiptap JSON serialization
// ---------------------------------------------------------------------------

function serializeTiptap(node: unknown): string {
  return serializeNode(node, new Set());
}

function serializeNode(node: unknown, activeMarks: ReadonlySet<string>): string {
  if (!isRecord(node)) return '';
  const type = typeof node.type === 'string' ? node.type.toLowerCase() : '';
  if (type === 'text') {
    return serializeTextNode(node, activeMarks);
  }
  if (!TIPTAP_NODES.has(type)) {
    // Transparent: serialize children only (never the unknown wrapper).
    return serializeContent(node, activeMarks);
  }
  switch (type) {
    case 'doc':
      return serializeContent(node, activeMarks);
    case 'hardbreak':
      return '<br>';
    case 'horizontalrule':
      return '<hr>';
    case 'paragraph':
      return `<p>${serializeContent(node, activeMarks)}</p>`;
    case 'heading': {
      // Tiptap nests node metadata under `attrs` ({ attrs: { level } }); accept
      // both shapes defensively.
      const attrs = isRecord(node.attrs) ? node.attrs : {};
      const rawLevel = numberOrNull(attrs.level) ?? numberOrNull(node.level);
      const tag = rawLevel !== null && rawLevel >= 1 && rawLevel <= 6 ? `h${Math.floor(rawLevel)}` : 'p';
      return `<${tag}>${serializeContent(node, activeMarks)}</${tag}>`;
    }
    case 'bulletlist':
      return `<ul>${serializeContent(node, activeMarks)}</ul>`;
    case 'orderedlist':
      return `<ol>${serializeContent(node, activeMarks)}</ol>`;
    case 'listitem':
      return `<li>${serializeContent(node, activeMarks)}</li>`;
    case 'blockquote':
      return `<blockquote>${serializeContent(node, activeMarks)}</blockquote>`;
    case 'codeblock':
      return `<pre><code>${serializeContent(node, activeMarks)}</code></pre>`;
    default:
      return serializeContent(node, activeMarks);
  }
}

function serializeTextNode(node: Record<string, unknown>, activeMarks: ReadonlySet<string>): string {
  const text = typeof node.text === 'string' ? node.text : '';
  if (text === '') return '';
  const marks = markSet(node.marks);
  const link = marks.get('link');
  const linkAttrs = link !== undefined && isRecord(link.attrs) ? link.attrs : link;
  const rawHref = isRecord(linkAttrs) && typeof linkAttrs.href === 'string' ? linkAttrs.href : null;
  const linkHref = rawHref !== null && isSafeHref(rawHref) ? normalizeUrl(rawHref) : null;

  let prefix = '';
  let suffix = '';
  if (marks.has('code')) {
    prefix += '<code>';
    suffix = '</code>' + suffix;
  }
  if (marks.has('bold')) {
    prefix += '<strong>';
    suffix = '</strong>' + suffix;
  }
  if (marks.has('italic')) {
    prefix += '<em>';
    suffix = '</em>' + suffix;
  }
  if (marks.has('underline')) {
    prefix += '<u>';
    suffix = '</u>' + suffix;
  }
  if (marks.has('strike')) {
    prefix += '<s>';
    suffix = '</s>' + suffix;
  }
  const escaped = escapeHtmlText(decodeEntities(text));
  const body =
    linkHref !== null
      ? `<a href="${escapeHtmlText(linkHref)}" rel="noopener noreferrer nofollow">${escaped}</a>`
      : escaped;
  return prefix + body + suffix;
}

function markSet(marks: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(marks)) return map;
  for (const mark of marks) {
    if (isRecord(mark) && typeof mark.type === 'string' && TIPTAP_MARKS.has(mark.type.toLowerCase())) {
      map.set(mark.type.toLowerCase(), mark);
    }
  }
  return map;
}

function serializeContent(node: unknown, activeMarks: ReadonlySet<string>): string {
  const content = isRecord(node) && Array.isArray(node.content) ? node.content : [];
  let out = '';
  for (const child of content) out += serializeNode(child, activeMarks);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Document-level seams (save + snapshot build)
// ---------------------------------------------------------------------------

/** Prop keys that carry rich text for the `text` block (renderer contract). */
const RICH_TEXT_PROP_KEYS: ReadonlySet<string> = new Set(['richText', 'html', 'text']);

/**
 * Snapshot-build seam (spec §17: sanitize on snapshot build). Returns the
 * sanitized HTML STRING for rich-text props — the renderer's
 * `renderRichText` trusts strings, so the snapshot never carries raw markup.
 */
export function sanitizeRichTextProp(value: unknown): unknown {
  return sanitizeRichTextHtml(value);
}

/**
 * Save-path seam (spec §17: sanitize on save). Walks every block (recursively)
 * and replaces rich-text props with their sanitized HTML string form, so the
 * STORED draft is already clean. Also covers endings' `body` as plain text.
 */
export function sanitizeDocumentBodyRichText<T extends { blocks?: unknown; endings?: unknown }>(
  body: T,
): T {
  if (body === null || typeof body !== 'object') return body;
  const clone = body as Record<string, unknown> & T;
  if (Array.isArray(clone.blocks)) {
    clone.blocks = (clone.blocks as unknown[]).map(sanitizeBlock);
  }
  return clone;
}

function sanitizeBlock(block: unknown): unknown {
  if (!isRecord(block)) return block;
  const kind = typeof block.kind === 'string' ? block.kind : '';
  const out: Record<string, unknown> = { ...block };
  if (isRecord(out.props)) {
    const props: Record<string, unknown> = { ...out.props };
    for (const key of Object.keys(props)) {
      const isRichKey = key === 'richText' || (kind === 'text' && RICH_TEXT_PROP_KEYS.has(key));
      if (!isRichKey) continue;
      const value = props[key];
      if (value === undefined || value === null) continue;
      props[key] = sanitizeRichTextHtml(value);
    }
    out.props = props;
  }
  if (Array.isArray(out.children)) {
    out.children = (out.children as unknown[]).map(sanitizeBlock);
  }
  return out;
}
