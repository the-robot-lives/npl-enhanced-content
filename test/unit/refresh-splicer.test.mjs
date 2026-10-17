/**
 * Unit tests for the pure cache-region splicer (semtext-refresh, Phase 7).
 *
 * Contract under test (src/tools/cache-splicer.js):
 *   - marker-only rewriting: prose bytes outside markers are bit-identical
 *   - idempotency: applying the same refresh twice yields the same bytes
 *   - timestamp normalization: a last-refreshed-only change is NOT drift
 *   - seed insertion: markers wrap the authored element, end marker right
 *     after the element's authored snapshot content
 *   - malformed markers: start-without-end, orphan end, nested start,
 *     unknown tag, duplicate key — each an error, never a crash
 */
import { describe, it, expect } from 'vitest';
import {
  parseCacheRegions,
  applyCacheRegions,
  normalizeTimestamps,
  seedCacheRegions,
  findAuthoredElement,
  findAuthoredElements,
  applySnapshot,
  parseOpenTagAttrs,
} from '../../src/tools/cache-splicer.js';

const KNOWN = new Set(['agent-kit-issue', 'semext-annotate']);

const DOC = `<!doctype html>
<body>
<p>before   prose 🧵</p>
<!-- semtext:cache:start agent-kit-issue AKIT-001 -->
<agent-kit-issue key="AKIT-001" last-refreshed="2026-10-17T09:24:00Z">
  <agent-kit-title>t</agent-kit-title>
</agent-kit-issue>
<!-- semtext:cache:end -->
<p>between</p>
<!-- semtext:cache:start semext-annotate ann-1 -->
<semext-annotate key="ann-1" site="noizu" page="/x"></semext-annotate>
<!-- semtext:cache:end -->
<p>after</p>
</body>`;

const describeRegion = (r) => `${r.tag} ${r.key}`;

describe('parseCacheRegions', () => {
  it('finds both regions with exact tag, key, body and offsets', () => {
    const { regions, errors } = parseCacheRegions(DOC, KNOWN);
    expect(errors).toEqual([]);
    expect(regions.map(describeRegion)).toEqual(['agent-kit-issue AKIT-001', 'semext-annotate ann-1']);
    const [first] = regions;
    expect(first.body).toContain('<agent-kit-issue');
    expect(first.body).not.toContain('semtext:cache');
    // offsets are live: slicing the source reproduces the markers verbatim
    expect(DOC.slice(first.startOffset, first.endOffset)).toBe(
      first.startMarker + first.body + first.endMarker,
    );
  });

  it('a file with no markers has zero regions and zero errors', () => {
    const { regions, errors } = parseCacheRegions('<p>plain prose</p>', KNOWN);
    expect(regions).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('start without end is an unterminated-region error', () => {
    const { errors } = parseCacheRegions('<!-- semtext:cache:start agent-kit-issue k1 -->\n<body>', KNOWN);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/no matching cache:end/);
  });

  it('end without start is an orphan-marker error', () => {
    const { errors } = parseCacheRegions('<p>x</p>\n<!-- semtext:cache:end -->\n', KNOWN);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/without a matching cache:start/);
  });

  it('a start nested inside a region is an error', () => {
    const src = `<!-- semtext:cache:start agent-kit-issue a -->
<!-- semtext:cache:start agent-kit-issue b -->
<!-- semtext:cache:end -->`;
    const { errors } = parseCacheRegions(src, KNOWN);
    expect(errors.some((e) => /nested cache start/.test(e.message))).toBe(true);
  });

  it('an unknown tag is a vocabulary error (when knownTags given)', () => {
    const src = '<!-- semtext:cache:start not-a-tag k --><x></x><!-- semtext:cache:end -->';
    expect(parseCacheRegions(src, KNOWN).errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/unknown vocabulary tag/),
    ]);
    // and a silent pass when the vocabulary check is off
    expect(parseCacheRegions(src).errors).toEqual([]);
  });

  it('a duplicate tag+key pair in one file is an error', () => {
    const src = `<!-- semtext:cache:start agent-kit-issue k1 --><a></a><!-- semtext:cache:end -->
<!-- semtext:cache:start agent-kit-issue k1 --><b></b><!-- semtext:cache:end -->`;
    const { errors } = parseCacheRegions(src, KNOWN);
    expect(errors.map((e) => e.message)).toEqual([expect.stringMatching(/duplicate cache region/)]);
  });
});

describe('applyCacheRegions', () => {
  it('rewrites ONLY the marked region; prose bytes outside are bit-identical', () => {
    const oldBody = DOC.match(
      /<!-- semtext:cache:start agent-kit-issue AKIT-001 -->\n([\s\S]*?)\n<!-- semtext:cache:end -->/,
    )[1];
    const out = applyCacheRegions(DOC, new Map([['agent-kit-issue AKIT-001', oldBody.replace('>t<', '>fresh<')]]));
    const [r1, r2] = parseCacheRegions(DOC).regions;
    // every byte before region 1 is untouched
    expect(out.slice(0, r1.startOffset)).toBe(DOC.slice(0, r1.startOffset));
    // every byte after region 1 is untouched too — offset taken from the
    // OUTPUT, since a body of different length shifts the absolute offsets
    const [o1] = parseCacheRegions(out).regions;
    expect(out.slice(o1.endOffset)).toBe(DOC.slice(r1.endOffset));
    // region 2 body untouched even though region 1 changed
    expect(parseCacheRegions(out).regions[1].body).toBe(r2.body);
  });

  it('markers themselves are preserved verbatim (no re-serialization)', () => {
    const src = '<!--semtext:cache:start  semext-annotate   k -->\nB\n<!-- semtext:cache:end -->';
    const out = applyCacheRegions(src, new Map([['semext-annotate k', '\nNEW\n']]));
    expect(out).toBe('<!--semtext:cache:start  semext-annotate   k -->\nNEW\n<!-- semtext:cache:end -->');
  });

  it('is idempotent: same input twice gives the same output', () => {
    const update = (region) => (region.tag === 'agent-kit-issue' ? region.body.replace('09:24:00Z', '10:00:00Z') : null);
    const once = applyCacheRegions(DOC, update);
    const twice = applyCacheRegions(once, update);
    expect(twice).toBe(once);
  });

  it('an update equal to the current body reproduces the input exactly', () => {
    const identity = (region) => region.body;
    expect(applyCacheRegions(DOC, identity)).toBe(DOC);
  });

  it('a null/absent update leaves the region alone', () => {
    const out = applyCacheRegions(DOC, new Map());
    expect(out).toBe(DOC);
  });
});

describe('normalizeTimestamps', () => {
  it('blanks last-refreshed values and nothing else', () => {
    const a = '<agent-kit-issue last-refreshed="2026-10-17T09:24:00Z" key="k">';
    const b = '<agent-kit-issue last-refreshed="2026-10-18T23:59:59Z" key="k">';
    expect(normalizeTimestamps(a)).toBe(normalizeTimestamps(b));
    expect(normalizeTimestamps(a)).toContain('key="k"');
    expect(normalizeTimestamps(a)).toContain('<timestamp>');
  });

  it('timestamp-only rewrites are not drift; real changes still are', () => {
    const [region] = parseCacheRegions(DOC, KNOWN).regions;
    const restamped = region.body.replace('2026-10-17T09:24:00Z', '2026-10-18T00:00:00Z');
    expect(normalizeTimestamps(restamped)).toBe(normalizeTimestamps(region.body));
    const changed = region.body.replace('<agent-kit-title>t</agent-kit-title>', '<agent-kit-title>new</agent-kit-title>');
    expect(normalizeTimestamps(changed)).not.toBe(normalizeTimestamps(region.body));
  });
});

describe('seedCacheRegions', () => {
  const UNMARKED = `<body>
  <p>prose</p>
  <agent-kit-issue key="AKIT-9" id="t9">
    <agent-kit-title>seeded</agent-kit-title>
  </agent-kit-issue>
  <p>after</p>
</body>`;

  it('wraps the authored element; end marker lands after the snapshot content', () => {
    const { text, errors } = seedCacheRegions(UNMARKED, [{ tag: 'agent-kit-issue', key: 'AKIT-9' }], KNOWN);
    expect(errors).toEqual([]);
    const { regions } = parseCacheRegions(text, KNOWN);
    expect(regions.map(describeRegion)).toEqual(['agent-kit-issue AKIT-9']);
    const [r] = regions;
    // the region body IS the authored snapshot, byte-identical
    expect(r.body).toContain('<agent-kit-title>seeded</agent-kit-title>');
    // the end marker sits directly after the element's closing tag
    expect(r.body.trimEnd().endsWith('</agent-kit-issue>')).toBe(true);
    // markers share the element's indent, each on its own line
    expect(text).toContain('  <!-- semtext:cache:start agent-kit-issue AKIT-9 -->\n  <agent-kit-issue');
    expect(text).toContain('  </agent-kit-issue>\n  <!-- semtext:cache:end -->');
    // surrounding prose untouched
    expect(text).toContain('<p>prose</p>');
    expect(text).toContain('<p>after</p>');
  });

  it('is idempotent: seeding an already-marked file changes nothing', () => {
    const once = seedCacheRegions(UNMARKED, [{ tag: 'agent-kit-issue', key: 'AKIT-9' }], KNOWN).text;
    const twice = seedCacheRegions(once, [{ tag: 'agent-kit-issue', key: 'AKIT-9' }], KNOWN);
    expect(twice.text).toBe(once);
    expect(twice.errors).toEqual([]);
  });

  it('falls back to the id attribute when key is absent', () => {
    const src = '<semext-annotate id="ann-7">x</semext-annotate>';
    const { text, errors } = seedCacheRegions(src, [{ tag: 'semext-annotate', key: 'ann-7' }], KNOWN);
    expect(errors).toEqual([]);
    expect(parseCacheRegions(text, KNOWN).regions.map(describeRegion)).toEqual(['semext-annotate ann-7']);
  });

  it('a missing element is an error entry, not a crash', () => {
    const { errors, text } = seedCacheRegions(UNMARKED, [{ tag: 'agent-kit-issue', key: 'NOPE' }], KNOWN);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/no authored <agent-kit-issue>/);
    expect(text).toBe(UNMARKED);
  });

  it('an unknown seed tag is a vocabulary error', () => {
    const { errors } = seedCacheRegions(UNMARKED, [{ tag: 'not-a-tag', key: 'k' }], KNOWN);
    expect(errors[0].message).toMatch(/unknown vocabulary tag/);
  });

  it('an element already inside a region is left alone', () => {
    const marked = `<!-- semtext:cache:start agent-kit-issue AKIT-9 -->${UNMARKED.match(/<agent-kit-issue[\s\S]*<\/agent-kit-issue>/)[0]}<!-- semtext:cache:end -->`;
    const { text } = seedCacheRegions(marked, [{ tag: 'agent-kit-issue', key: 'AKIT-9' }], KNOWN);
    expect(text).toBe(marked);
  });
});

describe('findAuthoredElement(s)', () => {
  it('honours same-name nesting when finding the closing offset', () => {
    const src = '<semext-annotate key="a"><semext-annotate key="inner"></semext-annotate></semext-annotate>';
    const el = findAuthoredElement(src, 'semext-annotate', 'a');
    expect(src.slice(el.openIndex, el.closeEnd).endsWith('</semext-annotate>')).toBe(true);
    expect(src.slice(el.openIndex, el.closeEnd)).toBe(src); // the OUTER element spans everything
  });

  it('findAuthoredElements lists every element in document order', () => {
    const src = '<semext-annotate key="a"></semext-annotate><semext-annotate key="b"></semext-annotate>';
    expect(findAuthoredElements(src, 'semext-annotate').map((e) => e.attrs.key)).toEqual(['a', 'b']);
  });

  it('self-closing elements count as complete', () => {
    const src = '<semext-annotate key="a"/>';
    const els = findAuthoredElements(src, 'semext-annotate');
    expect(els).toHaveLength(1);
    expect(els[0].closeEnd).toBe(src.length);
  });
});

describe('applySnapshot + parseOpenTagAttrs', () => {
  it('reads region-head attributes', () => {
    expect(parseOpenTagAttrs('<semext-annotate site="noizu" page="/docs" data-x>a</semext-annotate>')).toEqual({
      site: 'noizu',
      page: '/docs',
      'data-x': '',
    });
  });

  it('replaces the JSON child and stamps last-refreshed in one pass', () => {
    const body = '<agent-kit-issue key="k" last-refreshed="2026-01-01T00:00:00Z">\n  <agent-kit-title>t</agent-kit-title>\n</agent-kit-issue>';
    const out = applySnapshot(body, { state: 'done' }, '2026-10-18T00:00:00Z');
    expect(out).toContain('last-refreshed="2026-10-18T00:00:00Z"');
    expect(out).toContain('"state": "done"');
    expect(out).toContain('<agent-kit-title>t</agent-kit-title>'); // authored children preserved
  });

  it('inserts a JSON child when the body has none, and is idempotent', () => {
    const body = '<semext-annotate key="k" last-refreshed="2026-01-01T00:00:00Z"></semext-annotate>';
    const once = applySnapshot(body, { threads: [] }, '2026-10-18T00:00:00Z');
    expect(once).toContain('<script type="application/json">');
    const twice = applySnapshot(once, { threads: [] }, '2026-10-18T00:00:00Z');
    expect((twice.match(/<script/g) || []).length).toBe(1);
    expect(twice).toBe(once);
  });
});
