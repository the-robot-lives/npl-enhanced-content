/**
 * Code-view renderers — DOM projection of a `HighlightResult` (EDITOR.md
 * §6). Built exclusively from `createElement` + `textContent`: the source is
 * never handed to a HTML parser, so `<script>` bodies render as inert text
 * no matter what they contain (§8 safety, structural not scrubbed).
 *
 * Squiggles are baked into the highlight layer: a token whose range
 * intersects a parse issue renders with the extra `sem-ed-err` class, and
 * the gutter marks the line. One layer, one alignment surface, no overlay
 * mirror to keep in sync across soft-wrap.
 */

import { lineColForOffset, lineIndexOf } from './highlight.js';
import type { CodeToken, HighlightResult } from './types.js';
import type { ParseIssue } from '../model/types.js';

/** Upper bound of rendered strip entries (perf guard for pathological
 *  documents; the count line always reports the true total). */
export const STRIP_LIMIT = 50;

/** Replace `pre`'s children with the highlight projection of `result`.
 *  Adjacent same-kind tokens merge into one span to cut node count. */
export function renderHighlight(
  pre: HTMLElement,
  result: HighlightResult,
  source: string,
): void {
  const frag = document.createDocumentFragment();
  const last = result.lines.length - 1;
  for (let li = 0; li <= last; li++) {
    const line = result.lines[li];
    let i = 0;
    while (i < line.tokens.length) {
      const first = line.tokens[i];
      let endTok = first;
      let j = i + 1;
      while (j < line.tokens.length) {
        const nxt = line.tokens[j];
        if (nxt.kind !== first.kind || nxt.err !== first.err) break;
        endTok = nxt;
        j++;
      }
      const text = source.slice(first.start, endTok.end);
      if (first.kind === 'text' && !first.err) {
        frag.appendChild(document.createTextNode(text));
      } else {
        const span = document.createElement('span');
        span.className = first.err ? `sem-ed-tok-${first.kind} sem-ed-err` : `sem-ed-tok-${first.kind}`;
        span.textContent = text;
        frag.appendChild(span);
      }
      i = j;
    }
    if (li < last) frag.appendChild(document.createTextNode('\n'));
  }
  pre.replaceChildren(frag);
}

/** Per-line gutter: 1-based line numbers; lines under an issue get
 *  `sem-ed-code-ln-err` + the first issue's message as `title`. */
export function renderGutter(
  gutter: HTMLElement,
  result: HighlightResult,
  issues: readonly ParseIssue[],
): void {
  const marked = new Set<number>();
  for (const issue of issues) {
    if (issue.range.end <= issue.range.start) continue;
    for (let li = lineIndexOf(result, Math.max(0, issue.range.start)); li < result.lines.length; li++) {
      if (result.lineStarts[li] >= issue.range.end) break;
      if (result.lineEnds[li] <= issue.range.start) continue;
      marked.add(li);
    }
  }
  const frag = document.createDocumentFragment();
  for (let li = 0; li < result.lines.length; li++) {
    const row = document.createElement('div');
    row.className = marked.has(li) ? 'sem-ed-code-ln sem-ed-code-ln-err' : 'sem-ed-code-ln';
    row.textContent = String(li + 1);
    if (marked.has(li)) {
      const first = issues.find((issue) => {
        if (issue.range.end <= issue.range.start) return false;
        return result.lineStarts[li] < issue.range.end && result.lineEnds[li] > issue.range.start;
      });
      if (first) row.title = `${first.severity}: ${first.message}`;
    }
    frag.appendChild(row);
  }
  gutter.replaceChildren(frag);
}

/** The `role="alert"` issue strip: count heading + jump buttons (offsets in
 *  `data-offset`). Hidden when there is nothing to report. */
export function renderStrip(
  strip: HTMLElement,
  result: HighlightResult,
  issues: readonly ParseIssue[],
  announceText?: string,
): void {
  if (issues.length === 0) {
    strip.hidden = true;
    strip.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  const head = document.createElement('span');
  head.className = 'sem-ed-code-strip-head';
  head.textContent =
    `${issues.length} parse ${issues.length === 1 ? 'issue' : 'issues'} — last good tree stays active` +
    (announceText ? ` · ${announceText}` : '');
  frag.appendChild(head);
  const shown = issues.slice(0, STRIP_LIMIT);
  for (const issue of shown) {
    const { line, col } = lineColForOffset(result, issue.range.start);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sem-ed-code-jump';
    btn.dataset.offset = String(issue.range.start);
    btn.textContent = `line ${line}, col ${col} — ${issue.severity}: ${issue.message}`;
    frag.appendChild(btn);
  }
  if (issues.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'sem-ed-code-strip-more';
    more.textContent = `… and ${issues.length - shown.length} more`;
    frag.appendChild(more);
  }
  strip.replaceChildren(frag);
  strip.hidden = false;
}
