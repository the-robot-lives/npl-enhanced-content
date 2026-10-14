/**
 * Code-view highlighter — the HTML scan from `src/terminal/sh-highlight.ts`
 * adapted to emit typed tokens with source offsets instead of SGR strings
 * (EDITOR.md §6). The terminal scanner is per-line because ANSI runs and
 * `bat`'s gutter must not span newlines; an editor's highlight layer has to
 * color multi-line comments, multi-line tags and raw-text bodies correctly,
 * so the same streaming character-scan discipline runs over the whole source
 * with carry state, then the token list is cut at line boundaries. No
 * dependencies, no parsing — a broken document colors exactly as authored.
 *
 * Totality: every non-newline character lands in exactly one token; newline
 * characters are structural (the renderer separates lines itself).
 * `markErrors` is the only mutation channel (issue ranges → `err` flags).
 *
 * Perf: O(n) — index jumps (`indexOf`) for comments/doctype/raw bodies, one
 * lowercased copy for case-insensitive scans, no per-attribute substring
 * copies. 10k-line documents must stay interactive (§6 budget).
 */

import type { CodeToken, CodeTokenKind, HighlightResult } from './types.js';

const ENTITY = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/y;
const WS = /\s/;
const ATTR_STOP = /[\s=>]/;

/** Tag name at `i` (input already lowercased); `name: ''` when none starts. */
function tagNameAt(lower: string, i: number): { name: string; end: number } {
  if (i >= lower.length) return { name: '', end: i };
  const c = lower[i];
  if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) return { name: '', end: i };
  let j = i + 1;
  while (j < lower.length) {
    const d = lower[j];
    if ((d >= 'a' && d <= 'z') || (d >= '0' && d <= '9') || d === '-') j++;
    else break;
  }
  return { name: lower.slice(i, j), end: j };
}

interface RawToken {
  kind: CodeTokenKind;
  start: number;
  end: number;
}

/** Scan the whole source once — the terminal scanner's discipline, carried
 *  across lines (multi-line comments/tags, raw-text bodies). */
function scanTokens(source: string): RawToken[] {
  const toks: RawToken[] = [];
  const lower = source.toLowerCase();
  const n = source.length;
  const push = (kind: CodeTokenKind, start: number, end: number): void => {
    if (end > start) toks.push({ kind, start, end });
  };

  let i = 0;
  let plainStart = 0;

  while (i < n) {
    // ── text run: plain until `<` (markup) or a complete `&…;` (entity) ──
    while (i < n) {
      const ch = source[i];
      if (ch === '<') break;
      if (ch === '&') {
        ENTITY.lastIndex = i;
        const m = ENTITY.exec(source);
        if (m) {
          if (i > plainStart) toks.push({ kind: 'text', start: plainStart, end: i });
          toks.push({ kind: 'entity', start: i, end: i + m[0].length });
          i += m[0].length;
          plainStart = i;
          continue;
        }
      }
      i++;
    }
    if (i > plainStart) toks.push({ kind: 'text', start: plainStart, end: i });
    if (i >= n) break;

    // ── markup at `<` ──
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      push('comment', i, stop);
      i = stop;
      plainStart = i;
      continue;
    }
    if (lower.startsWith('<![cdata[', i)) {
      const end = source.indexOf(']]>', i + 9);
      const stop = end === -1 ? n : end + 3;
      push('doctype', i, stop);
      i = stop;
      plainStart = i;
      continue;
    }
    if (source[i + 1] === '!') {
      const end = source.indexOf('>', i);
      const stop = end === -1 ? n : end + 1;
      push('doctype', i, stop);
      i = stop;
      plainStart = i;
      continue;
    }
    if (source[i + 1] === '?') {
      const end = source.indexOf('?>', i);
      const stop = end === -1 ? n : end + 2;
      push('doctype', i, stop);
      i = stop;
      plainStart = i;
      continue;
    }

    const isClose = source[i + 1] === '/';
    const { name, end: nameEnd } = tagNameAt(lower, i + (isClose ? 2 : 1));
    if (name === '') {
      // `<` that opens nothing (`< `, `<>`, `<3`, `<` at EOF) — plain text
      push('text', i, i + 1);
      i++;
      plainStart = i;
      continue;
    }

    // ── tag scan (adapted findTagEnd + highlightTag, carried over lines) ──
    push('tag', i, nameEnd);
    i = nameEnd;
    let selfClosed = false;
    let closed = false;
    while (i < n) {
      const c = source[i];
      if (c === '>') {
        push('text', i, i + 1);
        i++;
        closed = true;
        break;
      }
      if (c === '/' && source[i + 1] === '>') {
        push('text', i, i + 2);
        i += 2;
        closed = true;
        selfClosed = true;
        break;
      }
      if (WS.test(c)) {
        const start = i;
        while (i < n && WS.test(source[i])) i++;
        push('text', start, i);
        continue;
      }
      if (c === '=') {
        // `=` plus any spaces before the value are plain
        const start = i;
        i++;
        while (i < n && WS.test(source[i])) i++;
        push('text', start, i);
        if (i >= n) break;
        const v = source[i];
        if (v === '"' || v === "'") {
          const vEnd = source.indexOf(v, i + 1);
          const stop = vEnd === -1 ? n : vEnd + 1;
          push('value', i, stop);
          i = stop;
        } else {
          const vStart = i;
          while (i < n && !WS.test(source[i]) && source[i] !== '>') i++;
          push('value', vStart, i);
        }
        continue;
      }
      // attribute name — stops at whitespace, `=` or `>` (a bare `/` joins
      // the name, as in the terminal scanner; `<tag/>` without attrs still
      // hits the `/>` branch above)
      const aStart = i;
      while (i < n && !ATTR_STOP.test(source[i])) i++;
      push('attr', aStart, i);
    }
    if (!closed) break; // EOF inside a tag — the tail is already pushed
    plainStart = i;

    // raw-text bodies: script/style content is opaque until the matching
    // case-insensitive close tag (model RAW_TEXT_ELEMENTS contract)
    if (!isClose && !selfClosed && (name === 'script' || name === 'style')) {
      const close = lower.indexOf('</' + name, i);
      const stop = close === -1 ? n : close;
      push('text', i, stop);
      i = stop;
      plainStart = i;
    }
  }
  return toks;
}

/** Highlight `source`: whole-source scan, then cut tokens at line bounds. */
export function highlight(source: string): HighlightResult {
  const raw = scanTokens(source);
  const lineStarts: number[] = [0];
  for (let p = source.indexOf('\n'); p !== -1; p = source.indexOf('\n', p + 1)) {
    lineStarts.push(p + 1);
  }
  const lineCount = lineStarts.length;
  const lineEnds: number[] = new Array<number>(lineCount);
  for (let li = 0; li < lineCount; li++) {
    lineEnds[li] = li + 1 < lineCount ? lineStarts[li + 1] - 1 : source.length;
  }

  const lines = lineStarts.map((_, index) => ({ index, tokens: [] as CodeToken[] }));
  let li = 0;
  for (const t of raw) {
    while (li + 1 < lineCount && lineStarts[li + 1] <= t.start) li++;
    let s = t.start;
    for (;;) {
      const cut = Math.min(t.end, lineEnds[li]);
      if (cut > s) lines[li].tokens.push({ kind: t.kind, start: s, end: cut, err: false });
      if (cut >= t.end) break;
      // token crosses the newline — the `\n` itself stays structural
      li++;
      if (li >= lineCount) break;
      s = lineStarts[li];
    }
  }
  return { lines, lineStarts, lineEnds, length: source.length };
}

/** Overlay parse issues onto a highlight result: tokens and gutter lines
 *  whose range intersects an issue get flagged (`sem-ed-err` squiggle, bold
 *  gutter number). Idempotent — clears then marks. */
export function markErrors(
  result: HighlightResult,
  issues: readonly { range: { start: number; end: number } }[],
): void {
  for (const line of result.lines) for (const t of line.tokens) t.err = false;
  if (issues.length === 0) return;
  const sorted = [...issues].sort((a, b) => a.range.start - b.range.start);
  let li = 0;
  for (const issue of sorted) {
    const { start, end } = issue.range;
    if (end <= start) continue;
    while (li + 1 < result.lines.length && result.lineStarts[li + 1] <= start) li++;
    for (let l = li; l < result.lines.length && result.lineStarts[l] < end; l++) {
      if (result.lineEnds[l] <= start || result.lineStarts[l] >= end) continue;
      for (const t of result.lines[l].tokens) {
        if (t.start < end && t.end > start) t.err = true;
      }
    }
  }
}

/** 0-based index of the line containing `offset` (clamped into the doc). */
export function lineIndexOf(result: HighlightResult, offset: number): number {
  const off = Math.max(0, Math.min(offset, result.length));
  let lo = 0;
  let hi = result.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (result.lineStarts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 1-based `{ line, col }` for an absolute offset (clamped into the doc). */
export function lineColForOffset(
  result: HighlightResult,
  offset: number,
): { line: number; col: number } {
  const li = lineIndexOf(result, offset);
  return { line: li + 1, col: offset - result.lineStarts[li] + 1 };
}
