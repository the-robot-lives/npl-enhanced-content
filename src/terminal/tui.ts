/**
 * tui — the state machines behind `semtext tui <file>`.
 *
 * Two machines share this module, both pure and DOM-free:
 *
 *  - **The card machine** (below): the Round-1 flashcard view behind the
 *    DATA-only `TuiAction` the element performs (boxed panels). Kept
 *    verbatim for parity until the overlay retires (CORE-V2 §14 M5).
 *
 *  - **The tree machine** (`TuiTreeState`, the second half): the shell-v2
 *    grid TUI's decision layer — a collapsible section tree with filter,
 *    row cursor, and the v1 key parity. The app that paints it onto the
 *    alternate screen lives in `tui-app.ts`; the document → tree build
 *    lives in `plugins/demo/tui-tree.ts` (the only DOM-touching piece).
 *
 * Read-only: nothing here writes, fetches, or mutates the document.
 *
 * Card keys: j / ArrowDown next · k / ArrowUp previous · Enter
 * expand/collapse · '/' open the filter · q / Escape close. The filter
 * narrows to cards whose front or back contains the text
 * (case-insensitive); movement and expansion work only over the visible
 * cards. Tree keys: the same table plus h/l, g/G, Home/End, PgUp/PgDn,
 * Left/Right — see `tuiTreeKey`.
 */

import type { KeyEvent } from './screen/types.js';

/** One flashcard: the front line, the expanded back, and a provenance line. */
export interface TuiCard {
  front: string;
  back: string;
  /** `#id kind=… tags=…` — empty string when the record has neither. */
  meta: string;
}

export interface TuiState {
  /** Document title shown in the view header. */
  title: string;
  cards: TuiCard[];
  /** Card cursor, an index into `cards` (0-based). */
  index: number;
  expanded: boolean;
  /** The filter text while `filtering` is true; kept after closing too. */
  filter: string;
  /** True while the filter row is open for typing. */
  filtering: boolean;
  /** Indices of cards matching the filter, in document order. */
  visible: number[];
}

/** DATA-only request to open the flashcard view; the element performs it. */
export interface TuiAction {
  kind: 'tui';
  title: string;
  cards: TuiCard[];
}

export function createTuiState(cards: TuiCard[], title = 'document'): TuiState {
  const state: TuiState = { title, cards, index: 0, expanded: false, filter: '', filtering: false, visible: [] };
  refilter(state);
  return state;
}

/** Recompute `visible` from `filter` and clamp the cursor onto it. */
export function refilter(state: TuiState): void {
  const needle = state.filter.trim().toLowerCase();
  state.visible = state.cards
    .map((card, i) => ({ card, i }))
    .filter(({ card }) => needle === '' || card.front.toLowerCase().includes(needle) || card.back.toLowerCase().includes(needle))
    .map(({ i }) => i);
  if (!state.visible.includes(state.index)) {
    state.index = state.visible.length > 0 ? state.visible[0] : 0;
  }
  if (state.index >= state.cards.length) state.index = 0;
}

export function tuiSetFilter(state: TuiState, text: string): void {
  state.filter = text;
  refilter(state);
}

export function tuiOpenFilter(state: TuiState): void {
  state.filtering = true;
}

export function tuiCloseFilter(state: TuiState): void {
  state.filtering = false;
}

/** Move along the visible cards; wraps at both ends. */
export function tuiMove(state: TuiState, delta: 1 | -1): void {
  if (state.visible.length === 0) return;
  const at = state.visible.indexOf(state.index);
  const next = at === -1 ? 0 : (at + delta + state.visible.length) % state.visible.length;
  state.index = state.visible[next];
  state.expanded = false;
}

export function tuiToggle(state: TuiState): void {
  state.expanded = !state.expanded;
}

/** `q` / Escape. True when the state says close the view. */
export function tuiIsClose(key: string): boolean {
  return key === 'q' || key === 'Q' || key === 'Escape';
}

/** Position line for the header: `card 2/6` (1-based, over visible cards). */
export function tuiPosition(state: TuiState): string {
  const at = state.visible.indexOf(state.index);
  const n = state.visible.length;
  return `card ${n === 0 ? 0 : at + 1}/${n}`;
}

/* ------------------------------------------------------------------ *
 * The tree machine — the shell-v2 grid TUI's state (CORE-V2 §6)
 * ------------------------------------------------------------------ */

/**
 * One row of the document tree. Sections come from headings, blocks from
 * the structural sem-* elements and bare leaf records; `buildTuiTree`
 * (plugins/demo/tui-tree.ts) produces the roots. Pure data — no DOM refs.
 */
export interface TuiNode {
  /** Stable identity: the heading's `id`, the section number, or `b<n>`. */
  id: string;
  kind: 'section' | 'block';
  /** Heading text, or the block's short label. */
  label: string;
  /** The section's computed number (`2.1`); '' for blocks. */
  number: string;
  /** Heading level 1–6 for sections; 0 for blocks. */
  level: number;
  /** A block's expanded content lines; [] for sections. */
  body: string[];
  /** `#id kind=… tags=…` provenance; '' when the document sets none. */
  meta: string;
  children: TuiNode[];
}

/** One flattened, visible row. `bodyLine` rows are display-only filler. */
export interface TuiRow {
  node: TuiNode;
  /** Indent depth in the visible tree (0 = root level). */
  depth: number;
  expandable: boolean;
  expanded: boolean;
  /** Non-null on a block's expanded body line (never focused). */
  bodyLine: string | null;
  focusable: boolean;
}

/**
 * The tree machine's state: roots in, keys in, rows out. `rows` is the
 * flattened visible tree — rebuilt by `tuiTreeRefresh` after every
 * mutation, so painters can trust it verbatim.
 */
export interface TuiTreeState {
  title: string;
  roots: TuiNode[];
  /** Ids of expanded sections (children shown) and blocks (body shown). */
  expanded: Set<string>;
  /** Id of the focused row; '' when nothing is visible. */
  cursor: string;
  filter: string;
  filtering: boolean;
  rows: TuiRow[];
}

/**
 * The tree under a filter: a section is visible when its label, number or
 * meta matches, or when anything below it matches (the path to a match
 * stays readable); a block is visible when its label, meta or body
 * matches. While the filter is active the collapsed/expanded state is
 * bypassed — the whole matching subtree is shown, without mutating it.
 */
function nodeMatches(node: TuiNode, needle: string): boolean {
  const hit = (text: string): boolean => text.toLowerCase().includes(needle);
  if (hit(node.label) || hit(node.number) || hit(node.meta)) return true;
  if (node.body.some((line) => hit(line))) return true;
  return node.children.some((child) => nodeMatches(child, needle));
}

function flattenUnder(state: TuiTreeState, node: TuiNode, depth: number, filter: string, out: TuiRow[]): void {
  const filtering = filter !== '';
  const needle = filter.trim().toLowerCase();
  const expandable = node.kind === 'section' ? node.children.length > 0 : node.body.length > 0;
  const expanded = filtering ? true : state.expanded.has(node.id);
  out.push({ node, depth, expandable, expanded, bodyLine: null, focusable: true });
  const showChildren = node.kind === 'section' && (filtering || expanded);
  if (showChildren) {
    for (const child of node.children) {
      if (filtering && !nodeMatches(child, needle)) continue; // only the matching paths
      flattenUnder(state, child, depth + 1, filter, out);
    }
  }
  const showBody = node.kind === 'block' && (filtering || expanded);
  if (showBody) {
    for (const line of node.body) out.push({ node, depth, expandable, expanded, bodyLine: line, focusable: false });
  }
}

/** Recompute `rows` from roots + expanded + filter and clamp the cursor. */
export function tuiTreeRefresh(state: TuiTreeState): void {
  const needle = state.filter.trim().toLowerCase();
  const visibleRoots = needle === '' ? state.roots : state.roots.filter((root) => nodeMatches(root, needle));
  const rows: TuiRow[] = [];
  for (const root of visibleRoots) flattenUnder(state, root, 0, needle, rows);
  state.rows = rows;
  if (!rows.some((row) => row.focusable && row.node.id === state.cursor)) {
    state.cursor = rows.find((row) => row.focusable)?.node.id ?? '';
  }
}

export function createTuiTree(roots: TuiNode[], title = 'document'): TuiTreeState {
  const expanded = new Set<string>();
  const collect = (nodes: TuiNode[]): void => {
    for (const node of nodes) {
      // Sections start open (a short document reads top to bottom);
      // blocks start closed (the front line carries the summary).
      if (node.children.length > 0) expanded.add(node.id);
      collect(node.children);
    }
  };
  collect(roots);
  const state: TuiTreeState = {
    title,
    roots,
    expanded,
    cursor: '',
    filter: '',
    filtering: false,
    rows: [],
  };
  tuiTreeRefresh(state);
  return state;
}

function cursorIndex(state: TuiTreeState): number {
  return state.rows.findIndex((row) => row.focusable && row.node.id === state.cursor);
}

/** Move along the focusable rows; wraps at both ends. */
export function tuiTreeMove(state: TuiTreeState, delta: 1 | -1): void {
  if (state.rows.length === 0) return;
  const focusable = state.rows.map((row, i) => (row.focusable ? i : -1)).filter((i) => i >= 0);
  if (focusable.length === 0) return;
  const at = focusable.indexOf(cursorIndex(state));
  const next = at === -1 ? 0 : (at + delta + focusable.length) % focusable.length;
  state.cursor = state.rows[focusable[next]!]!.node.id;
}

/** Toggle the focused row: a section folds its children, a block its body. */
export function tuiTreeToggle(state: TuiTreeState): void {
  const row = state.rows[cursorIndex(state)];
  if (!row || !row.expandable) return;
  if (state.expanded.has(row.node.id)) state.expanded.delete(row.node.id);
  else state.expanded.add(row.node.id);
  tuiTreeRefresh(state);
}

/** The parent of `id` in the tree, or null for a root / unknown id. */
function parentOf(nodes: TuiNode[], id: string, parent: TuiNode | null = null): TuiNode | null {
  for (const node of nodes) {
    if (node.id === id) return parent;
    const found = parentOf(node.children, id, node);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Expand (true) or collapse (false) the focused row. Collapsing an
 * already-collapsed section moves the cursor to its parent — the Left
 * convention from file-tree UIs — so h walks out of the tree.
 */
export function tuiTreeSetExpanded(state: TuiTreeState, on: boolean): void {
  const row = state.rows[cursorIndex(state)];
  if (!row || !row.expandable) return;
  if (on) {
    state.expanded.add(row.node.id);
  } else if (state.expanded.has(row.node.id)) {
    state.expanded.delete(row.node.id);
  } else {
    const parent = parentOf(state.roots, row.node.id);
    if (parent !== null) state.cursor = parent.id;
  }
  tuiTreeRefresh(state);
}

/** Page the cursor by `rows - 1` focusable rows (PgUp / PgDn). */
export function tuiTreePage(state: TuiTreeState, delta: 1 | -1, rows: number): void {
  const step = Math.max(1, rows - 1);
  for (let i = 0; i < step; i++) tuiTreeMove(state, delta);
}

/** The focused row's 1-based index over focusable rows (for `row 3/13`). */
export function tuiTreePosition(state: TuiTreeState): string {
  const focusable = state.rows.filter((row) => row.focusable);
  const at = focusable.findIndex((row) => row.node.id === state.cursor);
  return `row ${focusable.length === 0 ? 0 : at + 1}/${focusable.length}`;
}

/** `q` / `Q` / Escape — the quit keys, the card machine's ladder verbatim. */
export function tuiTreeIsQuit(key: string): boolean {
  return key === 'q' || key === 'Q' || key === 'Escape';
}

export function tuiTreeOpenFilter(state: TuiTreeState): void {
  state.filtering = true;
}

export function tuiTreeCloseFilter(state: TuiTreeState): void {
  state.filtering = false;
}

/** Set the filter text (live — rows re-narrow on every change). */
export function tuiTreeSetFilter(state: TuiTreeState, text: string): void {
  state.filter = text;
  tuiTreeRefresh(state);
}

/* ------------------------------------------------------------------ *
 * The tree machine's key table — v1 parity + the tree keys (§6)
 * ------------------------------------------------------------------ */

/** What the app should do after one key. */
export type TuiTreeKeyResult = 'quit' | 'handled';

function focusableRows(state: TuiTreeState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.rows.length; i++) {
    if (state.rows[i]!.focusable) out.push(i);
  }
  return out;
}

/** Focus the `nth` focusable row (clamped); the g/G/Home/End verb. */
export function tuiTreeMoveTo(state: TuiTreeState, nth: number): void {
  const focusable = focusableRows(state);
  if (focusable.length === 0) return;
  const at = Math.max(0, Math.min(nth, focusable.length - 1));
  state.cursor = state.rows[focusable[at]!]!.node.id;
}

/**
 * One raw-mode key against the tree state. `rows` is the visible tree
 * height (for PgUp/PgDn). While the filter is open every printable key
 * edits the filter text; Escape and Enter close it. Not filtering:
 *
 *   q / Q / Esc  quit              j / ↓ / Ctrl+N   next row
 *   k / ↑ / Ctrl+P  previous row   Enter / Space    toggle
 *   l / →  expand                 h / ←  collapse (Left on a folded
 *                                        section walks out to the parent)
 *   g / Home  first row            G / End  last row
 *   PgDn / PgUp  page              /  open the filter
 *   Ctrl+L  (app repaints)
 */
export function tuiTreeKey(state: TuiTreeState, ev: KeyEvent, rows: number): TuiTreeKeyResult {
  if (state.filtering) {
    if (ev.key === 'Escape' || ev.key === 'Enter') {
      tuiTreeCloseFilter(state);
      return 'handled';
    }
    if (ev.key === 'Backspace') {
      const chars = Array.from(state.filter);
      tuiTreeSetFilter(state, chars.slice(0, -1).join(''));
      return 'handled';
    }
    if (ev.key.length === 1 && !ev.ctrl && !ev.alt && !ev.meta) {
      tuiTreeSetFilter(state, state.filter + ev.key);
    }
    return 'handled';
  }
  const base = ev.key;
  switch (base) {
    case 'q':
    case 'Q':
      return 'quit';
    case 'Escape':
      return 'quit';
    case '/':
      tuiTreeOpenFilter(state);
      return 'handled';
    case 'j':
    case 'ArrowDown':
      tuiTreeMove(state, 1);
      return 'handled';
    case 'k':
    case 'ArrowUp':
      tuiTreeMove(state, -1);
      return 'handled';
    case 'Enter':
    case 'Space':
      tuiTreeToggle(state);
      return 'handled';
    case 'l':
    case 'ArrowRight':
      tuiTreeSetExpanded(state, true);
      return 'handled';
    case 'h':
    case 'ArrowLeft':
      tuiTreeSetExpanded(state, false);
      return 'handled';
    case 'g':
    case 'Home':
      tuiTreeMoveTo(state, 0);
      return 'handled';
    case 'G':
    case 'End':
      tuiTreeMoveTo(state, Number.MAX_SAFE_INTEGER);
      return 'handled';
    case 'PageDown':
      tuiTreePage(state, 1, rows);
      return 'handled';
    case 'PageUp':
      tuiTreePage(state, -1, rows);
      return 'handled';
    default:
      // Ctrl+N / Ctrl+P history-style movement (the cooked table's keys).
      if (ev.ctrl && (ev.key === 'n' || ev.key === 'N')) {
        tuiTreeMove(state, 1);
        return 'handled';
      }
      if (ev.ctrl && (ev.key === 'p' || ev.key === 'P')) {
        tuiTreeMove(state, -1);
        return 'handled';
      }
      return 'handled'; // Ctrl+L and everything else: the app repaints
  }
}
