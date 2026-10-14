/**
 * demo/tui-tree — the document → tree build behind `semtext tui`.
 *
 * The one DOM-touching piece of the TUI: it walks a parsed document and
 * produces the pure `TuiNode[]` the tree machine and the grid app consume.
 * The shape mirrors `outlineDoc` (shell/semtext-cli.ts) — headings nest at
 * their own level, structural sem-* blocks sit under the last heading and
 * swallow deeper structure — but keeps element references so each block
 * can carry its expanded body lines.
 *
 * Sections are computed from the same heading counters `toc` uses; blocks
 * take their label from the record vocabulary's label attributes (label,
 * summary, kind, filename, lang, variant) and their body from the records
 * they mint (the same text+fields shape the Round-1 cards used), falling
 * back to the plain-text render for non-record content.
 */

import { parseHtml, formatDoc } from '../../../shell/semtext-cli.js';
import { extractRecords } from '../../../extract/records.js';
import type { TuiNode } from '../../tui.js';

/**
 * Structural containers (vocabulary of `outlineDoc` in shell/semtext-cli.ts —
 * kept in step by its spec; a block swallows deeper blocks).
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

/** Leaf record elements that mint a block of their own under a section. */
const LEAF_RECORDS = new Set([
  'sem-fact',
  'sem-detail',
  'sem-step',
  'sem-view',
  'sem-event',
  'sem-reference',
  'sem-property',
]);

/** Body lines per block — long figures render, but they do not flood. */
const BODY_LINE_CAP = 60;

function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function textOf(el: Element): string {
  return norm(el.textContent || '');
}

/** The outline's block label: the first named attribute, else short text. */
function labelFor(el: Element): string {
  for (const attr of ['label', 'summary', 'kind', 'filename', 'lang', 'variant']) {
    const value = el.getAttribute(attr);
    if (value) return norm(value);
  }
  const text = textOf(el);
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

/** `#id kind=… tags=…` from the first provenance-bearing record. */
function metaFor(el: Element): string {
  let records: ReturnType<typeof extractRecords> = [];
  try {
    records = extractRecords(el);
  } catch {
    records = [];
  }
  for (const record of records) {
    const meta = [record.id ? `#${record.id}` : null, record.kind ? `kind=${record.kind}` : null, record.tags.length ? `tags=${record.tags.join(',')}` : null]
      .filter((bit): bit is string => bit !== null)
      .join(' · ');
    if (meta !== '') return meta;
  }
  return '';
}

function fieldLine(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return `${key}: ${Array.isArray(value) ? value.join(' | ') : String(value)}`;
}

/** The expanded body: record text + fields, else the plain-text render. */
function bodyLines(el: Element): string[] {
  const lines: string[] = [];
  try {
    for (const record of extractRecords(el)) {
      if (record.text) lines.push(record.text);
      for (const [key, value] of Object.entries(record.fields)) {
        const line = fieldLine(key, value);
        if (line !== null) lines.push(line);
      }
    }
  } catch {
    // extraction is total over well-formed input; a malformed element
    // still deserves its block — the fallback below renders it.
  }
  if (lines.length === 0) {
    for (const line of formatDoc(el.outerHTML, 'text').split('\n')) {
      const trimmed = line.trimEnd();
      if (trimmed !== '') lines.push(trimmed);
    }
  }
  return lines.slice(0, BODY_LINE_CAP);
}

function blockNode(el: Element, order: number): TuiNode {
  return {
    id: el.getAttribute('id') ?? `b${order}`,
    kind: 'block',
    label: labelFor(el),
    number: '',
    level: 0,
    body: bodyLines(el),
    meta: metaFor(el),
    children: [],
  };
}

function sectionNumber(counters: number[], level: number): string {
  const parts = counters.slice(0, level);
  while (parts.length > 1 && parts[0] === 0) parts.shift(); // a doc may start at h2
  return parts.join('.');
}

/**
 * Build the tree. Sections come from h1–h6 (numbered in reading order),
 * blocks from structural containers and bare leaf records. A document
 * with neither yields empty roots — `semtext tui` reports that as an
 * error rather than opening an empty view.
 */
export function buildTuiTree(html: string): { title: string; roots: TuiNode[] } {
  const doc = parseHtml(html);
  const title = textOf(doc.querySelector('h1') ?? doc.querySelector('title') ?? doc.body) || 'document';
  const roots: TuiNode[] = [];
  const counters = [0, 0, 0, 0, 0, 0];
  let order = 0;

  const walk = (el: Element, startLevel: number, inStructural: boolean, parent: TuiNode[]): number => {
    let headingLevel = startLevel;
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      const heading = /^h([1-6])$/.exec(tag);
      if (heading) {
        const level = Number(heading[1]);
        counters[level - 1]! += 1;
        for (let i = level; i < counters.length; i++) counters[i] = 0;
        const number = sectionNumber(counters, level);
        const node: TuiNode = {
          id: child.getAttribute('id') ?? number,
          kind: 'section',
          label: textOf(child) || number,
          number,
          level,
          body: [],
          meta: '',
          children: [],
        };
        parent.push(node);
        headingLevel = walk(child, level, inStructural, node.children);
      } else if (!inStructural && (STRUCTURAL.has(tag) || LEAF_RECORDS.has(tag))) {
        order += 1;
        parent.push(blockNode(child, order));
        // Structural containers swallow deeper structure: their records
        // render as the block's body, not as sibling rows.
        if (STRUCTURAL.has(tag)) walk(child, headingLevel, true, []);
      } else {
        headingLevel = walk(child, headingLevel, inStructural, parent);
      }
    }
    return headingLevel;
  };

  walk(doc.body, 0, false, roots);
  return { title, roots };
}
