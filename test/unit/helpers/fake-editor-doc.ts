/**
 * fake-editor-doc — a structural stand-in for `EditorDocument` (types.ts)
 * for shell-lane unit tests while LANE=model-core's implementation lands.
 *
 * Implements the slice the shell touches — tree reads, the six user ops
 * (setAttr/removeAttr/setText/insertNode/removeNode/moveNode), transactions
 * (one undo entry + one change event per commit, ModelError on rejection),
 * undo/redo, and the event registry — over a plain object tree. Selection
 * mapping, serialization fidelity and trivia preservation are out of scope;
 * Phase 3 integrate swaps in the real model and these tests keep passing
 * through the same interface.
 *
 * Id policy mirrors the contract: nodes built by `createElement` keep their
 * pre-assigned fresh id when inserted; `insertNode` of a node from another
 * document (not registered here) deep-copies it under a fresh id.
 */

import {
  ModelError,
  type ApplyCheck,
  type ChangeEvent,
  type DocEvent,
  type EditorDocument,
  type EditOp,
  type ElementNode,
  type ElementSpec,
  type HistoryChangeEvent,
  type HistoryEntry,
  type NodeId,
  type ParseIssue,
  type SourceRange,
  type TextNode,
  type Transaction,
  type TransactionOptions,
  type TransactionSpan,
  type Unsubscribe,
} from '../../../src/editor/model/types.js';

const NO_RANGE: SourceRange = { start: 0, end: 0 };

// ── tree builders ─────────────────────────────────────────────────────────────

export interface FakeNode {
  id: string;
  parentId: string | null;
  kind: 'element' | 'text';
  name?: string;
  attrs?: FakeAttr[];
  children?: FakeNode[];
  value?: string;
  raw?: string;
  edited?: boolean;
  mode?: 'normal' | 'raw';
  selfClosing?: boolean;
  preGt?: string;
  closeTag?: { name: string; preName: string; preGt: string; range: SourceRange } | null;
  range: SourceRange;
}

export interface FakeAttr {
  name: string;
  value: string | null;
}

export function fEl(id: string, name: string, attrs: FakeAttr[] = [], children: FakeNode[] = []): FakeNode {
  return { id, parentId: null, kind: 'element', name, attrs, children, selfClosing: false, preGt: '', closeTag: null, range: NO_RANGE };
}

export function fText(id: string, value: string): FakeNode {
  return { id, parentId: null, kind: 'text', value, raw: value, edited: false, mode: 'normal', range: NO_RANGE };
}

export function fAttr(name: string, value: string | null = null): FakeAttr {
  return { name, value };
}

// ── the fake document ─────────────────────────────────────────────────────────

interface FEntry {
  id: number;
  label: string;
  ops: EditOp[];
  inverse: EditOp[];
  undone: boolean;
  beforeVersion: number;
  afterVersion: number;
  touched: NodeId[];
}

/** Inverse captured BEFORE an op applies (the fake preserves no trivia, so
 *  value snapshots suffice). Returns null for insertNode — its inverse is
 *  computed after apply, from the node that actually landed. */
function invertPre(doc: FakeEditorDoc, op: EditOp): EditOp | null {
  const el = (id: NodeId): FakeNode | undefined => doc.peek(id);
  switch (op.type) {
    case 'setAttr': {
      const attr = el(op.node)?.attrs?.find((a) => a.name.toLowerCase() === op.name.toLowerCase());
      return attr === undefined ? { type: 'removeAttr', node: op.node, name: op.name } : { type: 'setAttr', node: op.node, name: attr.name, value: attr.value };
    }
    case 'removeAttr': {
      const attr = el(op.node)?.attrs?.find((a) => a.name.toLowerCase() === op.name.toLowerCase());
      return attr === undefined ? null : { type: 'setAttr', node: op.node, name: attr.name, value: attr.value };
    }
    case 'setText': {
      const n = el(op.node);
      return n !== undefined && n.kind === 'text' ? { type: 'setText', node: op.node, value: n.value ?? '' } : null;
    }
    case 'removeNode': {
      const n = doc.peek(op.node);
      if (n === undefined) return null;
      return { type: 'insertNode', parent: n.parentId ?? 'doc-root', index: doc.indexOf(op.node), node: n as unknown as EditorNode };
    }
    case 'moveNode': {
      const n = doc.peek(op.node);
      if (n === undefined) return null;
      return { type: 'moveNode', node: op.node, parent: n.parentId ?? 'doc-root', index: doc.indexOf(op.node) };
    }
    default:
      return null;
  }
}

export class FakeEditorDoc {
  #root: FakeNode;
  #byId = new Map<string, FakeNode>();
  #version = 0;
  #txSeq = 0;
  #history: FEntry[] = [];
  #changeSubs = new Set<(e: ChangeEvent) => void>();
  #historySubs = new Set<(e: HistoryChangeEvent) => void>();
  #starSubs = new Set<(e: DocEvent) => void>();
  #source: string;
  #nextId = 1;

  constructor(source: string, rootChildren: FakeNode[]) {
    this.#source = source;
    this.#root = fEl('doc-root', '#document', [], rootChildren);
    for (const child of rootChildren) child.parentId = 'doc-root';
    this.#indexAll(this.#root);
  }

  #indexAll(node: FakeNode): void {
    this.#byId.set(node.id, node);
    for (const child of node.children ?? []) {
      child.parentId = node.id;
      this.#indexAll(child);
    }
  }

  #freshId(): string {
    return `fresh-${this.#nextId++}`;
  }

  /** Internals (undo/transaction helpers): raw lookup, even if detached. */
  peek(id: NodeId): FakeNode | undefined {
    return this.#byId.get(id);
  }

  // ── reads ──
  get root(): ElementNode {
    return this.#root as unknown as ElementNode;
  }
  get version(): number {
    return this.#version;
  }
  get source(): string {
    return this.#source;
  }
  get issues(): readonly ParseIssue[] {
    return [];
  }

  node(id: NodeId): EditorNode | undefined {
    return this.#byId.get(id) as unknown as EditorNode | undefined;
  }

  parentOf(id: NodeId): ElementNode | null {
    const n = this.#byId.get(id);
    if (n === undefined || n.parentId === null) return null;
    return (this.#byId.get(n.parentId) as unknown as ElementNode) ?? null;
  }

  childrenOf(id: NodeId): readonly EditorNode[] {
    return (this.#byId.get(id)?.children ?? []) as unknown as readonly EditorNode[];
  }

  ancestorsOf(id: NodeId): ElementNode[] {
    const out: ElementNode[] = [];
    let cur = this.#byId.get(id);
    while (cur !== undefined && cur.parentId !== null) {
      const parent = this.#byId.get(cur.parentId);
      if (parent === undefined) break;
      out.push(parent as unknown as ElementNode);
      cur = parent;
    }
    return out;
  }

  indexOf(id: NodeId): number {
    const n = this.#byId.get(id);
    if (n === undefined || n.parentId === null) return -1;
    return (this.#byId.get(n.parentId)?.children ?? []).indexOf(n);
  }

  textOf(id: NodeId): string {
    const n = this.#byId.get(id);
    return n === undefined ? '' : this.#textOfNode(n);
  }

  #textOfNode(n: FakeNode): string {
    if (n.kind === 'text') return n.value ?? '';
    return (n.children ?? []).map((c) => this.#textOfNode(c)).join('');
  }

  contains(ancestor: NodeId, id: NodeId): boolean {
    if (ancestor === id) return true;
    let cur = this.#byId.get(id);
    while (cur !== undefined && cur.parentId !== null) {
      if (cur.parentId === ancestor) return true;
      cur = this.#byId.get(cur.parentId);
    }
    return false;
  }

  elementAtOffset(_offset: number): ElementNode | null {
    return null;
  }

  // ── raw op application (no history, no events). Returns the id of the node
  //    that landed for insertNode (fresh id on cross-doc adoption). ──

  #rawApply(op: EditOp): NodeId | undefined {
    switch (op.type) {
      case 'setAttr': {
        const n = this.#mustBeElement(op.node);
        const attr = n.attrs.find((a) => a.name.toLowerCase() === op.name.toLowerCase());
        if (attr !== undefined) attr.value = op.value;
        else n.attrs.push({ name: op.name, value: op.value });
        return undefined;
      }
      case 'removeAttr': {
        const n = this.#mustBeElement(op.node);
        n.attrs = n.attrs.filter((a) => a.name.toLowerCase() !== op.name.toLowerCase());
        return undefined;
      }
      case 'setText': {
        const n = this.#mustExist(op.node);
        if (n.kind !== 'text') throw new ModelError(op, 'setText targets text nodes only');
        n.value = op.value;
        n.edited = true;
        return undefined;
      }
      case 'insertNode': {
        const parent = this.#mustBeElement(op.parent);
        const incoming = op.node as unknown as FakeNode;
        const node = this.#byId.get(incoming.id) === incoming ? incoming : this.#adopt(incoming);
        const at = Math.max(0, Math.min(op.index, parent.children.length));
        parent.children.splice(at, 0, node);
        node.parentId = parent.id;
        return node.id;
      }
      case 'removeNode': {
        const n = this.#mustExist(op.node);
        const parent = n.parentId !== null ? this.#byId.get(n.parentId) : undefined;
        if (parent === undefined) throw new ModelError(op, 'cannot remove the root');
        const at = (parent.children ?? []).indexOf(n);
        if (at < 0) throw new ModelError(op, 'node is not attached');
        parent.children.splice(at, 1);
        // keep the byId registration: undo re-inserts the SAME object + id
        return undefined;
      }
      case 'moveNode': {
        const n = this.#mustExist(op.node);
        const from = n.parentId !== null ? this.#byId.get(n.parentId) : undefined;
        const at0 = from !== undefined ? (from.children ?? []).indexOf(n) : -1;
        if (from !== undefined && at0 >= 0) from.children.splice(at0, 1);
        const parent = this.#mustBeElement(op.parent);
        const at = Math.max(0, Math.min(op.index, parent.children.length));
        parent.children.splice(at, 0, n);
        n.parentId = parent.id;
        return undefined;
      }
      default:
        throw new ModelError(op, `fake doc does not implement ${op.type}`);
    }
  }

  #mustExist(id: NodeId): FakeNode {
    const n = this.#byId.get(id);
    if (n === undefined) throw new Error(`fake: no such node ${id}`);
    return n;
  }

  #mustBeElement(id: NodeId): FakeNode & { attrs: FakeAttr[]; children: FakeNode[] } {
    const n = this.#mustExist(id);
    if (n.kind !== 'element') throw new Error(`fake: not an element ${id}`);
    n.attrs = n.attrs ?? [];
    n.children = n.children ?? [];
    return n as FakeNode & { attrs: FakeAttr[]; children: FakeNode[] };
  }

  /** Deep-copy a foreign node into this doc under a fresh id. */
  #adopt(node: FakeNode): FakeNode {
    const id = this.#freshId();
    const copy: FakeNode = { ...node, id, range: NO_RANGE };
    if (node.attrs !== undefined) copy.attrs = node.attrs.map((a) => ({ ...a }));
    if (node.children !== undefined) {
      copy.children = node.children.map((c) => {
        const c2 = this.#adopt(c);
        c2.parentId = id;
        return c2;
      });
    }
    this.#byId.set(id, copy);
    return copy;
  }

  // ── validation ──
  canApply(op: EditOp): ApplyCheck {
    switch (op.type) {
      case 'removeNode': {
        const n = this.#byId.get(op.node);
        if (n === undefined) return { ok: false, reason: 'no such node' };
        if (n.parentId === null) return { ok: false, reason: 'cannot remove the root' };
        return { ok: true };
      }
      case 'insertNode': {
        const parent = this.#byId.get(op.parent);
        if (parent === undefined || parent.kind !== 'element') return { ok: false, reason: 'parent is not an element' };
        if (op.index < 0 || op.index > (parent.children?.length ?? 0)) return { ok: false, reason: 'index out of bounds' };
        return { ok: true };
      }
      case 'moveNode': {
        if (this.contains(op.node, op.parent)) return { ok: false, reason: 'cannot move into own subtree' };
        return { ok: true };
      }
      case 'setText': {
        const n = this.#byId.get(op.node);
        if (n === undefined || n.kind !== 'text') return { ok: false, reason: 'setText targets text nodes only' };
        return { ok: true };
      }
      default:
        return this.#byId.has(op.node) ? { ok: true } : { ok: false, reason: 'no such node' };
    }
  }

  // ── transactions + history ──

  #asTransaction(entry: FEntry): Transaction {
    return {
      id: entry.id,
      label: entry.label,
      ops: entry.ops,
      inverse: entry.inverse,
      beforeVersion: entry.beforeVersion,
      afterVersion: entry.afterVersion,
      touched: entry.touched,
    };
  }

  #emitChange(entry: FEntry): void {
    const e: ChangeEvent = { type: 'change', doc: this as unknown as EditorDocument, transaction: this.#asTransaction(entry), version: entry.afterVersion };
    for (const cb of this.#changeSubs) cb(e);
    for (const cb of this.#starSubs) cb(e);
    this.#emitHistory();
  }

  #emitHistory(): void {
    const e: HistoryChangeEvent = { type: 'history', doc: this as unknown as EditorDocument, canUndo: this.canUndo(), canRedo: this.canRedo() };
    for (const cb of this.#historySubs) cb(e);
    for (const cb of this.#starSubs) cb(e);
  }

  transaction<T>(label: string, fn: (tx: { push(op: EditOp): void; readonly touched: readonly NodeId[] }) => T, opts?: TransactionOptions): T {
    const ops: EditOp[] = [];
    const inverse: EditOp[] = [];
    const touched = new Set<NodeId>();
    const beforeVersion = this.#version;
    const builder = {
      push: (op: EditOp): void => {
        const check = this.canApply(op);
        if (!check.ok) throw new ModelError(op, check.reason ?? 'rejected');
        const pre = invertPre(this, op);
        const landed = this.#rawApply(op);
        ops.push(op);
        if (op.type === 'insertNode' && landed !== undefined) inverse.push({ type: 'removeNode', node: landed });
        else if (pre !== null) inverse.push(pre);
        touched.add(op.node);
      },
      get touched(): readonly NodeId[] {
        return Array.from(touched);
      },
    };
    const out = fn(builder);
    if (ops.length === 0) return out;
    inverse.reverse();
    this.#version += 1;
    const entry: FEntry = { id: ++this.#txSeq, label, ops, inverse, undone: false, beforeVersion, afterVersion: this.#version, touched: Array.from(touched) };
    this.#history.push(entry);
    if (opts?.silent !== true) this.#emitChange(entry);
    return this.#asTransaction(entry);
  }

  apply(op: EditOp, opts?: TransactionOptions): Transaction {
    let applied: Transaction | null = null;
    const out = this.transaction(`apply:${op.type}`, (tx) => {
      tx.push(op);
    }, opts);
    applied = this.#history[this.#history.length - 1] ?? null;
    void out;
    return applied !== null ? this.#asTransaction(applied) : { id: 0, label: '', ops: [], inverse: [], beforeVersion: 0, afterVersion: 0, touched: [] };
  }

  openTransaction(label: string, _opts?: TransactionOptions): TransactionSpan {
    const ops: EditOp[] = [];
    const undo: EditOp[] = [];
    const touched = new Set<NodeId>();
    const beforeVersion = this.#version;
    let committed = false;
    const span: TransactionSpan = {
      push: (op: EditOp): void => {
        if (committed) throw new Error('fake: span already closed');
        const check = this.canApply(op);
        if (!check.ok) throw new ModelError(op, check.reason ?? 'rejected');
        const pre = invertPre(this, op);
        const landed = this.#rawApply(op);
        ops.push(op);
        if (op.type === 'insertNode' && landed !== undefined) undo.push({ type: 'removeNode', node: landed });
        else if (pre !== null) undo.push(pre);
        touched.add(op.node);
      },
      commit: (): Transaction => {
        committed = true;
        undo.reverse();
        this.#version += 1;
        const entry: FEntry = { id: ++this.#txSeq, label, ops, inverse: undo, undone: false, beforeVersion, afterVersion: this.#version, touched: Array.from(touched) };
        this.#history.push(entry);
        this.#emitChange(entry);
        return this.#asTransaction(entry);
      },
      abort: (): void => {
        committed = true;
        for (const op of [...undo].reverse()) this.#rawApply(op);
      },
      get committed(): boolean {
        return committed;
      },
      get touched(): readonly NodeId[] {
        return Array.from(touched);
      },
    };
    return span;
  }

  undo(): boolean {
    for (let i = this.#history.length - 1; i >= 0; i--) {
      const entry = this.#history[i];
      if (entry.undone) continue;
      for (const op of [...entry.inverse].reverse()) this.#rawApply(op);
      entry.undone = true;
      this.#version += 1;
      const e: ChangeEvent = { type: 'change', doc: this as unknown as EditorDocument, transaction: this.#asTransaction(entry), version: this.#version };
      for (const cb of this.#changeSubs) cb(e);
      for (const cb of this.#starSubs) cb(e);
      this.#emitHistory();
      return true;
    }
    return false;
  }

  redo(): boolean {
    for (const entry of this.#history) {
      if (!entry.undone) continue;
      for (const op of entry.ops) this.#rawApply(op);
      entry.undone = false;
      this.#version += 1;
      const e: ChangeEvent = { type: 'change', doc: this as unknown as EditorDocument, transaction: this.#asTransaction(entry), version: this.#version };
      for (const cb of this.#changeSubs) cb(e);
      for (const cb of this.#starSubs) cb(e);
      this.#emitHistory();
      return true;
    }
    return false;
  }

  canUndo(): boolean {
    return this.#history.some((e) => !e.undone);
  }

  canRedo(): boolean {
    return this.#history.some((e) => e.undone);
  }

  history(): readonly HistoryEntry[] {
    return this.#history.map((e, i) => ({ id: e.id, label: e.label, ops: e.ops.length, depth: this.#history.length - 1 - i, undone: e.undone }));
  }

  clearHistory(): void {
    this.#history = [];
  }

  // ── factories ──
  createElement(spec: ElementSpec): ElementNode {
    const id = this.#freshId();
    const attrs: FakeAttr[] = (spec.attrs ?? []).map((a) => ({ name: a.name, value: a.value ?? null }));
    const node: FakeNode = { id, parentId: null, kind: 'element', name: spec.tag, attrs, children: [], selfClosing: false, preGt: '', closeTag: null, range: NO_RANGE };
    this.#byId.set(id, node);
    for (const child of spec.children ?? []) {
      const incoming = child as unknown as FakeNode;
      const adopted = this.#byId.get(incoming.id) === incoming ? incoming : this.#adopt(incoming);
      adopted.parentId = id;
      node.children?.push(adopted);
    }
    return node as unknown as ElementNode;
  }

  createText(value: string, mode?: 'normal' | 'raw'): TextNode {
    const id = this.#freshId();
    const node: FakeNode = { id, parentId: null, kind: 'text', value, raw: value, edited: false, mode: mode ?? 'normal', range: NO_RANGE };
    this.#byId.set(id, node);
    return node as unknown as TextNode;
  }

  // ── output + mapping (stubs — shell lane does not exercise them) ──
  serialize(): string {
    return this.#source;
  }
  serializeSubtree(_id: NodeId, _style?: unknown): string {
    return '';
  }
  posToOffset(_pos: unknown): number | null {
    return null;
  }
  offsetToPos(_offset: number): null {
    return null;
  }
  rangeOf(_id: NodeId): SourceRange | undefined {
    return undefined;
  }
  clone(): EditorDocument {
    throw new Error('fake doc: clone not implemented');
  }

  // ── events ──
  on(event: 'change', cb: (e: ChangeEvent) => void): Unsubscribe;
  on(event: 'history', cb: (e: HistoryChangeEvent) => void): Unsubscribe;
  on(event: '*', cb: (e: DocEvent) => void): Unsubscribe;
  on(event: string, cb: (e: never) => void): Unsubscribe {
    if (event === 'change') {
      this.#changeSubs.add(cb as (e: ChangeEvent) => void);
      return () => this.#changeSubs.delete(cb as (e: ChangeEvent) => void);
    }
    if (event === 'history') {
      this.#historySubs.add(cb as (e: HistoryChangeEvent) => void);
      return () => this.#historySubs.delete(cb as (e: HistoryChangeEvent) => void);
    }
    if (event === '*') {
      this.#starSubs.add(cb as (e: DocEvent) => void);
      return () => this.#starSubs.delete(cb as (e: DocEvent) => void);
    }
    return () => undefined;
  }
}

/** Build a fake doc + cast to the contract type (test boundary only). */
export function fakeDoc(source: string, rootChildren: FakeNode[]): EditorDocument {
  return new FakeEditorDoc(source, rootChildren) as unknown as EditorDocument;
}

export type { FakeNode, FakeAttr };
