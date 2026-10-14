/**
 * tui — the read-only flashcard view behind `semtext tui <file>`
 * (src/terminal/PLUGINS.md § the TUI action).
 *
 * A pure, DOM-free state machine: cards in, keys in, state out. The
 * command side (`semtext tui`) turns a document's records into cards and
 * emits a DATA-only TuiAction; the element owns the boxed panels and the
 * keyboard, drives this machine, and renders its state. Read-only: nothing
 * here writes, fetches, or mutates the document.
 *
 * Keys: j / ArrowDown next · k / ArrowUp previous · Enter expand/collapse ·
 * '/' open the filter · q / Escape close. The filter narrows to cards
 * whose front or back contains the text (case-insensitive); movement and
 * expansion work only over the visible cards.
 */

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
