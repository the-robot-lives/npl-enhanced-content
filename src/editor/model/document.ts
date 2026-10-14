/**
 * EditorDocument — the live, editable XHTML document (types.ts contract).
 *
 * Owns: the node table (id → node), the edit ops with model-computed
 * inverses, transaction batching with coalescing, one undo/redo stack, the
 * change-event stream, and source↔model position mapping (entity-aware).
 *
 * Undo is byte-exact: inverses of trivia-losing ops are the model-internal
 * `restoreAttr`/`restoreText` ops, which put the authored spelling back.
 * Each op application returns the ops that undo it; a transaction's inverse
 * is its ops' inverses in reverse order.
 */

import { NAMED_ENTITIES } from './entities.js';
import { allocNodeId, parseSource, resetIdCounter } from './parse.js';
import { DEFAULT_STYLE, emitDocument, emitSubtree } from './serialize.js';
import {
  ModelError,
  VOID_ELEMENTS,
  type AttrNode,
  type ChangeEvent,
  type DocEvent,
  type DocPos,
  type DocumentNode,
  type EditOp,
  type EditorDocument,
  type EditorNode,
  type ElementNode,
  type ElementSpec,
  type HistoryChangeEvent,
  type HistoryEntry,
  type NodeId,
  type ParseIssue,
  type ParseResult,
  type SerializeStyle,
  type SourceRange,
  type TextNode,
  type Transaction,
  type TransactionBuilder,
  type TransactionOptions,
  type TransactionSpan,
  type Unsubscribe,
} from './types.js';

/** A tree node including the document root. */
type AnyNode = DocumentNode | EditorNode;

const VOID = new Set(VOID_ELEMENTS);

/** Coalesce window for typing transactions (ms). */
const COALESCE_MS = 700;

interface UndoEntry {
  transaction: Transaction;
  coalesceKey: string | null;
  at: number;
}

export class EditorDocumentImpl implements EditorDocument {
  source: string;
  root: DocumentNode;
  version = 0;
  issues: ParseIssue[] = [];
  private nodes = new Map<NodeId, AnyNode>();
  private listeners = new Map<string, Set<(e: DocEvent) => void>>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private txCounter = 0;

  constructor(source: string, root: DocumentNode, issues: ParseIssue[]) {
    this.source = source;
    this.root = root;
    this.issues = issues;
    indexSubtree(root, this.nodes);
  }

  // ── reads ──
  node(id: NodeId): EditorNode | undefined {
    const n = this.nodes.get(id);
    return n && n.kind !== 'document' ? n : undefined;
  }

  parentOf(id: NodeId): ElementNode | null {
    const n = this.nodes.get(id);
    if (!n || n.parentId === null) return null;
    const p = this.nodes.get(n.parentId);
    return p && p.kind === 'element' ? p : null;
  }

  childrenOf(id: NodeId): readonly EditorNode[] {
    const n = this.nodes.get(id);
    if (!n) return [];
    if (n.kind === 'element' || n.kind === 'document') return n.children;
    return [];
  }

  ancestorsOf(id: NodeId): ElementNode[] {
    const out: ElementNode[] = [];
    let p = this.parentOf(id);
    while (p) {
      out.push(p);
      p = this.parentOf(p.id);
    }
    return out;
  }

  indexOf(id: NodeId): number {
    const p = this.parentOf(id);
    if (!p) return -1;
    return p.children.findIndex((c) => c.id === id);
  }

  textOf(id: NodeId): string {
    const n = this.nodes.get(id);
    if (!n) return '';
    if (n.kind === 'text') return n.value;
    if (n.kind === 'element' || n.kind === 'document') {
      return n.children.map((c) => this.textOf(c.id)).join('');
    }
    if (n.kind === 'comment' || n.kind === 'cdata') return n.value;
    return '';
  }

  elementAtOffset(offset: number): ElementNode | null {
    let best: ElementNode | null = null;
    const walk = (n: AnyNode): void => {
      if (offset < n.range.start || offset > n.range.end) return;
      if (n.kind === 'element') best = n;
      if (n.kind === 'element' || n.kind === 'document') {
        for (const c of n.children) walk(c);
      }
    };
    walk(this.root);
    return best;
  }

  contains(ancestor: NodeId, id: NodeId): boolean {
    if (ancestor === id) return true;
    let cur = this.nodes.get(id);
    while (cur && cur.parentId !== null) {
      if (cur.parentId === ancestor) return true;
      cur = this.nodes.get(cur.parentId);
    }
    return false;
  }

  // ── validation ──
  canApply(op: EditOp): { ok: boolean; reason?: string } {
    return checkOp(this, op);
  }

  // ── editing ──
  apply(op: EditOp, opts?: TransactionOptions): Transaction {
    checkOrThrow(this, op);
    const span = this.openTransaction(`apply:${op.type}`, opts);
    span.push(op);
    return span.commit();
  }

  transaction<T>(
    label: string,
    fn: (tx: TransactionBuilder) => T,
    opts?: TransactionOptions,
  ): T {
    const span = this.openTransaction(label, opts);
    try {
      const result = fn(span);
      span.commit();
      return result;
    } catch (err) {
      span.abort();
      throw err;
    }
  }

  openTransaction(label: string, opts?: TransactionOptions): TransactionSpan {
    const impl = this;
    const applied: { op: EditOp; inverses: EditOp[] }[] = [];
    const touched = new Set<NodeId>();
    let state: 'open' | 'committed' | 'aborted' = 'open';

    const span: TransactionSpan = {
      push(op: EditOp): void {
        if (state !== 'open') throw new ModelError(op, 'transaction already closed');
        checkOrThrow(impl, op);
        const inverses = applyAndInvert(impl, op);
        applied.push({ op, inverses });
        for (const id of touchedIds(op)) touched.add(id);
        for (const inv of inverses) {
          if (op.type === 'wrap' && inv.type === 'unwrap') touched.add(inv.node);
          if (op.type === 'replaceSubtree' && inv.type === 'removeNode') touched.add(inv.node);
        }
      },
      get touched(): readonly NodeId[] {
        return [...touched];
      },
      get committed(): boolean {
        return state === 'committed';
      },
      commit(): Transaction {
        if (state !== 'open') throw new Error('model: transaction already closed');
        state = 'committed';
        const beforeVersion = impl.version;
        impl.version++;
        const tx: Transaction = {
          id: ++impl.txCounter,
          label,
          ops: applied.map((a) => a.op),
          inverse: applied
            .slice()
            .reverse()
            .flatMap((a) => a.inverses),
          beforeVersion,
          afterVersion: impl.version,
          touched: [...touched],
        };
        impl.recordUndo(tx, opts?.coalesce ?? null);
        if (!opts?.silent) {
          impl.emit({ type: 'change', doc: impl, transaction: tx, version: impl.version });
        }
        return tx;
      },
      abort(): void {
        if (state !== 'open') return;
        state = 'aborted';
        for (let i = applied.length - 1; i >= 0; i--) {
          for (const inv of applied[i].inverses) applyOp(impl, inv);
        }
      },
    };
    return span;
  }

  createElement(spec: ElementSpec): ElementNode {
    const children = spec.children ?? [];
    const el: ElementNode = {
      kind: 'element',
      id: allocNodeId(),
      parentId: null,
      range: { start: 0, end: 0 },
      name: spec.tag,
      attrs: (spec.attrs ?? []).map((a) => ({
        name: a.name,
        value: a.value ?? null,
        rawValue: null,
        quote: (a.value ?? null) === null ? '' : '"',
        pre: ' ',
        range: { start: 0, end: 0 },
      })),
      children,
      selfClosing: VOID.has(spec.tag.toLowerCase()),
      preGt: '',
      closeTag: null,
    };
    for (const c of children) c.parentId = el.id;
    return el;
  }

  createText(value: string, mode: 'normal' | 'raw' = 'normal'): TextNode {
    return {
      kind: 'text',
      id: allocNodeId(),
      parentId: null,
      range: { start: 0, end: 0 },
      value,
      raw: value,
      edited: true, // edited baseline → serializer escapes `value` on emit
      mode,
    };
  }

  // ── history ──
  private recordUndo(tx: Transaction, coalesceKey: string | null): void {
    this.redoStack = [];
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (
      coalesceKey !== null &&
      last &&
      last.coalesceKey === coalesceKey &&
      now - last.at <= COALESCE_MS
    ) {
      last.transaction = {
        ...last.transaction,
        label: coalesceKey,
        ops: [...last.transaction.ops, ...tx.ops],
        inverse: [...tx.inverse, ...last.transaction.inverse],
        afterVersion: tx.afterVersion,
        touched: [...new Set([...last.transaction.touched, ...tx.touched])],
      };
      last.at = now;
    } else {
      this.undoStack.push({ transaction: tx, coalesceKey, at: now });
    }
    this.emit({ type: 'history', doc: this, canUndo: true, canRedo: false });
  }

  /** Synthetic change transaction for undo/redo (no new history entry). */
  private synthetic(label: string, ops: EditOp[], touched: NodeId[]): Transaction {
    const beforeVersion = this.version;
    this.version++;
    return {
      id: ++this.txCounter,
      label,
      ops,
      inverse: [],
      beforeVersion,
      afterVersion: this.version,
      touched,
    };
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const { inverse, ops, touched } = entry.transaction;
    for (const op of inverse) applyOp(this, op);
    this.redoStack.push(entry);
    const tx = this.synthetic(`undo:${entry.transaction.label}`, inverse, touched);
    this.emit({ type: 'change', doc: this, transaction: tx, version: this.version });
    this.emit({ type: 'history', doc: this, canUndo: this.canUndo(), canRedo: true });
    void ops;
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const { ops, touched } = entry.transaction;
    for (const op of ops) applyOp(this, op);
    this.undoStack.push(entry);
    const tx = this.synthetic(`redo:${entry.transaction.label}`, ops, touched);
    this.emit({ type: 'change', doc: this, transaction: tx, version: this.version });
    this.emit({ type: 'history', doc: this, canUndo: true, canRedo: this.canRedo() });
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  history(): readonly HistoryEntry[] {
    // chronological: applied entries, then undone entries (oldest first)
    const combined: { e: UndoEntry; undone: boolean }[] = [
      ...this.undoStack.map((e) => ({ e, undone: false })),
      ...[...this.redoStack].reverse().map((e) => ({ e, undone: true })),
    ];
    return combined.map(({ e, undone }, i) => ({
      id: e.transaction.id,
      label: e.transaction.label,
      ops: e.transaction.ops.length,
      depth: combined.length - 1 - i,
      undone,
    }));
  }

  clearHistory(): void {
    const had = this.undoStack.length > 0 || this.redoStack.length > 0;
    this.undoStack = [];
    this.redoStack = [];
    if (had) {
      this.emit({ type: 'history', doc: this, canUndo: false, canRedo: false });
    }
  }

  // ── output ──
  serialize(style?: Partial<SerializeStyle>): string {
    const merged: SerializeStyle = { ...DEFAULT_STYLE, ...style };
    this.source = emitDocument(this, merged);
    return this.source;
  }

  serializeSubtree(id: NodeId, style?: Partial<SerializeStyle>): string {
    const merged: SerializeStyle = { ...DEFAULT_STYLE, ...style };
    const n = this.nodes.get(id);
    if (!n) throw new ModelError({ type: 'removeNode', node: id }, 'unknown node');
    return emitSubtree(n, merged);
  }

  // ── selection mapping ──
  posToOffset(pos: DocPos): number | null {
    const n = this.nodes.get(pos.node);
    if (!n) return null;
    if (n.kind === 'document') return clamp(pos.offset, 0, this.source.length);
    switch (n.kind) {
      case 'text': {
        if (n.mode === 'raw') {
          return n.range.start + clamp(pos.offset, 0, n.raw.length);
        }
        const k = clamp(pos.offset, 0, n.value.length);
        const raw = mapDecodedToRaw(n.raw, k);
        return raw === null ? null : n.range.start + raw;
      }
      case 'element': {
        const idx = clamp(pos.offset, 0, n.children.length);
        if (idx < n.children.length) return n.children[idx].range.start;
        if (n.children.length > 0) return n.children[n.children.length - 1].range.end;
        return n.range.start + openTagLength(n);
      }
      case 'comment':
        return clamp(n.range.start + 4 + pos.offset, n.range.start, n.range.end);
      case 'cdata':
        return clamp(n.range.start + 9 + pos.offset, n.range.start, n.range.end);
      case 'pi':
        return clamp(
          n.range.start + 2 + n.target.length + pos.offset,
          n.range.start,
          n.range.end,
        );
      case 'doctype':
        return clamp(n.range.start + 2 + pos.offset, n.range.start, n.range.end);
    }
  }

  offsetToPos(offset: number): DocPos | null {
    if (offset < 0 || offset > this.source.length) return null;
    let container: AnyNode = this.root;
    descend: for (;;) {
      if (container.kind !== 'element' && container.kind !== 'document') break;
      const kids: readonly EditorNode[] = container.children;
      if (kids.length === 0) break descend;
      let i = kids.length - 1;
      while (i >= 0 && kids[i].range.start > offset) i--;
      if (i < 0) return { node: container.id, offset: 0 };
      const child: EditorNode = kids[i];
      if (offset < child.range.end) {
        container = child;
        continue;
      }
      return { node: container.id, offset: i + 1 };
    }
    const n = container;
    switch (n.kind) {
      case 'document':
      case 'element':
        return { node: n.id, offset: n.children.length };
      case 'text': {
        const rawOffset = clamp(offset - n.range.start, 0, n.raw.length);
        const decoded = n.mode === 'raw' ? rawOffset : mapRawToDecoded(n.raw, rawOffset);
        return { node: n.id, offset: decoded };
      }
      case 'comment':
        return { node: n.id, offset: clamp(offset - n.range.start - 4, 0, n.value.length) };
      case 'cdata':
        return { node: n.id, offset: clamp(offset - n.range.start - 9, 0, n.value.length) };
      case 'pi':
        return {
          node: n.id,
          offset: clamp(offset - n.range.start - 2 - n.target.length, 0, n.value.length),
        };
      case 'doctype':
        return { node: n.id, offset: clamp(offset - n.range.start - 2, 0, n.value.length) };
    }
  }

  rangeOf(id: NodeId): SourceRange | undefined {
    return this.nodes.get(id)?.range;
  }

  // ── events ──
  on(event: 'change', cb: (e: ChangeEvent) => void): Unsubscribe;
  on(event: 'history', cb: (e: HistoryChangeEvent) => void): Unsubscribe;
  on(event: '*', cb: (e: DocEvent) => void): Unsubscribe;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose impl; callers use the overloads
  on(event: string, cb: (e: never) => void): Unsubscribe {
    const handler = cb as (e: DocEvent) => void;
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  private emit(e: DocEvent): void {
    const specific = this.listeners.get(e.type);
    const star = this.listeners.get('*');
    for (const cb of specific ?? []) cb(e);
    for (const cb of star ?? []) cb(e);
  }

  // ── snapshots ──
  clone(): EditorDocument {
    const cloned = cloneNode(this.root) as DocumentNode;
    const copy = new EditorDocumentImpl(this.source, cloned, this.issues.map((i) => ({ ...i })));
    copy.version = this.version;
    return copy;
  }

  // ── internals ──
  /** @internal node table for the op layer */
  table(): Map<NodeId, AnyNode> {
    return this.nodes;
  }
}

// ── op layer ─────────────────────────────────────────────────────────────────

function checkOp(doc: EditorDocumentImpl, op: EditOp): { ok: boolean; reason?: string } {
  const table = doc.table();
  switch (op.type) {
    case 'insertNode':
    case 'moveNode': {
      const p = table.get(op.parent);
      if (!p) return { ok: false, reason: `unknown parent ${op.parent}` };
      if (p.kind !== 'element' && p.kind !== 'document') {
        return { ok: false, reason: `parent ${op.parent} is a ${p.kind}, not an element` };
      }
      const count = p.kind === 'element' || p.kind === 'document' ? p.children.length : 0;
      if (op.index < 0 || op.index > count) {
        return { ok: false, reason: `index ${op.index} out of bounds (0..${count})` };
      }
      if (op.type === 'moveNode') {
        const n = table.get(op.node);
        if (!n) return { ok: false, reason: `unknown node ${op.node}` };
        if (doc.contains(op.node, op.parent)) {
          return { ok: false, reason: 'cannot move a node into its own subtree' };
        }
      } else if (table.has(op.node.id)) {
        return { ok: false, reason: `node ${op.node.id} is already attached` };
      }
      return { ok: true };
    }
    case 'removeNode': {
      const n = table.get(op.node);
      if (!n) return { ok: false, reason: `unknown node ${op.node}` };
      if (n.parentId === null) return { ok: false, reason: 'cannot remove the root' };
      return { ok: true };
    }
    case 'setAttr':
    case 'removeAttr': {
      const n = table.get(op.node);
      if (!n || n.kind !== 'element') {
        return { ok: false, reason: `node ${op.node} is not an element` };
      }
      return { ok: true };
    }
    case 'setText':
    case 'restoreText': {
      const n = table.get(op.node);
      if (!n || n.kind !== 'text') {
        return { ok: false, reason: `node ${op.node} is not a text node` };
      }
      return { ok: true };
    }
    case 'restoreAttr': {
      const n = table.get(op.node);
      if (!n || n.kind !== 'element') {
        return { ok: false, reason: `node ${op.node} is not an element` };
      }
      if (op.index < 0 || op.index > n.attrs.length) {
        return { ok: false, reason: `attr index ${op.index} out of bounds` };
      }
      return { ok: true };
    }
    case 'wrap':
    case 'unwrap': {
      const n = table.get(op.node);
      if (!n) return { ok: false, reason: `unknown node ${op.node}` };
      if (n.parentId === null) return { ok: false, reason: 'cannot wrap/unwrap the root' };
      if (op.type === 'unwrap' && n.kind !== 'element') {
        return { ok: false, reason: 'unwrap targets an element' };
      }
      return { ok: true };
    }
    case 'replaceSubtree': {
      const n = table.get(op.node);
      if (!n) return { ok: false, reason: `unknown node ${op.node}` };
      if (n.parentId === null) return { ok: false, reason: 'cannot replace the root' };
      if (table.has(op.replacement.id)) {
        return { ok: false, reason: `replacement ${op.replacement.id} is already attached` };
      }
      return { ok: true };
    }
  }
}

function checkOrThrow(doc: EditorDocumentImpl, op: EditOp): void {
  const check = checkOp(doc, op);
  if (!check.ok) throw new ModelError(op, check.reason ?? 'rejected');
}

/** Apply `op` and return the ops that undo it (byte-exact). */
function applyAndInvert(doc: EditorDocumentImpl, op: EditOp): EditOp[] {
  const table = doc.table();
  switch (op.type) {
    case 'insertNode': {
      const p = table.get(op.parent) as ElementNode;
      adopt(doc, op.node, p.id);
      p.children.splice(op.index, 0, op.node);
      return [{ type: 'removeNode', node: op.node.id }];
    }
    case 'removeNode': {
      const n = table.get(op.node) as EditorNode;
      const p = table.get(n.parentId!) as ElementNode;
      const idx = p.children.findIndex((c) => c.id === n.id);
      p.children.splice(idx, 1);
      detach(doc, n);
      return [{ type: 'insertNode', parent: p.id, index: idx, node: n }];
    }
    case 'moveNode': {
      const n = table.get(op.node) as EditorNode;
      const prev = table.get(n.parentId!) as ElementNode;
      const prevIdx = prev.children.findIndex((c) => c.id === n.id);
      let idx = op.index;
      prev.children.splice(prevIdx, 1);
      if (prev.id === op.parent && prevIdx < idx) idx--;
      const next = table.get(op.parent) as ElementNode;
      next.children.splice(idx, 0, n);
      n.parentId = op.parent;
      return [{ type: 'moveNode', node: op.node, parent: prev.id, index: prevIdx }];
    }
    case 'setAttr': {
      const el = table.get(op.node) as ElementNode;
      const existing = findAttr(el.attrs, op.name);
      if (existing) {
        const inverse: EditOp = {
          type: 'restoreAttr',
          node: op.node,
          attr: { ...existing },
          index: el.attrs.indexOf(existing),
        };
        existing.value = op.value;
        existing.rawValue = null;
        if (op.value !== null && existing.quote === '') existing.quote = '"';
        if (op.value === null) existing.quote = '';
        return [inverse];
      }
      el.attrs.push({
        name: op.name,
        value: op.value,
        rawValue: null,
        quote: op.value === null ? '' : '"',
        pre: ' ',
        range: { start: 0, end: 0 },
      });
      return [{ type: 'removeAttr', node: op.node, name: op.name }];
    }
    case 'removeAttr': {
      const el = table.get(op.node) as ElementNode;
      const lower = op.name.toLowerCase();
      const inverses: EditOp[] = [];
      el.attrs = el.attrs.filter((a, i) => {
        if (a.name.toLowerCase() === lower) {
          inverses.push({ type: 'restoreAttr', node: op.node, attr: { ...a }, index: i });
          return false;
        }
        return true;
      });
      return inverses;
    }
    case 'setText': {
      const n = table.get(op.node) as TextNode;
      const inverse: EditOp = {
        type: 'restoreText',
        node: op.node,
        value: n.value,
        raw: n.raw,
        edited: n.edited,
      };
      n.value = op.value;
      n.edited = true;
      return [inverse];
    }
    case 'restoreText': {
      const n = table.get(op.node) as TextNode;
      const inverse: EditOp = {
        type: 'restoreText',
        node: op.node,
        value: n.value,
        raw: n.raw,
        edited: n.edited,
      };
      n.value = op.value;
      n.raw = op.raw;
      n.edited = op.edited;
      return [inverse];
    }
    case 'restoreAttr': {
      const el = table.get(op.node) as ElementNode;
      const at = el.attrs[op.index];
      const same = at !== undefined && at.name.toLowerCase() === op.attr.name.toLowerCase();
      const inverse: EditOp = same
        ? { type: 'restoreAttr', node: op.node, attr: { ...at }, index: op.index }
        : { type: 'removeAttr', node: op.node, name: op.attr.name };
      if (same) el.attrs.splice(op.index, 1, op.attr);
      else el.attrs.splice(op.index, 0, op.attr);
      return [inverse];
    }
    case 'wrap': {
      const n = table.get(op.node) as EditorNode;
      const p = table.get(n.parentId!) as ElementNode;
      const idx = p.children.findIndex((c) => c.id === n.id);
      const wrapper = doc.createElement({
        tag: op.wrapper.tag,
        attrs: op.wrapper.attrs,
        children: [n, ...(op.wrapper.children ?? [])],
      });
      adopt(doc, wrapper, p.id);
      p.children.splice(idx, 1, wrapper);
      return [{ type: 'unwrap', node: wrapper.id }];
    }
    case 'unwrap': {
      const el = table.get(op.node) as ElementNode;
      const p = table.get(el.parentId!) as ElementNode;
      const idx = p.children.findIndex((c) => c.id === el.id);
      const kids = [...el.children];
      el.children = []; // kids MOVE out — single-parenting stays exact
      for (const k of kids) k.parentId = p.id;
      p.children.splice(idx, 1, ...kids);
      detach(doc, el);
      // Inverse: re-insert the (now empty) wrapper, then move the kids back
      // into it — redo replays these and reproduces the same tree.
      return [
        { type: 'insertNode', parent: p.id, index: idx, node: el },
        ...kids.map((k, i): EditOp => ({ type: 'moveNode', node: k.id, parent: el.id, index: i })),
      ];
    }
    case 'replaceSubtree': {
      const n = table.get(op.node) as EditorNode;
      const p = table.get(n.parentId!) as ElementNode;
      const idx = p.children.findIndex((c) => c.id === n.id);
      adopt(doc, op.replacement, p.id);
      p.children.splice(idx, 1, op.replacement);
      detach(doc, n);
      return [
        { type: 'removeNode', node: op.replacement.id },
        { type: 'insertNode', parent: p.id, index: idx, node: n },
      ];
    }
  }
}

function applyOp(doc: EditorDocumentImpl, op: EditOp): void {
  applyAndInvert(doc, op);
}

function touchedIds(op: EditOp): NodeId[] {
  switch (op.type) {
    case 'insertNode':
      return [op.node.id, op.parent];
    case 'moveNode':
      return [op.node, op.parent];
    case 'wrap':
      return [op.node];
    case 'removeNode':
    case 'setAttr':
    case 'removeAttr':
    case 'setText':
    case 'restoreText':
    case 'restoreAttr':
    case 'unwrap':
    case 'replaceSubtree':
      return [op.node];
  }
}

// ── tree helpers ─────────────────────────────────────────────────────────────

function adopt(doc: EditorDocumentImpl, node: EditorNode, parentId: NodeId): void {
  node.parentId = parentId;
  indexSubtree(node, doc.table());
}

function detach(doc: EditorDocumentImpl, node: EditorNode): void {
  unindexSubtree(node, doc.table());
  node.parentId = null;
}

function indexSubtree(node: AnyNode, table: Map<NodeId, AnyNode>): void {
  table.set(node.id, node);
  if (node.kind === 'element' || node.kind === 'document') {
    for (const c of node.children) indexSubtree(c, table);
  }
}

function unindexSubtree(node: AnyNode, table: Map<NodeId, AnyNode>): void {
  table.delete(node.id);
  if (node.kind === 'element' || node.kind === 'document') {
    for (const c of node.children) unindexSubtree(c, table);
  }
}

function findAttr(attrs: AttrNode[], name: string): AttrNode | undefined {
  const lower = name.toLowerCase();
  return attrs.find((a) => a.name.toLowerCase() === lower);
}

function cloneNode(node: AnyNode): AnyNode {
  if (node.kind === 'document') {
    return {
      ...node,
      children: node.children.map((c) => cloneNode(c) as EditorNode),
    };
  }
  if (node.kind === 'element') {
    const el: ElementNode = {
      ...node,
      attrs: node.attrs.map((a) => ({ ...a })),
      children: node.children.map((c) => cloneNode(c) as EditorNode),
      closeTag: node.closeTag ? { ...node.closeTag } : null,
    };
    for (const c of el.children) c.parentId = el.id;
    return el;
  }
  return { ...node };
}

function openTagLength(el: ElementNode): number {
  let n = 1 + el.name.length + el.preGt.length;
  for (const a of el.attrs) {
    n += a.pre.length + attrLength(a);
  }
  n += el.selfClosing ? 2 : 1;
  return n;
}

function attrLength(a: AttrNode): number {
  if (a.value === null && a.rawValue === null) return a.name.length;
  if (a.rawValue !== null) {
    return a.quote === ''
      ? a.name.length + 1 + a.rawValue.length
      : a.name.length + 1 + a.rawValue.length + 2;
  }
  const q = a.quote === '' ? '"' : a.quote;
  return a.name.length + 1 + (a.value?.length ?? 0) + 2;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── decoded ↔ raw offset mapping (entity-aware) ──────────────────────────────

const ENTITY_SCAN = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** UTF-16 length of an entity's decoded character (unknown entities stay
 *  verbatim, so their length is unchanged). */
function decodedUnits(entity: string): number {
  const body = entity.slice(1, -1);
  let cp: number | undefined;
  if (body[0] === '#') {
    const hex = body[1] === 'x' || body[1] === 'X';
    const n = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (Number.isFinite(n) && n >= 0 && n <= 0x10ffff) cp = n;
  } else {
    const named = NAMED_ENTITIES[body];
    if (named !== undefined) cp = named.codePointAt(0);
  }
  if (cp === undefined) return entity.length; // kept verbatim
  return cp > 0xffff ? 2 : 1;
}

/** Map a decoded-value offset to a raw offset (null past the end). */
export function mapDecodedToRaw(raw: string, decodedOffset: number): number | null {
  let decodedIdx = 0;
  let rawIdx = 0;
  ENTITY_SCAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTITY_SCAN.exec(raw)) !== null) {
    const literal = m.index - rawIdx;
    if (decodedOffset <= decodedIdx + literal) return rawIdx + (decodedOffset - decodedIdx);
    decodedIdx += literal;
    rawIdx += literal;
    const units = decodedUnits(m[0]);
    if (decodedOffset < decodedIdx + units) return rawIdx; // rounds left inside the entity
    decodedIdx += units;
    rawIdx += m[0].length;
  }
  const literal = raw.length - rawIdx;
  if (decodedOffset <= decodedIdx + literal) return rawIdx + (decodedOffset - decodedIdx);
  return null;
}

/** Map a raw offset to a decoded-value offset (total; rounds left inside an
 *  entity). */
export function mapRawToDecoded(raw: string, rawOffset: number): number {
  let decodedIdx = 0;
  let rawIdx = 0;
  ENTITY_SCAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTITY_SCAN.exec(raw)) !== null) {
    const literal = m.index - rawIdx;
    if (rawOffset <= rawIdx + literal) return decodedIdx + (rawOffset - rawIdx);
    decodedIdx += literal;
    rawIdx += literal;
    const units = decodedUnits(m[0]);
    if (rawOffset < rawIdx + m[0].length) return decodedIdx; // inside the entity
    decodedIdx += units;
    rawIdx += m[0].length;
  }
  return decodedIdx + Math.max(0, rawOffset - rawIdx);
}

// ── entry points ─────────────────────────────────────────────────────────────

/** Parse `source` into a live document. Never throws; problems land in
 *  `doc.issues` (types.ts invariant 5). */
export function parse(source: string): EditorDocument {
  resetIdCounter();
  const out = parseSource(source);
  return new EditorDocumentImpl(source, out.root as DocumentNode, out.issues);
}

export function createDocument(source: string): EditorDocument {
  return parse(source);
}

/** Parse with a structured verdict. The failure case still carries the
 *  best-effort tree — the session decides whether to adopt it. */
export function tryParse(source: string): ParseResult {
  const doc = parse(source);
  const error = doc.issues.find((i) => i.severity === 'error');
  if (error) return { ok: false, doc, issues: [...doc.issues], error };
  return { ok: true, doc, issues: [...doc.issues] };
}
