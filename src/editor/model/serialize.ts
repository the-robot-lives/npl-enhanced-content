/**
 * Serializer: rebuilds source from the node tree.
 *
 * Untouched nodes re-emit their preserved trivia verbatim (attribute order,
 * leading whitespace, quote style, raw attribute values, raw text, close-tag
 * trivia); only nodes an op touched re-escape canonically. This is what makes
 * `serialize(parse(x)) === x` hold and keeps edits surgical.
 *
 * `emitDocument` refreshes every node's `range` against the emitted bytes and
 * resets text/attribute baselines (`raw`/`rawValue` become the emitted slice,
 * `edited` clears), so ranges stay current after edits (types.ts invariant 4)
 * and repeated serializes are byte-stable.
 */

import { escapeAttr, escapeText } from './entities.js';
import { VOID_ELEMENTS } from './types.js';
import type {
  AttrNode,
  DocumentNode,
  EditorDocument,
  EditorNode,
  SerializeStyle,
} from './types.js';

const VOID = new Set(VOID_ELEMENTS);

export const DEFAULT_STYLE: SerializeStyle = { quote: '"', indent: '  ', newline: '\n' };

/** Offset-tracking output buffer (avoids O(n²) length computation). */
class Emitter {
  parts: string[] = [];
  offset = 0;
  push(s: string): void {
    if (s.length === 0) return;
    this.parts.push(s);
    this.offset += s.length;
  }
  toString(): string {
    return this.parts.join('');
  }
}

function emitNode(node: DocumentNode | EditorNode, em: Emitter, style: SerializeStyle, refresh: boolean): void {
  switch (node.kind) {
    case 'document': {
      const start = em.offset;
      for (const child of node.children) emitNode(child, em, style, refresh);
      if (refresh) node.range = { start, end: em.offset };
      return;
    }
    case 'element': {
      const start = em.offset;
      em.push('<' + node.name);
      for (const attr of node.attrs) {
        em.push(attr.pre);
        emitAttr(attr, em, style, refresh);
      }
      em.push(node.preGt);
      const voidEl = VOID.has(node.name.toLowerCase());
      if (node.selfClosing) {
        em.push('/>');
      } else if (voidEl && node.children.length === 0 && !node.closeTag) {
        em.push('>'); // authored HTML5-style void: no close tag
      } else {
        em.push('>');
        for (const child of node.children) emitNode(child, em, style, refresh);
        const ct = node.closeTag;
        em.push('</' + (ct ? ct.preName : '') + (ct ? ct.name : node.name) + (ct ? ct.preGt : '') + '>');
      }
      if (refresh) node.range = { start, end: em.offset };
      return;
    }
    case 'text': {
      const start = em.offset;
      let emitted: string;
      if (node.mode === 'raw') {
        // raw text is never re-escaped: JSON payloads etc. must stay inert
        emitted = node.edited ? node.value : node.raw;
      } else if (node.edited) {
        emitted = escapeText(node.value);
      } else {
        emitted = node.raw;
      }
      em.push(emitted);
      if (refresh) {
        node.raw = emitted;
        node.edited = false;
        node.range = { start, end: em.offset };
      }
      return;
    }
    case 'comment': {
      const start = em.offset;
      em.push('<!--' + node.value + '-->');
      if (refresh) node.range = { start, end: em.offset };
      return;
    }
    case 'cdata': {
      const start = em.offset;
      em.push('<![CDATA[' + node.value + ']]>');
      if (refresh) node.range = { start, end: em.offset };
      return;
    }
    case 'pi': {
      const start = em.offset;
      em.push('<?' + node.target + (node.value.length > 0 ? ' ' + node.value : '') + '?>');
      if (refresh) node.range = { start, end: em.offset };
      return;
    }
    case 'doctype': {
      const start = em.offset;
      em.push('<!' + node.value + '>');
      if (refresh) node.range = { start, end: em.offset };
      return;
    }
  }
}

function emitAttr(attr: AttrNode, em: Emitter, style: SerializeStyle, refresh: boolean): void {
  const start = em.offset;
  if (attr.value === null && attr.rawValue === null) {
    em.push(attr.name); // bare attribute (e.g. `collapsed`)
    if (refresh) attr.range = { start, end: em.offset };
    return;
  }
  if (attr.rawValue !== null) {
    // untouched: authored spelling, authored quotes (or authored bare value)
    if (attr.quote === '') em.push(attr.name + '=' + attr.rawValue);
    else em.push(attr.name + '=' + attr.quote + attr.rawValue + attr.quote);
  } else {
    // created/edited: canonical escape in the attr's (or document default) style
    const q: '"' | "'" = attr.quote === '' ? style.quote : attr.quote;
    const raw = escapeAttr(attr.value ?? '', q);
    em.push(attr.name + '=' + q + raw + q);
    if (refresh) {
      attr.quote = q;
      attr.rawValue = raw;
    }
  }
  if (refresh) attr.range = { start, end: em.offset };
}

/** Serialize a whole document; refreshes ranges + raw baselines. */
export function emitDocument(doc: EditorDocument, style: SerializeStyle): string {
  const em = new Emitter();
  for (const child of doc.root.children) emitNode(child, em, style, true);
  doc.root.range = { start: 0, end: em.offset };
  return em.toString();
}

/** Pure emission of one subtree — no mutation (standalone offsets would not
 *  match document coordinates; use `emitDocument` for range refresh). */
export function emitSubtree(node: DocumentNode | EditorNode, style: SerializeStyle): string {
  const em = new Emitter();
  emitNode(node, em, style, false);
  return em.toString();
}
