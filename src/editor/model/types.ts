/**
 * Editor document model — the type contract for the whole editor.
 *
 * This file is the published contract (LANE=model-core, first commit). Every
 * editor lane codes against these shapes; the implementations live beside it
 * (`parse.ts`, `serialize.ts`, `ops.ts`, `document.ts`, `position.ts`,
 * `entities.ts`) and are re-exported from `src/editor/model/index.ts`.
 *
 * ── Invariants ──────────────────────────────────────────────────────────────
 * 1. Round trip: `serialize(parse(x)) === x` for every untouched document.
 *    Edits re-emit only touched nodes; untouched subtrees are reconstructed
 *    from preserved trivia (attribute order, quote style, whitespace, entity
 *    spelling) and therefore stay byte-identical.
 * 2. Readers pay nothing: nothing here imports Lit or touches the DOM. The
 *    model is pure data + pure functions over it.
 * 3. Stability: node ids are assigned at parse time and never reassigned by
 *    edits. Untouched nodes keep their id across transactions.
 * 4. Ranges: `node.range` offsets are valid as of the most recent `parse()`
 *    or `serialize()`; `serialize()` refreshes every node's range and text
 *    `raw` to the emitted source (it never mutates bytes for clean nodes).
 *    Lanes that need current offsets (code view selection sync) call
 *    `doc.serialize()` or `doc.offsetToPos()` after applying ops.
 * 5. Malformed input never throws away the tree: `parse()` is best-effort and
 *    never throws; problems surface as structured `ParseIssue`s with ranges.
 *
 * ── Trivia preservation ─────────────────────────────────────────────────────
 * The model is lossless by construction: it stores what was authored and
 * re-escapes only what was edited.
 *  - TextNode: clean nodes emit `raw` verbatim (entity spellings like `&amp;`
 *    survive); edited nodes emit `escapeText(value)`.
 *  - AttrNode: clean nodes emit `rawValue` verbatim inside the authored
 *    quote; edited/created attrs emit `escapeAttr(value)` in the node's quote
 *    style (new attrs default to double quotes).
 *  - Elements/comments/CDATA/PIs/doctype are rebuilt exactly from their
 *    preserved parts (name, per-attribute leading whitespace, `preGt`, close
 *    tag trivia, marker bodies).
 *
 * ── Raw-text elements ───────────────────────────────────────────────────────
 * Content of `<script>` and `<style>` is one TextNode with `mode: 'raw'`:
 * entities are NOT decoded, tags inside are not parsed. This keeps the
 * `sem-chat` JSON payload (`<script type="application/json">`) byte-exact and
 * inert — see the editor safety contract.
 */

// ── Primitives ───────────────────────────────────────────────────────────────

/** Stable node identifier. Assigned at parse time (`n1`, `n2`, …); ops that
 *  create nodes allocate from the same document counter. Ids are unique per
 *  EditorDocument instance and stable across edits. */
export type NodeId = string;

/** Half-open byte range into the parsed source: `[start, end)` in UTF-16
 *  code units, matching `String.prototype.slice` coordinates. */
export interface SourceRange {
  start: number;
  end: number;
}

/** Where a caret/selection boundary sits in the model.
 *  - text node: `offset` is a decoded-text offset (UTF-16 units of `value`)
 *  - element node: `offset` is a child boundary, `0..children.length`
 *  - comment/cdata/pi: `offset` is an offset into the node's body text */
export interface DocPos {
  node: NodeId;
  offset: number;
}

/** A model-space selection. `anchor` is where the selection started,
 *  `focus` where the caret is; they are equal for a collapsed caret. */
export interface Selection {
  anchor: DocPos;
  focus: DocPos;
}

// ── Attributes ───────────────────────────────────────────────────────────────

/** One attribute of an element, in authored order.
 *  `value` is the decoded value (`null` for a bare/boolean attribute like
 *  `collapsed`); `rawValue` is the authored slice between the quotes with
 *  entities intact (`null` when the attribute is bare OR was created/edited
 *  by an op, in which case the serializer escapes `value`). `quote` is the
 *  authored quote character ('' for bare attributes). `pre` is the whitespace
 *  between the previous token and this attribute's name. Attribute names are
 *  matched case-insensitively (XHTML authors lowercase). */
export interface AttrNode {
  name: string;
  value: string | null;
  rawValue: string | null;
  quote: '"' | "'" | '';
  pre: string;
  range: SourceRange;
}

// ── Nodes ────────────────────────────────────────────────────────────────────

/** Fields every tree node carries. `parentId` is `null` only for the
 *  document root. */
export interface NodeCommon {
  id: NodeId;
  parentId: NodeId | null;
  /** As of the last parse/serialize — see invariant 4. */
  range: SourceRange;
}

export interface DocumentNode extends NodeCommon {
  kind: 'document';
  children: EditorNode[];
}

export interface ElementNode extends NodeCommon {
  kind: 'element';
  /** Authored tag name, case-preserved (XHTML: lowercase). Match with
   *  `name.toLowerCase()`. */
  name: string;
  attrs: AttrNode[];
  children: EditorNode[];
  /** Authored `<br />` form. Void elements created by ops default to
   *  self-closing (canonical XHTML style). */
  selfClosing: boolean;
  /** Whitespace between the last attribute and `>` (or `/>`). */
  preGt: string;
  /** Close tag trivia; `null` for self-closing elements. `name` is the
   *  authored close-tag name (mismatched case is preserved, not fixed). */
  closeTag: {
    name: string;
    preName: string;
    preGt: string;
    range: SourceRange;
  } | null;
}

export interface TextNode extends NodeCommon {
  kind: 'text';
  /** Decoded value (entities resolved, per `mode`). Edits write here. */
  value: string;
  /** Authored source slice. Emitted verbatim while `edited` is false. */
  raw: string;
  /** Set by setText; the serializer then re-escapes from `value`. */
  edited: boolean;
  /** `raw` content (script/style): entities NOT decoded, `<` never starts a
   *  tag. The sem-chat JSON payload parses as one raw text node. */
  mode: 'normal' | 'raw';
}

export interface CommentNode extends NodeCommon {
  kind: 'comment';
  /** Body between `<!--` and `-->`, verbatim (comments are never decoded). */
  value: string;
  /** Set by the (future) comment-edit op; the serializer then emits
   *  escapeCommentBody(value) — authored bodies keep their bytes. */
  edited?: boolean;
}

export interface CdataNode extends NodeCommon {
  kind: 'cdata';
  /** Body between `<![CDATA[` and `]]>`, verbatim. */
  value: string;
}

export interface ProcessingInstructionNode extends NodeCommon {
  kind: 'pi';
  /** PI target, e.g. `xml` in `<?xml version="1.0"?>`. */
  target: string;
  /** Everything after the target (and its whitespace) up to `?>`, verbatim. */
  value: string;
}

export interface DoctypeNode extends NodeCommon {
  kind: 'doctype';
  /** Inner text of `<!doctype …>`, verbatim, e.g. `html`. */
  value: string;
}

export type EditorNode =
  | ElementNode
  | TextNode
  | CommentNode
  | CdataNode
  | ProcessingInstructionNode
  | DoctypeNode;

export type EditorNodeKind = EditorNode['kind'];

// ── Parse issues ─────────────────────────────────────────────────────────────

export type ParseIssueCode =
  | 'unclosed-tag' // EOF inside an open element (auto-closed, best-effort)
  | 'mismatched-close' // </b> closes <i> (recovered)
  | 'stray-close' // close tag with no matching open (dropped)
  | 'unexpected-eof' // EOF inside a tag/comment/cdata/pi
  | 'invalid-char' // e.g. `<` in a raw-text context, bare `&` kept as text
  | 'bad-attr' // malformed attribute (recovered: skipped)
  | 'unknown-entity' // named entity not in the table (kept verbatim in value)
  | 'implicit-nesting' // `<p>a<p>b`-style auto-close (recovered)
  | 'invalid-doctype';

export interface ParseIssue {
  code: ParseIssueCode;
  severity: 'error' | 'warning';
  message: string;
  range: SourceRange;
}

/** `tryParse` result. Even the failure case carries a best-effort document so
 *  the code view can render error markers while the WYSIWYG view keeps the
 *  last good tree (the session decides which doc to adopt). */
export type ParseResult =
  | { ok: true; doc: EditorDocument; issues: ParseIssue[] }
  | { ok: false; doc: EditorDocument; issues: ParseIssue[]; error: ParseIssue };

// ── Ops ──────────────────────────────────────────────────────────────────────

/** Initialiser for an element created by an op (wrap / insertNode /
 *  replaceSubtree). Fresh nodes get fresh ids from the document counter. */
export interface ElementSpec {
  tag: string;
  /** Bare attribute = `{ name }`; explicit `null` value is a bare attribute. */
  attrs?: Array<{ name: string; value?: string | null }>;
  children?: EditorNode[];
}

/** The nine typed edit operations, plus two model-internal restore ops that
 *  appear ONLY inside `Transaction.inverse` (the model computes them to undo
 *  with byte-exact trivia: restoring an attribute's authored quote/rawValue
 *  and a text node's authored entity spelling). Lanes never construct
 *  restore ops. Every op is atomic and invertible.
 *
 *  Guards (checked by `canApply`/`apply`, rejected via `ApplyCheck`):
 *  - moveNode/insertNode refuse to place a node inside its own subtree.
 *  - setText targets text nodes only.
 *  - duplicate attribute names: setAttr rewrites the first match,
 *    removeAttr removes every match.
 *  - nodes passed by reference (insertNode/wrap/replaceSubtree) are adopted;
 *    they must not already be attached to this document. */
export type EditOp =
  | { type: 'insertNode'; parent: NodeId; index: number; node: EditorNode }
  | { type: 'removeNode'; node: NodeId }
  | { type: 'moveNode'; node: NodeId; parent: NodeId; index: number }
  | { type: 'setAttr'; node: NodeId; name: string; value: string | null }
  | { type: 'removeAttr'; node: NodeId; name: string }
  | { type: 'setText'; node: NodeId; value: string }
  | { type: 'wrap'; node: NodeId; wrapper: ElementSpec }
  | { type: 'unwrap'; node: NodeId }
  | { type: 'replaceSubtree'; node: NodeId; replacement: EditorNode }
  /** model-internal: restore an attribute with full trivia at `index`. */
  | { type: 'restoreAttr'; node: NodeId; attr: AttrNode; index: number }
  /** model-internal: restore a text node's value + raw baseline. */
  | { type: 'restoreText'; node: NodeId; value: string; raw: string; edited: boolean };

export interface ApplyCheck {
  ok: boolean;
  reason?: string;
}

// ── Transactions & history ───────────────────────────────────────────────────

/** An applied (or applied-then-undone) unit of work: one undo/redo entry, one
 *  change event. `inverse` is the model-computed op list that undoes it. */
export interface Transaction {
  id: number;
  label: string;
  ops: EditOp[];
  inverse: EditOp[];
  /** Document version before/after this transaction applied. */
  beforeVersion: number;
  afterVersion: number;
  /** Ids of nodes directly touched (not including ancestors). */
  touched: NodeId[];
}

/** One undo-stack entry as exposed by `doc.history()`. */
export interface HistoryEntry {
  id: number;
  label: string;
  ops: number;
  /** Position from the top of the stack: 0 = most recent. */
  depth: number;
  undone: boolean;
}

export interface TransactionOptions {
  /** Transactions sharing a coalesce key merge into ONE undo entry while they
   *  arrive within the coalesce window (typing). The key also labels the
   *  entry. */
  coalesce?: string;
  /** Skip the change event (rare: bulk imports that emit their own event). */
  silent?: boolean;
}

/** Push-only op collector for `doc.transaction()` / `doc.openTransaction()`.
 *  Ops apply immediately (the tree is live for reads inside the callback);
 *  they batch into one undo entry and one change event at commit. */
export interface TransactionBuilder {
  push(op: EditOp): void;
  /** Ids touched so far. */
  readonly touched: readonly NodeId[];
}

export interface ChangeEvent {
  type: 'change';
  doc: EditorDocument;
  transaction: Transaction;
  version: number;
}

export interface HistoryChangeEvent {
  type: 'history';
  doc: EditorDocument;
  canUndo: boolean;
  canRedo: boolean;
}

export type DocEvent = ChangeEvent | HistoryChangeEvent;
export type Unsubscribe = () => void;

// ── Serialization style ──────────────────────────────────────────────────────

/** Style for nodes the serializer must re-emit (edited/created). Untouched
 *  nodes emit their preserved trivia regardless of this setting. `quote`
 *  only affects newly created attributes; `indent`/`newline` are used when
 *  the model must pretty-place a created node whose neighbours have no
 *  reusable whitespace trivia. */
export interface SerializeStyle {
  quote: '"' | "'";
  indent: string;
  newline: string;
}

// ── Void & raw-text element tables (shared contract) ─────────────────────────

/** HTML void elements — never have children; parse to a childless,
 *  self-closing element node. */
export const VOID_ELEMENTS: readonly string[] = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

/** Elements whose content is raw text (no entity decoding, no child
 *  parsing). */
export const RAW_TEXT_ELEMENTS: readonly string[] = ['script', 'style'];

// ── The document ─────────────────────────────────────────────────────────────

/**
 * A live, editable XHTML document. Created by `createDocument(source)` /
 * `parse(source)`. Owns the undo/redo stack and the change stream.
 *
 * Editing protocol (controller/shell/code lanes):
 * ```ts
 * const doc = createDocument(source);
 * const undo = doc.on('change', (e) => rerender(e.touched));
 * doc.transaction('setText', (tx) => {
 *   tx.push({ type: 'setText', node: textId, value: next });
 * });
 * const out = doc.serialize(); // untouched nodes byte-identical to `source`
 * doc.undo();
 * ```
 * Bad re-parses never destroy the tree: parsing lives outside the document;
 * a failed `tryParse` simply returns `{ ok: false }` and the caller keeps
 * using the previous instance.
 */
export interface EditorDocument {
  /** Source as of the last parse or serialize. */
  readonly source: string;
  readonly root: DocumentNode;
  /** Monotonic; bumps once per transaction commit (not per op). */
  readonly version: number;
  /** Structured problems from the last parse (empty for clean input). */
  readonly issues: readonly ParseIssue[];

  // ── reads ──
  node(id: NodeId): EditorNode | undefined;
  parentOf(id: NodeId): ElementNode | null;
  childrenOf(id: NodeId): readonly EditorNode[];
  /** Ancestors from the node up to (excluding) the root. */
  ancestorsOf(id: NodeId): ElementNode[];
  /** Index of `id` in its parent, or -1. */
  indexOf(id: NodeId): number;
  /** Decoded text content of a subtree (text nodes concatenated). */
  textOf(id: NodeId): string;
  /** Deepest element whose source range contains `offset`. */
  elementAtOffset(offset: number): ElementNode | null;
  /** Is `ancestor` an ancestor of (or equal to) `id`? */
  contains(ancestor: NodeId, id: NodeId): boolean;

  // ── validation ──
  canApply(op: EditOp): ApplyCheck;

  // ── editing ──
  /** Apply one op as its own transaction. Throws `ModelError` if rejected —
   *  guards are programmer error; UI paths check `canApply` first. */
  apply(op: EditOp, opts?: TransactionOptions): Transaction;
  /** Run `fn` with a builder; ops batch into one undo entry + one change
   *  event. Throws on the first rejected op (after undoing prior ops of this
   *  transaction — a rejected transaction leaves the tree unchanged). */
  transaction<T>(
    label: string,
    fn: (tx: TransactionBuilder) => T,
    opts?: TransactionOptions,
  ): T;
  /** Manual transaction span (for flows that cannot use a synchronous
   *  callback). MUST be closed with `commit()`/`abort()` exactly once:
   *  commit fires the batched change event; abort undoes the span's ops and
   *  fires NO change event and leaves NO history entry. */
  openTransaction(label: string, opts?: TransactionOptions): TransactionSpan;
  /** Fresh node factory: allocates an id and wires parentId/range
   *  (range `{start:0,end:0}` until the next serialize). */
  createElement(spec: ElementSpec): ElementNode;
  createText(value: string, mode?: 'normal' | 'raw'): TextNode;

  // ── history ──
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Undo entries, oldest first (`depth` counts from newest). */
  history(): readonly HistoryEntry[];
  clearHistory(): void;

  // ── output ──
  /** Emit the document. Untouched nodes are byte-identical to the source
   *  they were parsed from; edited nodes re-emit canonically. Refreshes
   *  every node's range (invariant 4) and returns the new `source`. */
  serialize(style?: Partial<SerializeStyle>): string;
  /** Emit one subtree (element or any node) standalone. Offsets in the
   *  result are subtree-local; node ranges are NOT refreshed (use
   *  `serialize()` for that). */
  serializeSubtree(id: NodeId, style?: Partial<SerializeStyle>): string;

  // ── selection mapping ──
  /** Source offset of a model position, or null if unreachable. */
  posToOffset(pos: DocPos): number | null;
  /** Model position for a source offset (rounds left: the position whose
   *  range ends at or spans `offset`). */
  offsetToPos(offset: number): DocPos | null;
  /** Source range of a node (current as of last parse/serialize). */
  rangeOf(id: NodeId): SourceRange | undefined;

  // ── events ──
  on(event: 'change', cb: (e: ChangeEvent) => void): Unsubscribe;
  on(event: 'history', cb: (e: HistoryChangeEvent) => void): Unsubscribe;
  on(event: '*', cb: (e: DocEvent) => void): Unsubscribe;

  // ── snapshots ──
  /** Structural deep clone: fresh document, same ids, no history, same
   *  source. For draft branching and tests. */
  clone(): EditorDocument;
}

/** Manual-span transaction handle. `commit` fires the batched change event;
 *  `abort` undoes the ops applied so far, fires no change event and leaves
 *  no history entry. */
export interface TransactionSpan extends TransactionBuilder {
  commit(): Transaction;
  abort(): void;
  readonly committed: boolean;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Thrown by `apply`/`transaction` on a rejected op (programmer error path). */
export interface ModelErrorShape {
  op: EditOp;
  reason: string;
}

export class ModelError extends Error implements ModelErrorShape {
  op: EditOp;
  reason: string;
  constructor(op: EditOp, reason: string) {
    super(`model: ${op.type} rejected — ${reason}`);
    this.name = 'ModelError';
    this.op = op;
    this.reason = reason;
  }
}
