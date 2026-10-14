// Unit spec — src/agent · the agent toolkit (filter/search/outline/expand/
// write/edit) over the canonical extractor.
//
// Feature: machines read the XHTML itself, not a markdown projection
//   Scenario: filter selects records by type, id, kind, tag, attribute and CSS selector
//   Scenario: audience filtering honours profile implies chains and !negation
//   Scenario: search returns addressable ids with a bounded context window
//   Scenario: attribute search reports addressable elements only
//   Scenario: outline collapses every block to one stable id
//   Scenario: expand is lazy — only the requested subtree is materialised
//   Scenario: markdown in becomes a normalised sem-md block
//   Scenario: a SemText fragment gains ids and a root, and validates
//   Scenario: edit replaces one block by id, byte-surgically
//   Scenario: locateBlock survives comments, raw text and nested same-tag elements

import { describe, it, expect } from 'vitest';
import { Window } from 'happy-dom';
import {
  extractRecordPairs,
  renderRecordsAsText
} from '../../src/extract/records.ts';
import {
  audienceProfiles,
  visibleTo,
  collectBlocks,
  outline,
  expand,
  filterBlocks,
  searchBlocks,
  serialize,
  serializeChildren,
  writeFragment,
  locateBlock,
  editBlock
} from '../../src/agent/index.ts';

function doc(html) {
  const win = new Window({ settings: { disableCSSFileLoading: true } });
  return new win.DOMParser().parseFromString('<!doctype html><html><body>' + html + '</body></html>', 'text/html');
}

function root(html) {
  return doc('<div class="sem-enhanced-document">' + html + '</div>').body;
}

const SAMPLE = `
  <h2 id="auth">Auth</h2>
  <p>Intro prose.</p>
  <div class="sem-audiences" id="profiles">
    <div class="sem-profile" id="reader"></div>
    <div class="sem-profile" id="operator" data-implies="reader"></div>
  </div>
  <div class="sem-facts" id="deck" data-kind="auth">
    <div class="sem-fact" id="f-jwt" data-kind="concept" data-tags="jwt,security">
      <div class="sem-statement">JWTs rotate per session</div>
      <div class="sem-conclusion">Short-lived access.</div>
    </div>
    <div class="sem-fact" id="f-oidc" data-tags="oidc">OIDC delegates identity to the provider.</div>
  </div>
  <div class="sem-note" id="n-op" data-audience="operator">Operators rotate first.</div>
  <div class="sem-note" id="n-all" data-audience="!operator">Everyone else asks an operator.</div>
  <div class="sem-note">An id-less note about token lifetimes.</div>
  <h3 id="rotate">Rotation</h3>
  <p>Rotate every fifteen minutes.</p>
`;

describe('audience resolution', () => {
  it('follows the implies chain transitively', () => {
    const profiles = audienceProfiles(root(SAMPLE));
    expect(profiles.get('operator').has('reader')).toBe(true);
    expect(profiles.get('reader').has('operator')).toBe(false);
  });

  it('filters by negation and implication, keeps unqualified content', () => {
    const profiles = audienceProfiles(root(SAMPLE));
    expect(visibleTo(null, 'operator', profiles)).toBe(true);
    expect(visibleTo('operator', 'operator', profiles)).toBe(true);
    expect(visibleTo('operator', 'reader', profiles)).toBe(false);
    expect(visibleTo('!operator', 'reader', profiles)).toBe(true);
    expect(visibleTo('!operator', 'operator', profiles)).toBe(false);
  });
});

describe('filter', () => {
  const tree = root(SAMPLE);

  it('selects by type, id, kind, tag and attribute', () => {
    expect(filterBlocks(tree, { type: 'fact' }).map((b) => b.id)).toEqual(['f-jwt', 'f-oidc']);
    expect(filterBlocks(tree, { id: 'f-jwt' }).length).toBe(1);
    expect(filterBlocks(tree, { kind: 'auth' }).map((b) => b.id)).toEqual(['deck']);
    expect(filterBlocks(tree, { tag: 'security' }).map((b) => b.id)).toEqual(['f-jwt']);
    expect(filterBlocks(tree, { attr: 'data-kind=concept' }).map((b) => b.id)).toEqual(['f-jwt']);
  });

  it('selects by CSS selector and combines criteria with AND', () => {
    expect(filterBlocks(tree, { selector: '.sem-fact' }).length).toBe(2);
    expect(filterBlocks(tree, { type: 'sem-fact', tag: 'oidc' }).map((b) => b.id)).toEqual(['f-oidc']);
  });

  it('filters by audience with implies + negation', () => {
    const ids = (profile) => filterBlocks(tree, { audience: profile }).map((b) => b.id);
    // unqualified content (the id-less note) is visible to every profile
    expect(ids('operator')).toEqual(['deck', 'f-jwt', 'f-oidc', 'n-op', 'x-note-an-id-less-note-about-to']);
    expect(ids('reader')).toEqual(['deck', 'f-jwt', 'f-oidc', 'n-all', 'x-note-an-id-less-note-about-to']);
  });

  it('throws a clear error on an invalid selector', () => {
    expect(() => filterBlocks(tree, { selector: '>>>broken' })).toThrow(/invalid selector/);
  });
});

describe('search', () => {
  const tree = root(SAMPLE);

  it('finds record text and reports id + field + context', () => {
    const hits = searchBlocks(tree, 'rotate');
    expect(hits.some((h) => h.id === 'f-jwt' && h.field === 'text')).toBe(true);
    expect(hits.some((h) => h.id === 'n-op' && /rotate/.test(h.context))).toBe(true);
    for (const h of hits) expect(h.context.length).toBeLessThan(120);
  });

  it('supports regex mode and field hits', () => {
    const hits = searchBlocks(tree, 'OIDC (delegates|identity)', { regex: true });
    expect(hits.map((h) => h.id)).toContain('f-oidc');
    expect(hits[0].match).toMatch(/delegates/);
  });

  it('attribute mode reports addressable elements with attribute context', () => {
    const hits = searchBlocks(tree, 'concept', { attrs: true });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({ id: 'f-jwt', field: 'data-kind' });
  });

  it('finds nothing for an empty query', () => {
    expect(searchBlocks(tree, '')).toEqual([]);
  });
});

describe('outline + expand', () => {
  const tree = root(SAMPLE);

  it('mints stable ids for id-less blocks, authored ids win', () => {
    const refs = collectBlocks(tree);
    const idless = refs.find((r) => r.id.startsWith('x-note-'));
    expect(idless.idSource).toBe('minted');
    expect(refs.find((r) => r.id === 'f-jwt').idSource).toBe('authored');
    // Same document, same ids.
    expect(collectBlocks(tree).map((r) => r.id)).toEqual(refs.map((r) => r.id));
  });

  it('builds a collapsed tree: sections and records, one line each', () => {
    const nodes = outline(tree);
    expect(nodes.map((n) => n.id)).toEqual(['auth']);
    const sec = nodes[0];
    expect(sec.blocks).toBeGreaterThan(3);
    expect(sec.children.map((n) => n.type)).toContain('sem-facts');
    const facts = sec.children.find((n) => n.type === 'sem-facts');
    expect(facts.children.map((n) => n.id)).toEqual(['f-jwt', 'f-oidc']);
    // Collapsed = summaries only: no field payloads in the outline.
    expect(JSON.stringify(facts)).not.toMatch(/"statement"|incorrectStatements/);
  });

  it('expands a section on demand (records + prose, lazily)', () => {
    const text = expand(tree, 'rotate');
    expect(text).toContain('Rotation');
    expect(text).toContain('Rotate every fifteen minutes.');
    expect(text).not.toContain('Short-lived access'); // earlier section stays out
  });

  it('expands a record block by minted id', () => {
    const refs = collectBlocks(tree);
    const minted = refs.find((r) => r.id.startsWith('x-note-'));
    const text = expand(tree, minted.id);
    expect(text).toContain('token lifetimes');
  });

  it('expands as xhtml and refuses unknown ids', () => {
    expect(expand(tree, 'f-oidc', 'xhtml')).toContain('sem-fact');
    expect(() => expand(tree, 'nope')).toThrow(/no block with id/);
  });
});

describe('serialize', () => {
  it('escapes text and attributes, self-closes voids', () => {
    const el = doc('<p title="a&amp;b">x &lt; y</p><hr>').body.children[0];
    expect(serialize(el)).toBe('<p title="a&amp;b">x &lt; y</p>');
    const wrap = root('<i>ok</i><br>').children[0];
    expect(serializeChildren(wrap)).toBe('<i>ok</i><br />');
  });
});

describe('write', () => {
  const parse = (src) => doc(src);

  it('wraps markdown into a normalised sem-md block', () => {
    const r = writeFragment(parse, '   | a | b |\n   | - | - |\n   | 1 | 2 |\n', { id: 'm-1', label: 'Table' });
    expect(r.xhtml).toBe('<sem-md id="m-1" label="Table">\n| a | b |\n| - | - |\n| 1 | 2 |\n</sem-md>');
    expect(r.id).toBe('m-1');
  });

  it('mints the id from the first markdown line when none is given', () => {
    const r = writeFragment(parse, 'Token lifetimes\n\ncome next.\n');
    expect(r.id).toBe('x-md-token-lifetimes');
    expect(r.xhtml).toContain('come next.');
  });

  it('emits the v0.4 class form on demand', () => {
    const r = writeFragment(parse, 'hello', { classForm: true, id: 'm-c' });
    expect(r.xhtml).toBe('<div class="sem-md" id="m-c">\nhello\n</div>');
  });

  it('canonicalises a SemText fragment: minted ids + root wrap', () => {
    const r = writeFragment(parse, '<div class="sem-note">Needs an id.</div>');
    expect(r.rootWrapped).toBe(true);
    expect(r.xhtml).toMatch(/^<sem-enhanced-document>/);
    expect(r.xhtml).toMatch(/<div class="sem-note" id="x-note-needs-an-id">/);
    expect(r.ids).toEqual(['x-note-needs-an-id']);
  });

  it('leaves authored ids and an existing root alone', () => {
    const src = '<sem-enhanced-document><div class="sem-note" id="kept">hi</div></sem-enhanced-document>';
    const r = writeFragment(parse, src, { format: 'semtext' });
    expect(r.rootWrapped).toBe(false);
    expect(r.xhtml).toContain('id="kept"');
    expect(r.ids).toEqual(['kept']);
  });

  it('the written fragment round-trips through extraction', () => {
    const r = writeFragment(parse, '<div class="sem-fact"><div class="sem-statement">a</div><div class="sem-conclusion">b</div></div>');
    const rec = extractRecordPairs(root(r.xhtml))[0].record;
    expect(rec.type).toBe('sem-fact');
    expect(rec.text).toBe('a :: b');
  });
});

describe('edit', () => {
  const SRC = [
    '<div class="sem-enhanced-document">',
    '<div class="sem-note" id="n-1">before <!-- keep -->comment</div>',
    '<script>if (a < b && c > d) { edit(); }</script>',
    '<div class="sem-facts" id="deck"><div class="sem-fact" id="f-1">one</div><div class="sem-fact" id="f-2">two</div></div>',
    '</div>'
  ].join('\n');

  it('locates a block span precisely', () => {
    const span = locateBlock(SRC, 'n-1');
    expect(SRC.slice(span.start, span.end)).toBe('<div class="sem-note" id="n-1">before <!-- keep -->comment</div>');
    expect(SRC.slice(span.innerStart, span.innerEnd)).toBe('before <!-- keep -->comment');
    expect(locateBlock(SRC, 'missing')).toBeNull();
  });

  it('locates spans inside raw script text and nested same-tag elements', () => {
    const span = locateBlock(SRC, 'f-2');
    expect(SRC.slice(span.innerStart, span.innerEnd)).toBe('two');
    // the id inside the script body must never match
    const tricky = '<script>const id = "x-1";</script><p id="x-1">real</p>';
    const t = locateBlock(tricky, 'x-1');
    expect(tricky.slice(t.start, t.end)).toBe('<p id="x-1">real</p>');
  });

  it('replaces one block without touching the surrounding bytes', () => {
    const next = editBlock(SRC, 'f-1', '<div class="sem-fact" id="f-1">ONE</div>', 'outer');
    expect(next).toContain('<div class="sem-fact" id="f-1">ONE</div>');
    expect(next).not.toContain('>one<');
    expect(next).toContain('<div class="sem-fact" id="f-2">two</div>');
    expect(next).toContain('if (a < b && c > d)');
    // Everything outside the span is byte-identical.
    const cut = (s) => s.replace('<div class="sem-fact" id="f-1">ONE</div>', '').replace('<div class="sem-fact" id="f-1">one</div>', '');
    expect(cut(next)).toBe(cut(SRC));
  });

  it('inner mode keeps the open tag (id + attributes survive)', () => {
    const next = editBlock(SRC, 'n-1', 'after');
    expect(next).toContain('<div class="sem-note" id="n-1">after</div>');
  });

  it('throws on an unknown id', () => {
    expect(() => editBlock(SRC, 'nope', 'x')).toThrow(/no element with id "nope"/);
  });
});

describe('integration with the canonical renderer', () => {
  it('filter output renders through renderRecordsAsText unchanged', () => {
    const blocks = filterBlocks(root(SAMPLE), { type: 'fact', tag: 'security' });
    const text = renderRecordsAsText(blocks.map((b) => b.record));
    expect(text).toContain('sem-fact (#f-jwt kind=concept tags=jwt|security)');
  });
});
