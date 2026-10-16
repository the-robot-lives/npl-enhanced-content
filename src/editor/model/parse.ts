/**
 * Trivia-preserving XHTML tokenizer/parser.
 *
 * Best-effort and never-throwing (types.ts invariant 5): malformed input
 * produces structured `ParseIssue`s with source ranges and a usable tree —
 * unclosed elements auto-close at EOF, mismatched close tags recover, stray
 * close tags are dropped and recorded. Byte-exactness comes from preserving
 * authored trivia verbatim: attribute order, leading whitespace per
 * attribute, quote style, raw attribute values, raw text slices, close-tag
 * trivia, comment/CDATA/PI/doctype bodies.
 *
 * `selfClosing` records the AUTHORED form (`<br />` vs `<br>`); voidness is
 * derived from VOID_ELEMENTS when creating nodes, never rewritten by the
 * parser — untouched nodes round-trip byte-for-byte.
 *
 * Deliberately NOT a browser HTML parser: the corpus is authored XHTML
 * (spec/conventions.md), so there is no implied-end tag table beyond a
 * minimal same-name guard, no foster-parenting, no `<table>` text magic.
 */

import { decodeEntities } from './entities.js';
import {
  RAW_TEXT_ELEMENTS,
  VOID_ELEMENTS,
  type CdataNode,
  type CommentNode,
  type DocumentNode,
  type DoctypeNode,
  type EditorNode,
  type ElementNode,
  type NodeId,
  type ParseIssue,
  type ProcessingInstructionNode,
  type TextNode,
} from './types.js';

const VOID = new Set(VOID_ELEMENTS);
const RAW_TEXT = new Set(RAW_TEXT_ELEMENTS);

/** Elements that implicitly close when a sibling of the same name opens
 *  (minimal authoring guard; everything else requires an explicit close). */
const AUTO_CLOSE_SAME = new Set(['li', 'p', 'dt', 'dd', 'option', 'tr', 'td', 'th']);

export interface ParseOutput {
  root: DocumentNode;
  issues: ParseIssue[];
  size: number;
  /** Next value the document counter should hand out (for id continuity). */
  nextId: number;
}

interface OpenElement {
  node: ElementNode;
  /** Source offset just after this element's open-tag `>`. */
  contentStart: number;
}

// ── id allocation ────────────────────────────────────────────────────────────

let idCounter = 0;

export function allocNodeId(): NodeId {
  return `n${++idCounter}`;
}

/** Seed the module counter (keeps ids reproducible across parse batches). */
export function seedIdCounter(next: number): void {
  idCounter = Math.max(idCounter, next);
}

/** Reset to 0 — parse() calls this so ids are deterministic per document. */
export function resetIdCounter(): void {
  idCounter = 0;
}

export function currentIdCounter(): number {
  return idCounter;
}

// ── parser ───────────────────────────────────────────────────────────────────

export function parseSource(src: string): ParseOutput {
  const issues: ParseIssue[] = [];
  const stack: OpenElement[] = [];
  let pos = 0;
  let size = 0;

  const root: DocumentNode = {
    kind: 'document',
    id: 'doc',
    parentId: null,
    range: { start: 0, end: src.length },
    children: [],
  };

  const top = (): OpenElement | undefined => stack[stack.length - 1];
  const parentId = (): NodeId => {
    const t = top();
    return t ? t.node.id : root.id;
  };

  const attach = (node: EditorNode): void => {
    const t = top();
    if (t) t.node.children.push(node);
    else root.children.push(node);
  };

  const emitText = (raw: string, start: number, mode: 'normal' | 'raw'): void => {
    if (raw.length === 0) return;
    size++;
    if (mode === 'raw') {
      const node: TextNode = {
        kind: 'text',
        id: allocNodeId(),
        parentId: parentId(),
        range: { start, end: start + raw.length },
        value: raw,
        raw,
        edited: false,
        mode,
      };
      attach(node);
      return;
    }
    const decoded = decodeEntities(raw, start);
    issues.push(...decoded.issues);
    const node: TextNode = {
      kind: 'text',
      id: allocNodeId(),
      parentId: parentId(),
      range: { start, end: start + raw.length },
      value: decoded.value,
      raw,
      edited: false,
      mode,
    };
    attach(node);
  };

  /** Raw-text body goes directly into `element` (never the stack top). */
  const emitRawInto = (element: ElementNode, raw: string, start: number): void => {
    if (raw.length === 0) return;
    size++;
    element.children.push({
      kind: 'text',
      id: allocNodeId(),
      parentId: element.id,
      range: { start, end: start + raw.length },
      value: raw,
      raw,
      edited: false,
      mode: 'raw',
    });
  };

  /** Implicitly close same-name elements before `name` opens. */
  const autoCloseFor = (name: string): void => {
    while (stack.length > 0) {
      const t = top()!;
      if (AUTO_CLOSE_SAME.has(t.node.name.toLowerCase()) && t.node.name.toLowerCase() === name) {
        stack.pop();
        issues.push({
          code: 'implicit-nesting',
          severity: 'warning',
          message: `<${t.node.name}> implicitly closed by <${name}>`,
          range: { start: t.contentStart, end: t.contentStart },
        });
        finalizeRange(t.node, pos);
      } else break;
    }
  };

  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    if (lt === -1) {
      emitText(src.slice(pos), pos, 'normal');
      break;
    }
    if (lt > pos) emitText(src.slice(pos, lt), pos, 'normal');

    const next = src[lt + 1];

    // ── markup declarations: comment / doctype / CDATA ──
    if (next === '!') {
      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        const node: CommentNode = {
          kind: 'comment',
          id: allocNodeId(),
          parentId: parentId(),
          range: { start: lt, end: end === -1 ? src.length : end + 3 },
          value: src.slice(lt + 4, end === -1 ? src.length : end),
        };
        size++;
        attach(node);
        if (end === -1) {
          issues.push({
            code: 'unexpected-eof',
            severity: 'error',
            message: 'unterminated comment',
            range: { start: lt, end: src.length },
          });
        }
        pos = end === -1 ? src.length : end + 3;
        continue;
      }
      if (src.startsWith('<![CDATA[', lt)) {
        const end = src.indexOf(']]>', lt + 9);
        const node: CdataNode = {
          kind: 'cdata',
          id: allocNodeId(),
          parentId: parentId(),
          range: { start: lt, end: end === -1 ? src.length : end + 3 },
          value: src.slice(lt + 9, end === -1 ? src.length : end),
        };
        size++;
        attach(node);
        if (end === -1) {
          issues.push({
            code: 'unexpected-eof',
            severity: 'error',
            message: 'unterminated CDATA section',
            range: { start: lt, end: src.length },
          });
        }
        pos = end === -1 ? src.length : end + 3;
        continue;
      }
      // <!doctype …> (or an unknown declaration — recorded, kept verbatim)
      const gt = findTagEnd(src, lt);
      const end = gt === -1 ? src.length : gt + 1;
      const inner = src.slice(lt + 2, gt === -1 ? src.length : gt);
      if (gt !== -1 && !/^doctype[\s>]/i.test(inner)) {
        issues.push({
          code: 'invalid-doctype',
          severity: 'error',
          message: `unrecognized markup declaration <!${inner.slice(0, 24)}>`,
          range: { start: lt, end },
        });
      } else if (gt === -1) {
        issues.push({
          code: 'unexpected-eof',
          severity: 'error',
          message: 'unterminated markup declaration',
          range: { start: lt, end },
        });
      }
      const node: DoctypeNode = {
        kind: 'doctype',
        id: allocNodeId(),
        parentId: parentId(),
        range: { start: lt, end },
        value: inner,
      };
      size++;
      attach(node);
      pos = end;
      continue;
    }

    // ── processing instruction / XML declaration ──
    if (next === '?') {
      const end = src.indexOf('?>', lt + 2);
      const body = src.slice(lt + 2, end === -1 ? src.length : end);
      const m = /^([\w:.-]+)\s*/.exec(body);
      const node: ProcessingInstructionNode = {
        kind: 'pi',
        id: allocNodeId(),
        parentId: parentId(),
        range: { start: lt, end: end === -1 ? src.length : end + 2 },
        target: m ? m[1] : '',
        value: m ? body.slice(m[0].length) : body,
      };
      size++;
      attach(node);
      if (end === -1) {
        issues.push({
          code: 'unexpected-eof',
          severity: 'error',
          message: 'unterminated processing instruction',
          range: { start: lt, end: src.length },
        });
      }
      pos = end === -1 ? src.length : end + 2;
      continue;
    }

    // ── close tag ──
    if (next === '/') {
      const gt = src.indexOf('>', lt + 2);
      if (gt === -1) {
        issues.push({
          code: 'unexpected-eof',
          severity: 'error',
          message: 'unterminated close tag',
          range: { start: lt, end: src.length },
        });
        emitText(src.slice(lt), lt, 'normal');
        pos = src.length;
        continue;
      }
      const seg = src.slice(lt + 2, gt);
      const cm = /^(\s*)([\w:.-]*)\s*$/.exec(seg);
      const closeName = cm ? cm[2] : '';
      let idx = -1;
      if (closeName !== '') {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].node.name.toLowerCase() === closeName.toLowerCase()) {
            idx = i;
            break;
          }
        }
      }
      if (idx === -1) {
        issues.push({
          code: 'stray-close',
          severity: 'error',
          message: `</${closeName || '…'}> has no matching open tag — dropped`,
          range: { start: lt, end: gt + 1 },
        });
        pos = gt + 1;
        continue;
      }
      // auto-close everything above the match
      for (let i = stack.length - 1; i > idx; i--) {
        const dropped = stack.pop()!;
        issues.push({
          code: 'mismatched-close',
          severity: 'error',
          message: `</${closeName}> closes <${dropped.node.name}> — auto-closed`,
          range: { start: dropped.node.range.start, end: lt },
        });
        finalizeRange(dropped.node, lt);
      }
      const open = stack.pop()!;
      open.node.closeTag = {
        name: cm![2] !== '' ? cm![2] : open.node.name,
        preName: cm![1],
        preGt: seg.slice(cm![1].length + cm![2].length),
        range: { start: lt, end: gt + 1 },
      };
      finalizeRange(open.node, gt + 1);
      pos = gt + 1;
      continue;
    }

    // ── open tag ──
    const nameMatch = /^<([a-zA-Z][\w:.-]*)/.exec(src.slice(lt, lt + 512));
    if (!nameMatch) {
      // literal `<` in text (e.g. `a < b` in XHTML — invalid but recoverable)
      issues.push({
        code: 'invalid-char',
        severity: 'warning',
        message: `bare '<' treated as text`,
        range: { start: lt, end: lt + 1 },
      });
      let runEnd = src.indexOf('<', lt + 1);
      if (runEnd === -1) runEnd = src.length;
      emitText(src.slice(lt, runEnd), lt, 'normal');
      pos = runEnd;
      continue;
    }

    const name = nameMatch[1];
    autoCloseFor(name.toLowerCase());

    const { attrs, end: tagEnd, selfClosing, preGt } = parseAttrs(src, lt + 1 + name.length, issues);
    const lower = name.toLowerCase();
    const rawText = RAW_TEXT.has(lower);
    const voidEl = VOID.has(lower);
    const element: ElementNode = {
      kind: 'element',
      id: allocNodeId(),
      parentId: parentId(),
      range: { start: lt, end: tagEnd },
      name,
      attrs,
      children: [],
      selfClosing,
      preGt,
      closeTag: null,
    };
    size++;
    attach(element);

    if (selfClosing || voidEl) {
      pos = tagEnd;
      continue;
    }
    if (rawText) {
      pos = parseRawText(src, element, tagEnd, issues, (raw, start) =>
        emitRawInto(element, raw, start),
      );
      continue;
    }
    stack.push({ node: element, contentStart: tagEnd });
    pos = tagEnd;
  }

  // EOF: auto-close whatever is still open
  while (stack.length > 0) {
    const open = stack.pop()!;
    issues.push({
      code: 'unclosed-tag',
      severity: 'error',
      message: `<${open.node.name}> is never closed`,
      range: { start: open.node.range.start, end: src.length },
    });
    finalizeRange(open.node, src.length);
  }

  root.range = { start: 0, end: src.length };
  return { root, issues, size, nextId: idCounter + 1 };
}

function finalizeRange(node: ElementNode, end: number): void {
  node.range = { start: node.range.start, end };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type EmitTextFn = (raw: string, start: number, mode: 'normal' | 'raw') => void;

/** Consume raw-text content of `element` (script/style) up to its close tag.
 *  Returns the offset just past the close tag (or src.length). */
function parseRawText(
  src: string,
  element: ElementNode,
  contentStart: number,
  issues: ParseIssue[],
  emitInto: (raw: string, start: number) => void,
): number {
  const closeRe = new RegExp(`</${escapeRe(element.name)}\\s*>`, 'i');
  const m = closeRe.exec(src.slice(contentStart));
  if (!m) {
    issues.push({
      code: 'unclosed-tag',
      severity: 'error',
      message: `<${element.name}> has no close tag — raw text runs to EOF`,
      range: { start: element.range.start, end: src.length },
    });
    emitInto(src.slice(contentStart), contentStart);
    finalizeRange(element, src.length);
    return src.length;
  }
  const bodyEnd = contentStart + m.index;
  emitInto(src.slice(contentStart, bodyEnd), contentStart);
  const closeEnd = bodyEnd + m[0].length;
  const seg = src.slice(bodyEnd + 2, closeEnd - 1);
  const cm = /^(\s*)([\w:.-]*)\s*$/.exec(seg);
  element.closeTag = {
    name: cm && cm[2] !== '' ? cm[2] : element.name,
    preName: cm ? cm[1] : '',
    preGt: cm ? seg.slice(cm[1].length + cm[2].length) : seg,
    range: { start: bodyEnd, end: closeEnd },
  };
  finalizeRange(element, closeEnd);
  return closeEnd;
}

/** Find the `>` ending a declaration (respects quoted values inside). */
function findTagEnd(src: string, from: number): number {
  let q: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

interface AttrsResult {
  attrs: ElementNode['attrs'];
  /** Offset just past `>` or `/>`. */
  end: number;
  selfClosing: boolean;
  preGt: string;
}

/** Parse attributes from `start` (just after the tag name) to the tag's
 *  `>`/`/>`. Malformed attributes are skipped with a `bad-attr` issue. */
function parseAttrs(src: string, start: number, issues: ParseIssue[]): AttrsResult {
  const attrs: ElementNode['attrs'] = [];
  let i = start;
  for (;;) {
    const wsStart = i;
    while (i < src.length && /\s/.test(src[i])) i++;
    const ws = src.slice(wsStart, i);
    if (i >= src.length) return { attrs, end: src.length, selfClosing: false, preGt: ws };
    if (src[i] === '>') return { attrs, end: i + 1, selfClosing: false, preGt: ws };
    if (src[i] === '/' && src[i + 1] === '>') {
      return { attrs, end: i + 2, selfClosing: true, preGt: ws };
    }
    const nameStart = i;
    while (i < src.length && /[\w:.-]/.test(src[i])) i++;
    if (i === nameStart) {
      issues.push({
        code: 'bad-attr',
        severity: 'warning',
        message: `unexpected ${JSON.stringify(src[i])} in tag — skipped`,
        range: { start: i, end: i + 1 },
      });
      i++;
      continue;
    }
    const name = src.slice(nameStart, i);
    let value: string | null = null;
    let rawValue: string | null = null;
    let quote: '"' | "'" | '' = '';
    let end = i;
    let j = i;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '=') {
      let k = j + 1;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === '"' || src[k] === "'") {
        quote = src[k] as '"' | "'";
        const vStart = k + 1;
        const vEnd = src.indexOf(quote, vStart);
        if (vEnd === -1) {
          issues.push({
            code: 'bad-attr',
            severity: 'error',
            message: `attribute ${name} has an unterminated value — runs to EOF`,
            range: { start: nameStart, end: src.length },
          });
          const d = decodeEntities(src.slice(vStart), vStart);
          issues.push(...d.issues);
          rawValue = src.slice(vStart);
          value = d.value;
          end = src.length;
        } else {
          const d = decodeEntities(src.slice(vStart, vEnd), vStart);
          issues.push(...d.issues);
          rawValue = src.slice(vStart, vEnd);
          value = d.value;
          end = vEnd + 1;
        }
      } else {
        const vStart = k;
        while (k < src.length && !/[\s>]/.test(src[k])) k++;
        if (k === vStart) {
          issues.push({
            code: 'bad-attr',
            severity: 'warning',
            message: `attribute ${name} has no value after '=' — treated as bare`,
            range: { start: nameStart, end: j + 1 },
          });
          end = j + 1;
        } else {
          const d = decodeEntities(src.slice(vStart, k), vStart);
          issues.push(...d.issues);
          rawValue = src.slice(vStart, k);
          value = d.value;
          quote = '';
          end = k;
        }
      }
    }
    attrs.push({ name, value, rawValue, quote, pre: ws, range: { start: nameStart, end } });
    i = end;
  }
}
