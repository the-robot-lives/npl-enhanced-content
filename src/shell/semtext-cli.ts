/**
 * sem-shell — the SemText document operations, as pure functions.
 *
 * Stand-in for the Node SemText CLI (filter / format / outline) being built
 * on another branch: when that CLI lands, these three can be swapped for its
 * implementations. Until then the shell carries its own, written so the
 * contract is the package's own normative one wherever one exists:
 *
 *   formatDoc(html, 'text')  == extractText()      — spec/extraction.md §8
 *                               (the annotated plain-text reference recipe)
 *   formatDoc(html, 'json')  == extractRecords()   — the canonical SemRecord[]
 *                               array, the shape spec/extraction.md §2 fixes
 *   outlineDoc()             — headings h1-h6 plus structural sem-* blocks
 *                              (no house contract exists; CLI should match
 *                              the ordering/depth rule documented below)
 *   filterDoc()              — element-outerHTML selection; likewise CLI-owned
 *
 * All four parse with DOMParser and never mutate the document — pure in the
 * same sense extraction is (records.ts preamble): read only, write nothing.
 */

import { extractRecords, extractText } from '../extract/records.js';

/** Parse an HTML string to a Document. Caller's platform provides DOMParser. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/* ------------------------------------------------------------------ *
 * filter
 * ------------------------------------------------------------------ */

export interface FilterOptions {
  /** Element type to select, e.g. `sem-note`, `p`, `h2`. */
  type?: string | null;
  /** Case-insensitive substring to find in an element's text. */
  text?: string | null;
}

/**
 * Select elements by type and/or text; returns their `outerHTML`, one per
 * line. With `text`, only MINIMAL matches are reported — an element whose
 * own subtree matched deeper is dropped, so filtering for "PKCE" yields the
 * one property that carries it, not also every ancestor. With `type`, every
 * match is reported in document order. No matches → empty string. No
 * criteria at all → throws (the caller validates first; this backstop keeps
 * the pure function honest on its own).
 */
export function filterDoc(html: string, options: FilterOptions): string {
  const type = options.type?.trim().toLowerCase() || null;
  const text = options.text?.trim() || null;
  if (!type && !text) {
    throw new Error('semtext filter: give --type <element> or --text <string>');
  }
  if (type && !/^[a-z][a-z0-9-]*$/.test(type)) {
    throw new Error(`semtext filter: invalid element type "${type}"`);
  }
  const body = parseHtml(html).body;
  let matches: Element[] = type
    ? Array.from(body.querySelectorAll(type))
    : Array.from(body.querySelectorAll('*'));
  if (text) {
    const needle = text.toLowerCase();
    matches = matches.filter((el) => (el.textContent || '').toLowerCase().includes(needle));
    const set = new Set(matches);
    matches = matches.filter(
      (el) => !Array.from(el.querySelectorAll('*')).some((child) => set.has(child)),
    );
  }
  return matches.map((el) => el.outerHTML).join('\n');
}

/* ------------------------------------------------------------------ *
 * format
 * ------------------------------------------------------------------ */

/**
 * Project a document to `text` (the annotated plain-text reference recipe —
 * `extractText`) or `json` (the canonical `SemRecord[]`, pretty-printed).
 */
export function formatDoc(html: string, format: 'text' | 'json'): string {
  if (format !== 'text' && format !== 'json') {
    throw new Error(`semtext format: unknown format "${format}" — use text or json`);
  }
  const doc = parseHtml(html);
  if (format === 'text') return extractText(doc);
  return JSON.stringify(extractRecords(doc), null, 2);
}

/* ------------------------------------------------------------------ *
 * outline
 * ------------------------------------------------------------------ */

export interface OutlineEntry {
  /** Lowercased tag: `h1`-`h6`, or a structural `sem-*` element. */
  tag: string;
  /** Heading text, or a short label derived from the element. */
  label: string;
  /** Headings nest at their own level; blocks sit one under the last heading. */
  depth: number;
}

/**
 * Structural elements the outline names (extraction's record vocabulary,
 * minus the transparent/chrome wrappers it also excludes: sem-source,
 * sem-reader, sem-audiences, sem-enhanced-document).
 */
const STRUCTURAL = new Set([
  'sem-note',
  'sem-facts',
  'sem-details',
  'sem-procedure',
  'sem-properties',
  'sem-views',
  'sem-reveal',
  'sem-progress',
  'sem-chronology',
  'sem-code',
  'sem-references',
  'sem-table',
  'sem-md',
]);

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** `label`/`summary`/`kind`/`filename`/`lang`/`variant` attribute, else a text snippet. */
function labelFor(el: Element): string {
  for (const attr of ['label', 'summary', 'kind', 'filename', 'lang', 'variant']) {
    const value = el.getAttribute(attr);
    if (value) return norm(value);
  }
  const text = norm(el.textContent || '');
  return text.length > 48 ? text.slice(0, 48) + '...' : text;
}

/**
 * The document skeleton in reading order: every h1-h6 at its own depth,
 * plus each structural sem-* block one level under the last heading seen
 * (heading context persists across following siblings). A structural block
 * swallows deeper structural blocks (the deck is one entry, not one per
 * fact); headings inside anything still count.
 */
export function outlineDoc(html: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const walk = (el: Element, startLevel: number, inStructural: boolean): number => {
    let headingLevel = startLevel;
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      const heading = /^h([1-6])$/.exec(tag);
      if (heading) {
        const depth = Number(heading[1]);
        entries.push({ tag, label: norm(child.textContent || ''), depth });
        headingLevel = walk(child, depth, inStructural);
      } else if (!inStructural && STRUCTURAL.has(tag)) {
        entries.push({ tag, label: labelFor(child), depth: headingLevel + 1 });
        walk(child, headingLevel, true);
      } else {
        headingLevel = walk(child, headingLevel, inStructural);
      }
    }
    return headingLevel;
  };
  walk(parseHtml(html).body, 0, false);
  return entries;
}
