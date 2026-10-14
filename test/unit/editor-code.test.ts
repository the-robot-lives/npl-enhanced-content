// @vitest-environment happy-dom
// Unit spec — editor code view: `<sem-editor-code>` + the code highlighter
// (EDITOR.md §6, §10).
//
// Feature: the code pane edits raw XHTML over a live highlight layer without
// ever parsing source as HTML
//   Scenario: the tokenizer colours every construct with source offsets
//   Scenario: every non-newline character lands in exactly one token
//   Scenario: parse issues flag tokens, gutter lines and the alert strip
//   Scenario: a clean parse adopts the tree; a broken parse keeps the last
//     good tree and flags the pane until the source recovers
//   Scenario: input re-parses debounced; "Re-parse now" parses immediately
//   Scenario: Tab indents and Shift+Tab outdents without leaving the pane
//   Scenario: selection sync is one-way-on-typing and emits DocPos pairs
//   Scenario: strip jump buttons move the caret to the issue offset
//   Scenario: the highlight layer is inert — spans and text only
//   Scenario: a 10k-line document highlights interactively

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import '../../src/editor/code/sem-editor-code.js';
import { SemEditorCode } from '../../src/editor/code/sem-editor-code.js';
import {
  highlight,
  markErrors,
  lineIndexOf,
  lineColForOffset,
} from '../../src/editor/code/highlight.js';
import { renderHighlight } from '../../src/editor/code/render.js';
import type {
  CodeViewHost,
  CodeSelection,
  HighlightResult,
} from '../../src/editor/code/types.js';
import type { ParseIssue, ParseResult } from '../../src/editor/model/types.js';

const REPO_ROOT = process.cwd(); // vitest always runs from the package root
const elementsJson: { tags: Array<{ name: string; example: string }> } = JSON.parse(
  readFileSync(`${REPO_ROOT}/elements.json`, 'utf8'),
);

/** Flatten a highlight result to kind sequence. */
const kindsOf = (r: HighlightResult): string[] =>
  r.lines.flatMap((l) => l.tokens).map((t) => t.kind);

/** Flatten a highlight result to the source text each token covers. */
const spansOf = (r: HighlightResult, source: string): string[] =>
  r.lines.flatMap((l) => l.tokens).map((t) => source.slice(t.start, t.end));

const issue = (start: number, end: number, severity: 'error' | 'warning' = 'error'): ParseIssue => ({
  code: 'test',
  severity,
  message: 'bad',
  range: { start, end },
});

/** Deterministic LCG — no Math.random anywhere (reproducible suites). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Totality: tokens are disjoint, ordered, and the only gaps are newlines. */
function expectTotalCoverage(source: string): void {
  const r = highlight(source);
  const frags = r.lines
    .flatMap((l) => l.tokens)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let cur = 0;
  for (const t of frags) {
    expect(t.start, `token overlaps at ${t.start}`).toBeGreaterThanOrEqual(cur);
    expect(t.end, `empty token at ${t.start}`).toBeGreaterThan(t.start);
    for (let p = cur; p < t.start; p++) expect(source[p], `gap at ${p}`).toBe('\n');
    cur = Math.max(cur, t.end);
  }
  for (let p = cur; p < source.length; p++) expect(source[p], `tail gap at ${p}`).toBe('\n');
}

/** Flush happy-dom's rAF (real setImmediate, bound at module load — fake
 *  timers never touch it). setImmediate stays real, so this flushes under
 *  vi.useFakeTimers too. */
const flushRaf = async (): Promise<void> => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

interface FakeHost {
  tryParse: ReturnType<typeof vi.fn>;
  adopt: ReturnType<typeof vi.fn>;
  offsetToPos: ReturnType<typeof vi.fn>;
  onCodeSelection: ReturnType<typeof vi.fn>;
  announce: ReturnType<typeof vi.fn>;
}

/** Element + scripted host. tryParse fails when the source contains FAIL,
 *  warns when it contains WARN, succeeds cleanly otherwise. */
async function makePane(source = ''): Promise<{
  el: SemEditorCode;
  host: FakeHost;
  ta: HTMLTextAreaElement;
  pre: HTMLElement;
  gutter: HTMLElement;
  strip: HTMLElement;
  scroller: HTMLElement;
}> {
  const el = document.createElement('sem-editor-code') as SemEditorCode;
  const doc = { marker: true };
  const host: FakeHost = {
    tryParse: vi.fn((src: string): ParseResult => {
      if (src.includes('FAIL')) {
        return {
          ok: false,
          doc,
          issues: [issue(2, 6)],
          error: { message: 'bad', range: { start: 2, end: 6 } },
        } as unknown as ParseResult;
      }
      const issues = src.includes('WARN') ? [issue(0, 1, 'warning')] : [];
      return { ok: true, doc, issues } as unknown as ParseResult;
    }),
    adopt: vi.fn(),
    offsetToPos: vi.fn((offset: number) => ({ node: null, offset })),
    onCodeSelection: vi.fn(),
    announce: vi.fn(),
  };
  el.host = host as unknown as CodeViewHost;
  el.source = source;
  document.body.appendChild(el);
  await el.updateComplete;
  const ta = el.querySelector('textarea') as HTMLTextAreaElement;
  return {
    el,
    host,
    ta,
    pre: el.querySelector('pre') as HTMLElement,
    gutter: el.querySelector('.sem-ed-code-gutter') as HTMLElement,
    strip: el.querySelector('.sem-ed-code-strip') as HTMLElement,
    scroller: el.querySelector('.sem-ed-code-scroll') as HTMLElement,
  };
}

const type = (ta: HTMLTextAreaElement, value: string): void => {
  ta.value = value;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('code highlighter — token goldens', () => {
  it('colours a whole comment as one comment token', () => {
    const src = '<!-- hi -->';
    const r = highlight(src);
    expect(kindsOf(r)).toEqual(['comment']);
    expect(spansOf(r, src)).toEqual([src]);
  });

  it('colours a multi-line comment across the cut', () => {
    const src = '<p>a</p>\n<!-- one\ntwo -->\n<p>b</p>';
    const r = highlight(src);
    const commentLines = r.lines.filter((l) => l.tokens.some((t) => t.kind === 'comment'));
    expect(commentLines.map((l) => l.index)).toEqual([1, 2]);
    expect(expectTotalCoverage(src), 'coverage holds').toBeUndefined();
  });

  it('colours doctype, processing instruction and CDATA as doctype-kind', () => {
    expect(kindsOf(highlight('<!DOCTYPE html>'))).toEqual(['doctype']);
    expect(kindsOf(highlight('<?php echo 1; ?>'))).toEqual(['doctype']);
    expect(kindsOf(highlight('<![CDATA[x < y]]>'))).toEqual(['doctype']);
  });

  it('splits a tag into tag/attr/value with plain punctuation', () => {
    const src = '<a href="x" disabled>';
    const r = highlight(src);
    expect(kindsOf(r)).toEqual(['tag', 'text', 'attr', 'text', 'value', 'text', 'attr', 'text']);
    expect(spansOf(r, src)).toEqual(['<a', ' ', 'href', '=', '"x"', ' ', 'disabled', '>']);
  });

  it('handles unquoted and single-quoted values plus self-close', () => {
    // a bare `/` joins an unquoted value (terminal-scanner rule); only a
    // tag with no attributes hits the `/>` branch
    expect(spansOf(highlight('<a href=unq/>'), '<a href=unq/>')).toEqual([
      '<a',
      ' ',
      'href',
      '=',
      'unq/',
      '>',
    ]);
    expect(kindsOf(highlight("<a href='s'>"))).toContain('value');
  });

  it('colours entities and keeps a bare & as text', () => {
    const src = 'a&amp;b &nope';
    const r = highlight(src);
    expect(kindsOf(r)).toEqual(['text', 'entity', 'text']);
    expect(spansOf(r, src)[1]).toBe('&amp;');
    expect(spansOf(r, src)[2]).toBe('b &nope');
  });

  it('treats raw-text bodies as opaque text until the case-insensitive close', () => {
    const src = '<SCRIPT>x</p>; y</SCRIPT>';
    const r = highlight(src);
    // tag(<SCRIPT) text(>) text(body) tag(</SCRIPT) text(>)
    expect(kindsOf(r)).toEqual(['tag', 'text', 'text', 'tag', 'text']);
    expect(spansOf(r, src)[2]).toBe('x</p>; y');
    // self-closing script does not swallow the rest
    expect(kindsOf(highlight('<script/>tail'))).toEqual(['tag', 'text', 'text']);
  });

  it('colours a multi-line tag (attr on the next line)', () => {
    const src = '<div\nclass="x">';
    const r = highlight(src);
    const kinds = kindsOf(r);
    expect(kinds).toContain('tag');
    expect(kinds).toContain('attr');
    expect(kinds).toContain('value');
  });

  it('emits a plain text char for `<` that opens nothing', () => {
    expect(kindsOf(highlight('<3'))).toEqual(['text', 'text']);
    expect(kindsOf(highlight('<>'))).toEqual(['text', 'text']);
    expect(kindsOf(highlight('<'))).toEqual(['text']);
  });

  it('runs unterminated constructs to EOF', () => {
    expect(kindsOf(highlight('<!-- open'))).toEqual(['comment']);
    expect(kindsOf(highlight('<div class="x'))).toEqual(['tag', 'text', 'attr', 'text', 'value']);
    expect(kindsOf(highlight('<![CDATA[never'))).toEqual(['doctype']);
  });
});

describe('code highlighter — totality', () => {
  it('covers every example in elements.json exactly', () => {
    for (const { name, example } of elementsJson.tags) {
      expect(() => expectTotalCoverage(example), name).not.toThrow();
      // and the assertion itself held: re-run silently would be redundant —
      // expectTotalCoverage throws on any gap/overlap.
    }
  });

  it('covers fuzzed concatenations of every construct (seeded)', () => {
    const pieces = [
      '<p class="x">', '</p>', 'text &amp; more', '<!-- c -->', '<!-- open',
      '<br/>', '<!DOCTYPE html>', '<?pi?>', '<![CDATA[d]]>', '&amp;', '&nope',
      '<', '<3', '\n', ' ', '<script>var a="</p>";</script>', '<style>.a{}</style>',
      '</', '<a href=unq>', '=', '"', 'a"', '<div', '</p >', '<span data-x=1',
    ];
    for (const seed of [1, 42, 1337]) {
      const rnd = lcg(seed);
      for (let i = 0; i < 150; i++) {
        const n = 1 + Math.floor(rnd() * 40);
        const parts: string[] = [];
        for (let j = 0; j < n; j++) parts.push(pieces[Math.floor(rnd() * pieces.length)]);
        expectTotalCoverage(parts.join(''));
      }
    }
  });
});

describe('code highlighter — line/offset math', () => {
  const r = highlight('ab\ncd\nef');
  it('finds the line of an offset (binary search, clamped)', () => {
    expect(lineIndexOf(r, 0)).toBe(0);
    expect(lineIndexOf(r, 2)).toBe(0);
    expect(lineIndexOf(r, 3)).toBe(1);
    expect(lineIndexOf(r, 6)).toBe(2);
    expect(lineIndexOf(r, 999)).toBe(2);
    expect(lineIndexOf(r, -5)).toBe(0);
  });

  it('reports 1-based line/col', () => {
    expect(lineColForOffset(r, 0)).toEqual({ line: 1, col: 1 });
    expect(lineColForOffset(r, 3)).toEqual({ line: 2, col: 1 });
    expect(lineColForOffset(r, 5)).toEqual({ line: 2, col: 3 });
  });
});

describe('code highlighter — error marking', () => {
  it('flags tokens and gutter lines intersecting an issue, idempotently', () => {
    const src = '<p>ok</p>\n<p>bad</p>';
    const r = highlight(src);
    const issues = [issue(12, 15)];
    markErrors(r, issues);
    const flagged = r.lines.flatMap((l) => l.tokens).filter((t) => t.err);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((t) => t.start < 15 && t.end > 12)).toBe(true);
    // flagged tokens live only on the error line
    const errLine = r.lines.find((l) => l.tokens.some((t) => t.err));
    expect(errLine?.index).toBe(1);
    markErrors(r, issues);
    expect(r.lines.flatMap((l) => l.tokens).filter((t) => t.err).length).toBe(flagged.length);
    markErrors(r, []);
    expect(r.lines.flatMap((l) => l.tokens).every((t) => !t.err)).toBe(true);
  });
});

describe('render — highlight layer', () => {
  it('emits spans and text nodes only — never parsed HTML', () => {
    const src = '<p onclick="javascript:alert(1)">x<script>alert(1)</script></p>';
    const pre = document.createElement('pre');
    renderHighlight(pre, highlight(src), src);
    const all = pre.querySelectorAll('*');
    expect(all.length).toBeGreaterThan(0);
    for (const node of all) expect(node.tagName).toBe('SPAN');
    expect(pre.querySelector('script')).toBeNull();
    expect(pre.innerHTML.toLowerCase()).not.toContain('<script');
    expect(pre.querySelectorAll('.sem-ed-tok-tag').length).toBeGreaterThan(0);
  });
});

describe('<sem-editor-code> — parse lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('parses debounced on input; adopts only on ok; announces', async () => {
    const { el, host, ta } = await makePane();
    el.reparseNow();
    await flushRaf();
    expect(host.tryParse).toHaveBeenCalled();
    expect(host.adopt).toHaveBeenCalledTimes(1);

    type(ta, '<p>hi</p>');
    expect(host.tryParse).toHaveBeenCalledTimes(1); // debounce pending
    await vi.advanceTimersByTimeAsync(300);
    expect(host.tryParse).toHaveBeenCalledTimes(2);
    expect(host.adopt).toHaveBeenCalledTimes(2);
    expect(ta.hasAttribute('aria-invalid')).toBe(false);
  });

  it('keeps the last good tree on a broken parse and recovers', async () => {
    const { el, host, ta, strip } = await makePane('<p>ok</p>');
    el.reparseNow();
    await flushRaf();
    expect(host.adopt).toHaveBeenCalledTimes(1);
    expect(strip.hidden).toBe(true);

    type(ta, '<p>FAIL');
    await vi.advanceTimersByTimeAsync(300);
    expect(host.adopt).toHaveBeenCalledTimes(1); // last good tree untouched
    expect(ta.getAttribute('aria-invalid')).toBe('true');
    expect(strip.hidden).toBe(false);
    expect(strip.getAttribute('role')).toBe('alert');
    expect(strip.textContent).toContain('parse issue');

    type(ta, '<p>fixed</p>');
    await vi.advanceTimersByTimeAsync(300);
    expect(host.adopt).toHaveBeenCalledTimes(2);
    expect(ta.hasAttribute('aria-invalid')).toBe(false);
    expect(strip.hidden).toBe(true);
    expect(host.announce).toHaveBeenCalled();
  });

  it('shows warnings without flagging the pane invalid', async () => {
    const { host, ta, strip } = await makePane('<p>WARN</p>');
    const { el } = { el: (ta.closest('sem-editor-code') as SemEditorCode) };
    el.reparseNow();
    await flushRaf();
    expect(host.adopt).toHaveBeenCalledTimes(1);
    expect(ta.hasAttribute('aria-invalid')).toBe(false);
    expect(strip.hidden).toBe(false);
  });

  it('renders jump buttons that move the caret to the issue offset', async () => {
    const { el, ta, strip } = await makePane('<p>FAIL</p>');
    el.reparseNow();
    await flushRaf();
    const btn = strip.querySelector('.sem-ed-code-jump') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    const offset = Number(btn.dataset.offset);
    expect(Number.isFinite(offset)).toBe(true);
    btn.click();
    expect(ta.selectionStart).toBe(offset);
  });

  it('caps the strip at 50 buttons with an overflow note', async () => {
    const el = document.createElement('sem-editor-code') as SemEditorCode;
    const many = Array.from({ length: 60 }, (_, i) => issue(i * 10, i * 10 + 1));
    const host = {
      tryParse: () => ({ ok: false, doc: {}, issues: many, error: {} }),
      adopt: () => {},
      offsetToPos: (o: number) => ({ node: null, offset: o }),
    };
    el.host = host as unknown as CodeViewHost;
    el.source = 'x';
    document.body.appendChild(el);
    await el.updateComplete;
    el.reparseNow();
    await flushRaf();
    const strip = el.querySelector('.sem-ed-code-strip') as HTMLElement;
    expect(strip.querySelectorAll('.sem-ed-code-jump').length).toBe(50);
    expect(strip.querySelector('.sem-ed-code-strip-more')).toBeTruthy();
  });

  it('works without a host: no crash, no announce', async () => {
    const el = document.createElement('sem-editor-code') as SemEditorCode;
    el.source = '<p>FAIL</p>';
    document.body.appendChild(el);
    await el.updateComplete;
    expect(() => el.reparseNow()).not.toThrow();
    await flushRaf();
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('<p>FAIL</p>');
  });

  it('wires aria-describedby to the alert strip', async () => {
    const { el, ta, strip } = await makePane();
    expect(ta.getAttribute('aria-describedby')).toBe(strip.id);
    expect(strip.id).toMatch(/-issues$/);
    expect(el.id).toMatch(/^sem-editor-code-/);
  });
});

describe('<sem-editor-code> — keyboard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const pressTab = (ta: HTMLTextAreaElement, shift = false): boolean => {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it('Tab inserts two spaces, prevents default, schedules reparse', async () => {
    const { el, host, ta } = await makePane('a');
    el.reparseNow();
    await flushRaf();
    ta.focus();
    ta.setSelectionRange(0, 0);
    expect(pressTab(ta)).toBe(true);
    expect(ta.value).toBe('  a');
    // caret lands at/after the inserted pair (happy-dom caret handling varies)
    expect(ta.selectionStart).toBeGreaterThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(300);
    // the Tab edit went through the debounced parse pipeline
    expect(host.tryParse.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('Tab indents every selected line; Shift+Tab outdents up to two spaces', async () => {
    const { ta } = await makePane('a\nb');
    ta.focus();
    ta.setSelectionRange(0, 3);
    pressTab(ta);
    expect(ta.value).toBe('  a\n  b');
    ta.setSelectionRange(0, 7);
    pressTab(ta, true);
    expect(ta.value).toBe('a\nb');
    // a single leading space outdents by one
    type(ta, ' x\n  y');
    ta.setSelectionRange(0, 6);
    pressTab(ta, true);
    expect(ta.value).toBe('x\ny');
  });
});

describe('<sem-editor-code> — selection sync (§2.6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('emits CodeSelection with DocPos on select', async () => {
    const { host, ta } = await makePane('<p>abc</p>');
    ta.setSelectionRange(3, 6);
    ta.dispatchEvent(new Event('select'));
    await flushRaf();
    expect(host.onCodeSelection).toHaveBeenCalledTimes(1);
    const sel = host.onCodeSelection.mock.calls[0][0] as CodeSelection;
    expect(sel.anchorOffset).toBe(3);
    expect(sel.focusOffset).toBe(6);
    expect(sel.source).toBe('code');
    expect(sel.anchor).toEqual({ node: null, offset: 3 });
    expect(host.offsetToPos).toHaveBeenCalledWith(3);
    expect(host.offsetToPos).toHaveBeenCalledWith(6);
  });

  it('defers shell-driven selection while typing (one-way-on-typing)', async () => {
    const { ta } = await makePane('<p>a</p>');
    ta.focus();
    type(ta, '<p>ab</p>');
    el_setSelection(ta, 2, 4);
    expect(ta.selectionStart).not.toBe(2);
    ta.blur();
    el_setSelection(ta, 2, 4);
    expect(ta.selectionStart).toBe(2);
  });

  /** Drive setSelectionByOffset through the element (guarded path). */
  function el_setSelection(ta: HTMLTextAreaElement, start: number, end: number): void {
    (ta.closest('sem-editor-code') as SemEditorCode).setSelectionByOffset(start, end);
  }
});

describe('<sem-editor-code> — scroll + wrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reconciles textarea scroll into the shared scroller', async () => {
    const { ta, scroller } = await makePane('<p>a</p>');
    ta.scrollTop = 40;
    ta.scrollLeft = 7;
    ta.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollTop).toBe(40);
    expect(scroller.scrollLeft).toBe(7);
    expect(ta.scrollTop).toBe(0);
    expect(ta.scrollLeft).toBe(0);
  });

  it('toggles the textarea wrap attribute with [wrap]', async () => {
    const { el, ta } = await makePane();
    expect(ta.getAttribute('wrap')).toBe('off');
    el.wrap = true;
    await el.updateComplete;
    expect(ta.getAttribute('wrap')).toBe('soft');
  });
});

describe('<sem-editor-code> — perf smoke', () => {
  it('highlights a 10k-line document interactively', () => {
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) lines.push(`<p class="row">item &amp; ${i}</p>`);
    const src = lines.join('\n');

    // The algorithmic budget lives in the scan: pure string work, must be
    // far under a frame-scale wall even in CI.
    const t0 = performance.now();
    const r = highlight(src);
    const scanMs = performance.now() - t0;
    expect(scanMs).toBeLessThan(1000);
    expect(r.lines.length).toBe(10_000);

    // Rendering exercises happy-dom DOM throughput (not the browser's), so
    // only a 1k-line slice with a generous wall — this catches pathological
    // O(n²) in the renderer, nothing finer.
    const t1 = performance.now();
    const slice = lines.slice(0, 1000).join('\n');
    const pre = document.createElement('pre');
    renderHighlight(pre, highlight(slice), slice);
    const renderMs = performance.now() - t1;
    expect(renderMs).toBeLessThan(5000);
    expect(pre.childNodes.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.info(`code view perf — scan 10k lines: ${scanMs.toFixed(0)}ms, render 1k lines (happy-dom): ${renderMs.toFixed(0)}ms`);
  });
});
