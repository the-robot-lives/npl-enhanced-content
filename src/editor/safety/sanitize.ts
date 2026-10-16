/**
 * safety/sanitize — pasted/dropped HTML into model-safe nodes (§8).
 *
 * Paste never becomes DOM: the source is parsed with the model parser and
 * FILTERED at the node level — known SemText tags plus basic formatting
 * survive; everything else (unknown tags, comments, scripts, styles,
 * event handlers, junk attributes, unsafe URLs) is dropped and counted.
 * Unknown ELEMENTS are unwrapped, not deleted: `<span>x</span>` keeps `x`.
 *
 * The surviving tree is returned as parsed nodes; the caller rebuilds it
 * through its own document's factories (adoption rule, §2.3) via
 * `rebuildSubtree` — the same helper duplicates and template inserts go
 * through, so every inserted node's id comes from the target counter.
 */

import { parse } from '../model/document.js';
import type {
  EditorDocument,
  EditorNode,
  ElementNode,
} from '../model/types.js';
import { isSafeUrl } from './url.js';

/** Formatting elements a paste may keep even without the schema. */
export const FORMATTING_TAGS: ReadonlySet<string> = new Set([
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'code',
  'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead',
  'tbody', 'tr', 'th', 'td', 'caption', 'span', 'div',
]);

/** Attributes a paste may keep: the global catalog + table/link basics. */
const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  'id', 'kind', 'tags', 'audience', 'data-audience',
  'href', 'src', 'alt', 'colspan', 'rowspan', 'scope', 'data-value', 'title',
]);

export interface SanitizeCounts {
  droppedTags: number;
  droppedAttrs: number;
  droppedUrls: number;
}

export interface SanitizeResult extends SanitizeCounts {
  /** Filtered parsed nodes (fresh ids from a throwaway parse document). */
  nodes: EditorNode[];
}

/** Class values survive only when every token is a vocabulary alias
 *  (`.sem-*` / `.npl-*`) — framework junk never rides a paste in. */
function aliasClass(value: string): string | null {
  const kept = value
    .split(/\s+/)
    .filter((t) => /^(?:sem|npl)-/.test(t))
    .join(' ');
  return kept === '' ? null : kept;
}

function tagAllowed(name: string, known: ReadonlySet<string> | undefined): boolean {
  if (known !== undefined && known.size > 0) return known.has(name) || FORMATTING_TAGS.has(name);
  return FORMATTING_TAGS.has(name);
}

type Counts = SanitizeCounts;

/** Dropped containers whose CONTENT is dropped with them (§8). */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'embed', 'object', 'template']);

function filterChildren(el: ElementNode, doc: EditorDocument, known: ReadonlySet<string> | undefined, counts: Counts): EditorNode[] {
  const out: EditorNode[] = [];
  for (const child of el.children) {
    if (child.kind === 'text') {
      if (child.value !== '') out.push(child);
      continue;
    }
    if (child.kind !== 'element') {
      counts.droppedTags += 1; // comments, CDATA, PIs, doctype
      continue;
    }
    const name = child.name.toLowerCase();
    if (!tagAllowed(name, known)) {
      counts.droppedTags += 1;
      // Script-style containers never unwrap: their raw payload must not
      // leak into the model as text (§8 — no script content survives).
      if (DROP_WITH_CONTENT.has(name)) continue;
      out.push(...filterChildren(child, doc, known, counts)); // unwrap, keep text
      continue;
    }
    out.push(filterElement(child, doc, known, counts));
  }
  return out;
}

function filterElement(el: ElementNode, doc: EditorDocument, known: ReadonlySet<string> | undefined, counts: Counts): ElementNode {
  const attrs: Array<{ name: string; value?: string | null }> = [];
  for (const attr of el.attrs) {
    const name = attr.name.toLowerCase();
    let value: string | null = attr.value;
    if (name === 'class' && value !== null) {
      const kept = aliasClass(value);
      if (kept === null) {
        counts.droppedAttrs += 1;
        continue;
      }
      value = kept;
    } else if (!ALLOWED_ATTRS.has(name)) {
      counts.droppedAttrs += 1;
      continue;
    }
    if ((name === 'href' || name === 'src') && value !== null) {
      if (!isSafeUrl(value, { attr: name }).ok) {
        counts.droppedUrls += 1;
        continue;
      }
    }
    attrs.push({ name: attr.name, value });
  }
  return doc.createElement({
    tag: el.name,
    attrs,
    children: filterChildren(el, doc, known, counts),
  });
}

export function sanitizeHtml(html: string, opts?: { knownTags?: ReadonlySet<string> }): SanitizeResult {
  const empty: SanitizeResult = { nodes: [], droppedTags: 0, droppedAttrs: 0, droppedUrls: 0 };
  const doc = parse(`<body>${html}</body>`);
  const root = doc.root.children[0];
  if (root === undefined || root.kind !== 'element') return empty;
  const counts: Counts = { droppedTags: 0, droppedAttrs: 0, droppedUrls: 0 };
  const nodes = filterChildren(root, doc, opts?.knownTags, counts);
  return { nodes, ...counts };
}

/**
 * Deep-convert a parsed (or foreign-document) node into `doc`-owned nodes:
 * fresh ids from `doc`'s counter, decoded text and attrs carried over.
 * THE path for duplicates, template snippets and sanitized paste — nodes
 * passed by reference must never already be attached (§2.3).
 */
export function rebuildSubtree(doc: EditorDocument, node: EditorNode): EditorNode {
  if (node.kind === 'text') return doc.createText(node.value, node.mode);
  if (node.kind === 'element') {
    return doc.createElement({
      tag: node.name,
      attrs: node.attrs.map((a) => ({ name: a.name, value: a.value })),
      children: node.children.map((c) => rebuildSubtree(doc, c)),
    });
  }
  // Comments/CDATA/PI/doctype never survive an insert path.
  return doc.createText('');
}
