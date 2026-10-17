// Unit spec — editor model: lossless round trip
//
// Invariant (BRIEF §1): serialize(parse(x)) === x for every untouched
// document. Suites: every `example` in elements.json (49 tags), every spec
// HTML document, and fuzzed whitespace/comment/quote-style variants.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDocument, parse, tryParse } from '../../src/editor/model/document.js';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

const elementsJson: {
  tags: Array<{ name: string; example: string }>;
} = JSON.parse(readFileSync(`${REPO_ROOT}elements.json`, 'utf8'));

const specFiles = ['spec/conventions.html'];

describe('editor model round trip', () => {
  it.each(elementsJson.tags.map((t) => [t.name, t.example] as const))(
    '%s example survives parse → serialize byte-exactly',
    (_name, example) => {
      const doc = parse(example);
      expect(doc.serialize()).toBe(example);
    },
  );

  it.each(specFiles)('%s survives parse → serialize byte-exactly', (file) => {
    const src = readFileSync(`${REPO_ROOT}${file}`, 'utf8');
    const doc = parse(src);
    // first: byte-exact with zero edits
    expect(doc.serialize()).toBe(src);
  });

  it('the spec document round-trips repeatedly and stably', () => {
    const src = readFileSync(`${REPO_ROOT}spec/conventions.html`, 'utf8');
    const first = parse(src);
    const once = first.serialize();
    expect(once).toBe(src);
    const second = parse(once);
    expect(second.serialize()).toBe(once);
  });

  it('re-parsing serialized output yields identical trees (ids aside)', () => {
    const src = readFileSync(`${REPO_ROOT}spec/conventions.html`, 'utf8');
    const a = parse(src);
    const b = parse(a.serialize());
    expect(b.serialize()).toBe(src);
  });
});

describe('trivia preservation', () => {
  it('keeps attribute order, quote style, and whitespace verbatim', () => {
    const src = `<sem-note  variant='tip'   collapsed  data-x="a &amp; b" >hi</sem-note  >`;
    const doc = parse(src);
    expect(doc.serialize()).toBe(src);
    const el = doc.root.children[0];
    if (el.kind !== 'element') throw new Error('expected element');
    expect(el.attrs.map((a) => a.name)).toEqual(['variant', 'collapsed', 'data-x']);
    expect(el.attrs[0].quote).toBe("'");
    expect(el.attrs[1].value).toBeNull(); // bare
    expect(el.preGt).toBe(' ');
    expect(el.closeTag?.preGt).toBe('  ');
  });

  it('keeps authored entity spellings in untouched text', () => {
    const src = '<p>&amp; &#38; &sect; &hellip;</p>';
    const doc = parse(src);
    expect(doc.serialize()).toBe(src);
  });

  it('preserves comments, CDATA, PIs, and the doctype', () => {
    const src = [
      '<!doctype html>',
      '<!-- a comment with -- dashes... almost -->',
      '<sem-note>x<?xml version="1.0" encoding="utf-8"?><![CDATA[ raw <stuff> & things ]]></sem-note>',
    ].join('\n');
    const doc = parse(src);
    expect(doc.serialize()).toBe(src);
  });

  it('makes an EDITED comment body safe: -- and --> cannot survive emission', () => {
    const doc = parse('<!-- original --><p>x</p>');
    const walk = (n: { kind: string; children?: unknown[] }): { kind: string } | null => {
      if (n.kind === 'comment') return n;
      for (const c of (n.children ?? []) as { kind: string; children?: unknown[] }[]) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    const comment = walk(doc.root as never);
    if (!comment || comment.kind !== 'comment') throw new Error('expected a comment node');
    // An editor-typed body (the setText-for-comments path marks `edited`):
    // raw dashes would emit `-->` early or an invalid `--->`.
    (comment as unknown as { edited: boolean; value: string }).edited = true;
    (comment as unknown as { edited: boolean; value: string }).value = 'a -- b --> c -';
    const out = doc.serialize();
    expect(out).toContain('<!--a - - b - -> c - -->');
    const body = out.slice(out.indexOf('<!--') + 4, out.lastIndexOf('-->'));
    expect(body).not.toContain('--'); // well-formed: no double dash in the body
  });

  it('treats script/style bodies as raw text (no entity decode, no child parse)', () => {
    const src = '<script type="application/json">{"a": 1 < 2, "b": "x & y"}</script>';
    const doc = parse(src);
    expect(doc.serialize()).toBe(src);
    const script = doc.root.children[0];
    if (script.kind !== 'element') throw new Error('expected element');
    expect(script.children).toHaveLength(1);
    const body = script.children[0];
    if (body.kind !== 'text') throw new Error('expected text');
    expect(body.mode).toBe('raw');
    expect(body.value).toBe('{"a": 1 < 2, "b": "x & y"}');
    expect(script.children.every((c) => c.kind === 'text')).toBe(true);
  });

  it('keeps the authored self-closing form of void and empty elements', () => {
    const src = '<p>a<br>b<hr />c<img src="x.png" alt="y" /></p>';
    const doc = parse(src);
    expect(doc.serialize()).toBe(src);
  });
});

describe('fuzzed whitespace and comments round-trip', () => {
  const base = elementsJson.tags[1]?.example ?? '<sem-note>hi</sem-note>';

  const mutations: Array<(s: string) => string> = [
    (s) => s.replace(/></g, '>\n<'),
    (s) => s.replace(/></g, '>\n\n   <'),
    (s) => s.replace(/></g, '><!-- note --><'),
    (s) => s.replace(/></g, '><!--\n multi\n line\n--><'),
    (s) => s.replace(/="([a-z]*)"/g, "='$1'"),
    (s) => s.replace(/></g, '>\n<!-- c1 --><!-- c2 -->\n<'),
    (s) => `\n\t ${s} \n`,
  ];

  it.each(mutations.map((m, i) => [`mutation ${i}`, m] as const))(
    '%s of a real example round-trips',
    (_label, mutate) => {
      const src = mutate(base);
      const doc = parse(src);
      expect(doc.serialize()).toBe(src);
    },
  );

  it('random interleaved junk between elements still round-trips', () => {
    // deterministic pseudo-random: LCG so failures reproduce
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % n;
    };
    for (let round = 0; round < 50; round++) {
      const parts: string[] = [];
      const count = 1 + rand(4);
      for (let i = 0; i < count; i++) {
        const example = elementsJson.tags[rand(elementsJson.tags.length)].example;
        parts.push(example);
        if (rand(2) === 0) {
          parts.push(rand(2) === 0 ? '\n\n' : ` <!-- j${i} --> `);
        }
      }
      const src = parts.join('');
      const doc = parse(src);
      const out = doc.serialize();
      if (out !== src) {
        throw new Error(`round-trip mismatch on round ${round}:\n--- src ---\n${src}\n--- out ---\n${out}`);
      }
    }
  });
});

describe('tryParse', () => {
  it('reports ok for clean input', () => {
    const r = tryParse('<sem-note>fine</sem-note>');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.serialize()).toBe('<sem-note>fine</sem-note>');
  });

  it('never throws away the tree: failures carry a best-effort doc + ranged issues', () => {
    const r = tryParse('<sem-note>unclosed...');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.severity).toBe('error');
      expect(r.error.range.start).toBe(0);
      expect(r.doc.root.children.length).toBeGreaterThan(0);
    }
  });

  it('the last good tree stays usable after a failed re-parse (session pattern)', () => {
    const good = createDocument('<sem-note>good</sem-note>');
    const before = good.serialize();
    const bad = tryParse('<sem-note>oh no');
    expect(bad.ok).toBe(false);
    // the session keeps using the previous document instance
    expect(good.serialize()).toBe(before);
  });
});
