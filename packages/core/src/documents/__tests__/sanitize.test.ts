/**
 * T29 — XSS payload battery for the rich-text allowlist sanitizer (spec §17:
 * "Rich text sanitized on save AND on snapshot build"). Acceptance: "XSS
 * payloads in rich text and answers neutralized (test suite)".
 *
 * Every payload class from the ticket — script tags, event handlers,
 * javascript: URLs, nested/encoded payloads — must be neutralized: the output
 * contains no executable markup (no script/iframe/svg/object tags, no on*
 * attributes, no javascript:/data: URLs) and no raw (unescaped) tag syntax
 * originating from the input.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  escapeHtmlText,
  sanitizeDocumentBodyRichText,
  sanitizeRichTextHtml,
} from '../sanitize';

/** Cheap invariants every sanitized output must satisfy. */
function expectInert(output: string) {
  const lowered = output.toLowerCase();
  expect(lowered).not.toContain('<script');
  expect(lowered).not.toContain('<iframe');
  expect(lowered).not.toContain('<svg');
  expect(lowered).not.toContain('<object');
  expect(lowered).not.toContain('<embed');
  expect(lowered).not.toContain('<img');
  expect(lowered).not.toContain('javascript:');
  expect(lowered).not.toContain('vbscript:');
  expect(lowered).not.toContain('data:text/html');
  // No attribute of any EMITTED tag may be an event handler. (Escaped text may
  // legitimately *display* payload fragments like "onerror=" — that is inert.)
  expect(output).not.toMatch(/<[^>]*\son\w+\s*=/i);
}

describe('sanitizeRichTextHtml — script tags', () => {
  it.each([
    '<script>alert(1)</script>',
    '<script src="https://evil.example/x.js"></script>',
    '<SCRIPT>alert(1)</SCRIPT>',
    '<ScRiPt>alert(1)</sCrIpT>',
    '<script\n>alert(1)</script>',
    '<script defer>alert(1)</script>',
    '<script>alert(1)', // unterminated
    '<script/src=data:,alert(1)></script>',
  ])('drops %j entirely (content included)', (payload) => {
    expect(sanitizeRichTextHtml(payload)).toBe('');
  });

  it('neutralizes tag-soup mixing (<scr<script>ipt>) — remnants are inert text only', () => {
    const out = sanitizeRichTextHtml('<scr<script>ipt>alert(1)</script>');
    expectInert(out);
    expect(out).not.toContain('<scr');
    expect(out).not.toContain('<script');
  });

  it('keeps sibling text when a script is dropped between it', () => {
    const out = sanitizeRichTextHtml('before<script>alert(1)</script>after');
    expect(out).toBe('beforeafter');
  });
});

describe('sanitizeRichTextHtml — event handlers', () => {
  it.each([
    '<img src=x onerror=alert(1)>',
    '<img src=x onerror="alert(1)">',
    "<p onload=alert(1)>text</p>",
    '<body onload=alert(1)>',
    '<div onmouseover="alert(1)">hover</div>',
    '<a href="/x" onclick="alert(1)">go</a>',
    '<svg onload=alert(1)><circle/></svg>',
    '<input autofocus onfocus=alert(1)>',
    '<form action="javascript:alert(1)"><button formaction=alert(1)>x</button></form>',
    '<details open ontoggle=alert(1)>',
    '<video><source onerror=alert(1)>',
    '<marquee onstart=alert(1)>x</marquee>',
  ])('neutralizes %j (tag unwrapped or attrs stripped, no handlers remain)', (payload) => {
    const out = sanitizeRichTextHtml(payload);
    expectInert(out);
    // Unknown tags unwrap — only their text children may survive.
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('ontoggle');
    expect(out).not.toContain('onfocus');
  });

  it('emits only allowlisted tags with only allowlisted attributes', () => {
    const out = sanitizeRichTextHtml('<a href="/x" onclick="alert(1)" target="_blank" data-x=1>go</a>');
    expect(out).toBe('<a href="/x" rel="noopener noreferrer nofollow">go</a>');
  });
});

describe('sanitizeRichTextHtml — javascript: and dangerous URLs', () => {
  it.each([
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="jav\tascript:alert(1)">x</a>',
    '<a href="java\nscript:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="&#x6A;avascript:alert(1)">x</a>',
    '<a href=" javascript:alert(1)">x</a>',
    '<a href="java\x00script:alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    '<a href="DATA:text/html,<script>alert(1)</script>">x</a>',
  ])('strips the href from %j', (payload) => {
    const out = sanitizeRichTextHtml(payload);
    expectInert(out);
    expect(out).toBe('<a>x</a>');
  });

  it('keeps safe href schemes', () => {
    const html = [
      '<a href="https://example.com/a">a</a>',
      '<a href="http://example.com">b</a>',
      '<a href="mailto:someone@example.com">c</a>',
      '<a href="tel:+15551234">d</a>',
      '<a href="/relative">e</a>',
      '<a href="#fragment">f</a>',
    ].join('');
    const out = sanitizeRichTextHtml(html);
    expect(out).toContain('href="https://example.com/a"');
    expect(out).toContain('href="http://example.com"');
    expect(out).toContain('href="mailto:someone@example.com"');
    expect(out).toContain('href="tel:+15551234"');
    expect(out).toContain('href="/relative"');
    expect(out).toContain('href="#fragment"');
    // rel forced on all anchors
    expect((out.match(/rel="noopener noreferrer nofollow"/g) ?? []).length).toBe(6);
  });

  it('escapes quote characters inside a surviving href (attribute breakout)', () => {
    const out = sanitizeRichTextHtml('<a href="/x?a="><script>alert(1)</script>">x</a>');
    expectInert(out);
    expect(out).not.toContain('"><script');
  });
});

describe('sanitizeRichTextHtml — nested / encoded payloads', () => {
  it.each([
    '<<script>script>alert(1)<</script>/script>',
    '<scr<script>ipt>alert(1)</scr</script>ipt>',
    '<img src="x" onerror="alert(1)"//>',
    '<img src=x onerror=alert(1)//',
    '<img src=x:onerror=alert(1)>',
    '<script>alert(String.fromCharCode(88,83,83))</script>',
    '<img src=x oneonerrorrror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    '<template><script>alert(1)</script></template>',
    '<noscript><p title="</noscript><script>alert(1)</script>">',
    '<a href="j&#x41;vascript:alert(1)">x</a>',
    '<a href="\u0001javascript:alert(1)">x</a>',
  ])('neutralizes %j', (payload) => {
    expectInert(sanitizeRichTextHtml(payload));
  });

  it('decodes entities in text then re-escapes (no double-execution)', () => {
    expect(sanitizeRichTextHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('entity-encoded text becomes inert visible text, never markup', () => {
    const out = sanitizeRichTextHtml('<p>&#60;img src=x onerror=alert(1)&#62;</p>');
    expect(out).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });
});

describe('sanitizeRichTextHtml — allowlist behavior', () => {
  it('keeps allowlisted formatting tags and text', () => {
    const out = sanitizeRichTextHtml(
      '<h2>Title</h2><p>Plain <strong>bold</strong>, <em>italic</em>, <code>code</code> and a <a href="https://ok.example" title="ok">link</a>.</p><ul><li>one</li><li>two</li></ul>',
    );
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<a href="https://ok.example" title="ok" rel="noopener noreferrer nofollow">link</a>');
  });

  it('unwraps unknown tags but keeps their text (div/span/section/font/table)', () => {
    expect(sanitizeRichTextHtml('<div class="x"><font size="1">hi</font></div>')).toBe('hi');
    expect(sanitizeRichTextHtml('<table><tr><td>cell</td></tr></table>')).toBe('cell');
  });

  it('drops style/script content entirely (not as text)', () => {
    expect(sanitizeRichTextHtml('<style>p{color:red}</style>ok')).toBe('ok');
    expect(sanitizeRichTextHtml('<iframe src="https://evil.example"><p>inner</p></iframe>x')).toBe('x');
  });

  it('drops comments, doctype and CDATA blocks (contents never become markup)', () => {
    expect(sanitizeRichTextHtml('a<!-- <script>alert(1)</script> -->b')).toBe('ab');
    expect(sanitizeRichTextHtml('<!DOCTYPE html><p>x</p>')).toBe('<p>x</p>');
    const cdata = sanitizeRichTextHtml('<![CDATA[<script>alert(1)</script>]]>y');
    expectInert(cdata);
    expect(cdata).not.toContain('<script');
    expect(cdata.endsWith('y')).toBe(true);
  });

  it('closes tags left unclosed (balanced output)', () => {
    expect(sanitizeRichTextHtml('<p>unclosed')).toBe('<p>unclosed</p>');
    expect(sanitizeRichTextHtml('<b><p>mix</b>')).toBe('<b><p>mix</p></b>');
  });

  it('handles unterminated tag soup as text (never executes)', () => {
    expectInert(sanitizeRichTextHtml('<p>hello <img src=x onerror=alert(1)'));
  });

  it('returns "" for non-string non-object input', () => {
    expect(sanitizeRichTextHtml(42)).toBe('');
    expect(sanitizeRichTextHtml(null)).toBe('');
    expect(sanitizeRichTextHtml(undefined)).toBe('');
  });

  it('handles empty richText doc objects (snapshot.test.ts fixture shape)', () => {
    expect(sanitizeRichTextHtml({ type: 'doc', content: [] })).toBe('');
  });
});

describe('sanitizeRichTextHtml — Tiptap JSON serialization', () => {
  it('serializes allowlisted nodes to HTML with escaped text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello <world> & friends' },
            { type: 'hardBreak' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
          ],
        },
      ],
    };
    expect(sanitizeRichTextHtml(doc)).toBe(
      '<p>Hello &lt;world&gt; &amp; friends<br><strong>bold</strong></p>',
    );
  });

  it('serializes lists, headings, blockquotes and code blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H' }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'i' }] }] }],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] },
      ],
    };
    const out = sanitizeRichTextHtml(doc);
    expect(out).toContain('<h3>H</h3>');
    expect(out).toContain('<ul><li><p>i</p></li></ul>');
    expect(out).toContain('<blockquote><p>q</p></blockquote>');
    expect(out).toContain('<pre><code>x = 1</code></pre>');
  });

  it('renders link marks only for safe hrefs (javascript: dropped)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'text', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }], text: 'bad' },
          { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://ok.example' } }], text: 'good' },
        ] },
      ],
    };
    const out = sanitizeRichTextHtml(doc);
    expect(out).toContain('<p>bad<a href="https://ok.example" rel="noopener noreferrer nofollow">good</a></p>');
    expectInert(out);
  });

  it('drops unknown marks and serializes unknown node types transparently', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'weirdCustom', content: [{ type: 'text', marks: [{ type: 'bgcolor', attrs: { color: 'red' } }], text: 'x' }] },
      ],
    };
    expect(sanitizeRichTextHtml(doc)).toBe('x');
  });

  it('never lets node text smuggle markup (Tiptap text with <script>)', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }] };
    expect(sanitizeRichTextHtml(doc)).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
});

// ---------------------------------------------------------------------------
// Save-path seam: sanitizeDocumentBodyRichText
// ---------------------------------------------------------------------------

describe('sanitizeDocumentBodyRichText (save path)', () => {
  it('rewrites richText props of every block into sanitized HTML strings', () => {
    const body = {
      schemaVersion: 1 as const,
      type: 'page' as const,
      blocks: [
        { id: 't1', kind: 'text', props: { richText: '<p>ok</p><script>alert(1)</script>' } },
        {
          id: 's1',
          kind: 'section',
          props: {},
          children: [
            { id: 't2', kind: 'text', props: { richText: '<img src=x onerror=alert(1)>' } },
          ],
        },
      ],
    };
    const out = sanitizeDocumentBodyRichText(body);
    expect(out.blocks?.[0]).toMatchObject({ props: { richText: '<p>ok</p>' } });
    expect((out.blocks?.[1] as { children?: { props?: { richText?: string } }[] }).children?.[0]?.props?.richText).toBe('');
  });

  it('normalizes legacy html/text props on text blocks too', () => {
    const body = {
      schemaVersion: 1 as const,
      type: 'page' as const,
      blocks: [
        { id: 't1', kind: 'text', props: { html: '<div onclick=alert(1)>hi</div>' } },
        { id: 't2', kind: 'text', props: { text: '<p>plain</p>' } },
      ],
    };
    const out = sanitizeDocumentBodyRichText(body);
    expect(out.blocks?.[0]).toMatchObject({ props: { html: 'hi' } });
    expect(out.blocks?.[1]).toMatchObject({ props: { text: '<p>plain</p>' } });
  });

  it('leaves non-text-block props.text alone (button labels etc.)', () => {
    const body = {
      schemaVersion: 1 as const,
      type: 'page' as const,
      blocks: [{ id: 'b1', kind: 'button', props: { text: 'not rich text' } }],
    };
    const out = sanitizeDocumentBodyRichText(body);
    expect(out.blocks?.[0]).toMatchObject({ props: { text: 'not rich text' } });
  });

  it('keeps Tiptap JSON round-trip as sanitized string (no raw objects stored)', () => {
    const body = {
      schemaVersion: 1 as const,
      type: 'form' as const,
      blocks: [{ id: 't1', kind: 'text', props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] } } }],
    };
    const out = sanitizeDocumentBodyRichText(body);
    expect(out.blocks?.[0]).toMatchObject({ props: { richText: '<p>A</p>' } });
  });
});

describe('entity helpers', () => {
  it('decodeEntities normalizes named + numeric + hex forms', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&#65;&#x42;')).toBe('<>&"AB');
  });

  it('decodeEntities never resurrects control characters (URL smuggling)', () => {
    // &#0; / &#1; map to U+FFFD so `jav#1;ascript:` can never normalize back.
    expect(decodeEntities('&#1;')).toBe('\uFFFD');
    expect(decodeEntities('&#x0;')).toBe('\uFFFD');
  });

  it('escapeHtmlText escapes the full dangerous set', () => {
    expect(escapeHtmlText('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

// ---------------------------------------------------------------------------
// Save-path integration: PATCH stores sanitized drafts
// ---------------------------------------------------------------------------

describe('save-path integration (crud PATCH sanitizes stored drafts)', () => {
  it('a block.update with an XSS payload is sanitized before storage', async () => {
    const { makePatchDocument, makeCreateDocument } = await import('../crud');
    const { createInMemoryCrudDocumentStore } = await import('../crud-inmemory');
    const { defaultDraftValidator } = await import('../validation');
    const { makeCtx } = await import('./helpers');
    const store = createInMemoryCrudDocumentStore();
    const deps = { documents: store.documents, validator: defaultDraftValidator };
    const ctx = makeCtx();
    const created = await makeCreateDocument(deps)(ctx, { type: 'page', title: 'XSS probe' });
    if (!created.ok) throw new Error(created.error.message);

    const patched = await makePatchDocument(deps)(ctx, created.value.id, {
      baseRev: 0,
      ops: [
        {
          op: 'block.insert',
          index: 0,
          block: {
            id: 'blk_xss0001',
            kind: 'text',
            props: { richText: '<p>safe</p><script>alert(1)</script><img src=x onerror=alert(1)>' },
          },
        },
      ],
    });
    if (!patched.ok) throw new Error(patched.error.message);
    const props = (patched.value.draft as { blocks: Array<{ props: { richText: string } }> }).blocks[0]!.props;
    expect(props.richText).toBe('<p>safe</p>');
    expect(props.richText).not.toContain('script');
    expect(props.richText).not.toContain('onerror');
  });
});
