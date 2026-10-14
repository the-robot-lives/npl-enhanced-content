// @vitest-environment happy-dom
// Unit spec — safety module (EDITOR.md §8): URL gate, sanitizer, inert render.
import { describe, expect, it } from 'vitest';

import { isSafeUrl } from '../../src/editor/safety/url.js';
import { FORMATTING_TAGS, rebuildSubtree, sanitizeHtml } from '../../src/editor/safety/sanitize.js';
import type { SanitizeResult } from '../../src/editor/safety/sanitize.js';
import { renderAuthorInert } from '../../src/editor/safety/inert.js';
import { createDocument, parse } from '../../src/editor/model/document.js';

/** serialize the surviving sanitize nodes through a scratch document. */
function toHtml(r: SanitizeResult): string {
  const doc = createDocument('<scratch></scratch>');
  const scratch = doc.root.children[0]!;
  return r.nodes
    .map((n) => {
      const op = { type: 'insertNode', parent: scratch.id, index: doc.childrenOf(scratch.id).length, node: rebuildSubtree(doc, n) } as const;
      doc.apply(op);
      const inserted = doc.childrenOf(scratch.id)[doc.childrenOf(scratch.id).length - 1]!;
      return doc.serializeSubtree(inserted.id);
    })
    .join('');
}

describe('isSafeUrl (§8)', () => {
  it('allows empty, hash, http(s), mailto and relative values', () => {
    for (const v of ['', '#sec', 'https://a.dev/x', 'http://a.dev/', 'mailto:a@b.c', '/rel', 'page.html', '../up']) {
      expect(isSafeUrl(v).ok, v).toBe(true);
    }
  });
  it('rejects non-http schemes (script exec guard)', () => {
    for (const v of ['javascript:alert(1)', 'JaVaScRiPt:x', 'data:text/html,<b>', 'vbscript:x', 'file:///etc/passwd']) {
      expect(isSafeUrl(v).ok, v).toBe(false);
    }
  });
  it('allows data:image/* only for src-shaped attributes', () => {
    expect(isSafeUrl('data:image/png;base64,AAAA', { attr: 'src' }).ok).toBe(true);
    expect(isSafeUrl('data:image/png;base64,AAAA').ok).toBe(false);
    expect(isSafeUrl('data:image/svg+xml;base64,AAAA', { attr: 'href' }).ok).toBe(false);
  });
});

describe('sanitizeHtml (§8)', () => {
  it('drops script content and inline event handlers', () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>alert(1)</script>', { knownTags: new Set(['p']) });
    const html = toHtml(out);
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('alert');
  });
  it('keeps formatting tags and allowed attributes', () => {
    const out = sanitizeHtml('<b>bold</b> <em>x</em> <a href="https://a.dev">l</a>', { knownTags: new Set() });
    const html = toHtml(out);
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('href="https://a.dev"');
  });
  it('unwraps unknown tags, keeping their content', () => {
    const out = sanitizeHtml('<p>before<weird keep="x">mid</weird>after</p>', { knownTags: new Set() });
    const html = toHtml(out);
    expect(html).toContain('mid');
    expect(out.droppedTags).toBeGreaterThan(0);
    expect(html).not.toContain('<weird');
  });
  it('restricts class to sem-*/npl-* aliases', () => {
    const kept = toHtml(sanitizeHtml('<p class="sem-note npl-x">a</p>', { knownTags: new Set() }));
    expect(kept).toContain('sem-note');
    const dropped = toHtml(sanitizeHtml('<p class="evil">a</p>', { knownTags: new Set() }));
    expect(dropped).not.toContain('class');
  });
  it('drops javascript: hrefs during sanitization', () => {
    const out = toHtml(sanitizeHtml('<a href="javascript:alert(1)">x</a>', { knownTags: new Set() }));
    expect(out).not.toContain('javascript:');
  });
});

describe('renderAuthorInert (§2.4)', () => {
  it('renders authored content as inert nodes (no script execution)', () => {
    const frag = renderAuthorInert('<p id="p1">hello <b>world</b></p>', document);
    const p = frag.querySelector('#p1');
    expect(p?.textContent).toBe('hello world');
    expect(p?.querySelector('b')?.textContent).toBe('world');
  });
  it('preserves entity spelling via decoded text nodes', () => {
    const frag = renderAuthorInert('<p>AT&amp;T &lt;3</p>', document);
    expect(frag.querySelector('p')?.textContent).toBe('AT&T <3');
  });
  it('neutralizes scripts and embed srcs in preview', () => {
    const frag = renderAuthorInert('<script>bad()</script><iframe src="https://x.dev"></iframe>', document);
    expect(frag.querySelector('script')).toBeNull();
    const iframe = frag.querySelector('iframe');
    expect(iframe?.hasAttribute('src')).toBe(false);
  });
});

describe('rebuildSubtree (§2.3 adoption rule)', () => {
  it('rebuilds a parsed node with the target document factories (fresh ids)', () => {
    const src = parse('<sem-note variant="tip"><span class="sem-note-body">Hi</span></sem-note>');
    const elNode = src.root.children.find((c) => c.kind === 'element');
    expect(elNode).toBeDefined();
    const target = parse('<sem-doc></sem-doc>');
    const host = target.root.children[0]!;
    const rebuilt = rebuildSubtree(target, elNode!);
    expect(rebuilt.kind).toBe('element');
    expect(rebuilt.id).not.toBe(elNode!.id); // fresh id from the target doc counter
    target.apply({ type: 'insertNode', parent: host.id, index: 0, node: rebuilt });
    expect(target.serializeSubtree(rebuilt.id)).toBe('<sem-note variant="tip"><span class="sem-note-body">Hi</span></sem-note>');
  });
  it('FORMATTING_TAGS is the §8 set', () => {
    for (const t of ['b', 'i', 'em', 'strong', 'code', 'br']) expect(FORMATTING_TAGS.has(t)).toBe(true);
    expect(FORMATTING_TAGS.has('script')).toBe(false);
  });
});
