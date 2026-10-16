// Unit spec — editor model: malformed input → structured, ranged issues
//
// BRIEF §2: parsing never throws; problems come back as ParseIssues with
// ranges; severity 'error' flips tryParse to ok:false; the tree is always
// best-effort so the session never loses the last good parse.

import { describe, expect, it } from 'vitest';
import { parse, tryParse } from '../../src/editor/model/document.js';

/** [source, expected issues as code/severity@start-end] */
const CASES: Array<[string, string[]]> = [
  ['<p>unclosed', ['unclosed-tag/error@0-11']],
  ['<p>a</div>', ['stray-close/error@4-10', 'unclosed-tag/error@0-10']],
  ['a</div>b', ['stray-close/error@1-7']],
  ['<p "bad">x</p>', ['bad-attr/warning@3-4', 'bad-attr/warning@7-8']],
  ['<p>x &bogus; y</p>', ['unknown-entity/warning@5-12']],
  ['<p>a < b</p>', ['invalid-char/warning@5-6']],
  ['<div><p>x</div></p>', ['mismatched-close/error@5-9', 'stray-close/error@15-19']],
  ['<!doctype', ['unexpected-eof/error@0-9']],
  ['<li>one<li>two', ['implicit-nesting/warning@4-4', 'unclosed-tag/error@7-14']],
];

describe('structured parse issues', () => {
  it.each(CASES)('%s reports exactly the expected issues', (src, expected) => {
    const doc = parse(src);
    const got = doc.issues.map(
      (i) => `${i.code}/${i.severity}@${i.range.start}-${i.range.end}`,
    );
    expect(got).toEqual(expected);
  });

  it('every issue carries a human message and an in-bounds range', () => {
    for (const [src] of CASES) {
      const doc = parse(src);
      expect(doc.issues.length).toBeGreaterThan(0);
      for (const issue of doc.issues) {
        expect(issue.message.length).toBeGreaterThan(0);
        expect(issue.range.start).toBeGreaterThanOrEqual(0);
        expect(issue.range.end).toBeLessThanOrEqual(src.length);
        expect(issue.range.start).toBeLessThanOrEqual(issue.range.end);
        expect(['error', 'warning']).toContain(issue.severity);
      }
    }
  });

  it('clean input yields an empty issue list', () => {
    expect(parse('<sem-note variant="tip">fine &amp; dandy</sem-note>').issues).toEqual([]);
  });

  it('auto-closing produces well-formed output that is stable on re-parse', () => {
    const doc = parse('<li>one<li>two');
    // recovery canonicalizes: implicit closes become real close tags
    expect(doc.serialize()).toBe('<li>one</li><li>two</li>');
    const items = doc.root.children.filter((c) => c.kind === 'element');
    expect(items).toHaveLength(2); // implicit nesting split them
    // and from there the tree is byte-stable
    expect(parse(doc.serialize()).serialize()).toBe('<li>one</li><li>two</li>');
  });

  it('recovery keeps salvageable content around the damage', () => {
    const doc = parse('a</div>b');
    expect(doc.textOf(doc.root.id)).toContain('a');
    expect(doc.textOf(doc.root.id)).toContain('b');
  });
});

describe('parse never throws', () => {
  it('survives every truncation of a valid document', () => {
    const src = '<sem-note variant="tip" data-x="1">Hi &amp; bye<!-- c --></sem-note>';
    for (let cut = 0; cut <= src.length; cut++) {
      expect(() => parse(src.slice(0, cut))).not.toThrow();
    }
  });

  it('survives hostile tag soup', () => {
    const soup = [
      '<<<<>>>',
      '<p</p>',
      '</></>',
      '<p =">x</p>',
      '<!---->',
      '<![CDATA[ never closed',
      '<?pi never closed',
      '<p>&#xZZ; &#999999999;</p>',
      '<script>never closed',
      '<p a="1" a="2">dup</p>',
    ];
    for (const src of soup) {
      expect(() => parse(src)).not.toThrow();
    }
  });
});

describe('tryParse verdicts', () => {
  it('ok:true when only warnings fire (unknown entity, bare attr damage)', () => {
    const r = tryParse('<p>x &bogus; y</p>');
    expect(r.ok).toBe(true);
  });

  it('ok:false when any severity:error issue fires', () => {
    const r = tryParse('<p>unclosed');
    expect(r.ok).toBe(false);
  });

  it('failures still expose the best-effort tree and issues', () => {
    const r = tryParse('<p>unclosed');
    if (r.ok) throw new Error('expected failure');
    expect(r.doc.issues.length).toBeGreaterThan(0);
    expect(r.doc.root.children.length).toBe(1); // the <p> was salvaged
    expect(r.error.code).toBe('unclosed-tag');
  });
});
