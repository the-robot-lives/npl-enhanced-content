/**
 * tui-app — the `semtext tui` full-screen app (CORE-V2 §6).
 *
 * A guest on the alternate screen: the AppRunner owns the lifecycle, this
 * app owns every cell while it runs. State is the pure tree machine from
 * `tui.ts` (`TuiTreeState`); this module is the paint + input shell —
 *
 *   row 0      header: `semtext tui — <title>` + row count
 *   row 1      blank
 *   rows 2…R-2 the tree (one TuiRow per line; blocks open under them)
 *   row R-1    the filter row while filtering, else the key hint
 *
 * Colour is SGR and NAMED-ANSI only (bold/dim/reverse + 30–37): the
 * palette resolves the named slots to the active theme at paint time, so
 * dark and light terminals both read correctly with no theme state here.
 * The cursor row is SGR 7 (reverse) — stored, never baked (§4.1).
 *
 * Keys are the machine's table (`tuiTreeKey`): v1 parity (j/k, Enter,
 * '/', q/Esc) plus h/l, g/G, Home/End, PgUp/PgDn and the arrows. The
 * app requests mouse reporting: a click focuses a row and expands a
 * collapsed section under it; the wheel scrolls the window.
 */

import type { App, AppContext, KeyEvent, MouseEvent } from './screen/types.js';
import {
  createTuiTree,
  tuiTreeKey,
  tuiTreeOpenFilter,
  tuiTreePosition,
  tuiTreeRefresh,
  tuiTreeSetFilter,
  type TuiNode,
  type TuiRow,
  type TuiTreeState,
} from './tui.js';

/** SGR reset — every styled span ends with this. */
const SGR_RESET = '\x1b[0m';
const SGR_BOLD = '\x1b[1m';
const SGR_DIM = '\x1b[2m';
const SGR_REVERSE = '\x1b[7m';
const SGR_CYAN = '\x1b[36m';
const SGR_BOLD_CYAN = '\x1b[1;36m';
const SGR_YELLOW = '\x1b[33m';

/** Row 0 header; rows 2…R-2 tree; row R-1 hint/filter. */
const HEADER_ROW = 0;
const TREE_TOP = 2;
const HINT_ROWS = 1;
const TREE_ROW = (rows: number): number => Math.max(1, rows - TREE_TOP - HINT_ROWS);

/** Plain-text cell width of an SGR-bearing string (escapes are 0-wide). */
function plainLength(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Truncate a styled line to `cols - 1` CELLS (never trips pendingWrap). */
function clampCells(text: string, cols: number): string {
  const limit = Math.max(0, cols - 1);
  let cells = 0;
  let inEscape = false;
  let out = '';
  for (const ch of text) {
    if (inEscape) {
      out += ch;
      if (ch === 'm') inEscape = false;
      continue;
    }
    if (ch === '\x1b') {
      inEscape = true;
      out += ch;
      continue;
    }
    if (cells >= limit) break;
    out += ch;
    cells += 1;
  }
  return out;
}

/** One tree row's styled text (no indent padding beyond `depth * 2`). */
function rowText(row: TuiRow, reverse: boolean): string {
  const indent = '  '.repeat(row.depth);
  if (row.bodyLine !== null) {
    const text = `${SGR_DIM}${indent}  ${row.bodyLine}${SGR_RESET}`;
    return reverse ? `${SGR_REVERSE}${indent}  ${row.bodyLine}${SGR_RESET}` : text;
  }
  const node = row.node;
  const marker =
    node.kind === 'section' ? (row.expandable ? (row.expanded ? '▾ ' : '▸ ') : '  ') : row.expandable ? (row.expanded ? '▾ ' : '▸ ') : '· ';
  const label = `${indent}${marker}${node.number !== '' ? `${node.number} ` : ''}${node.label}`;
  if (node.kind === 'section') {
    const num = node.number !== '' ? `${SGR_BOLD_CYAN}${node.number}${SGR_RESET} ` : '';
    const head = node.level <= 2 ? SGR_BOLD : '';
    return reverse
      ? `${SGR_REVERSE}${indent}${marker}${num}${node.label}${SGR_RESET}`
      : `${indent}${marker}${num}${head}${node.label}${SGR_RESET}`;
  }
  const meta = node.meta !== '' ? ` ${SGR_DIM}${node.meta}${SGR_RESET}` : '';
  return reverse
    ? `${SGR_REVERSE}${indent}${marker}${node.label}${SGR_RESET}${meta}`
    : `${indent}${marker}${node.label}${meta}`;
}

/**
 * The app. `createTuiApp(roots, title)` → an `App` for `CommandSpec.app`
 * to return; the runner spawns it on the alternate screen (tty only).
 */
export function createTuiApp(roots: TuiNode[], title: string): App {
  const state: TuiTreeState = createTuiTree(roots, title);
  let api: AppContext | null = null;
  let top = 0;

  const treeRows = (): number => (api === null ? 24 : TREE_ROW(api.rows));

  /** Slide `top` so the cursor row is on screen; returns true when it moved. */
  function ensureVisible(): boolean {
    const rows = state.rows;
    const height = treeRows();
    const focusable = rows.map((row, index) => (row.focusable ? index : -1)).filter((index) => index >= 0);
    const at = focusable.findIndex((index) => rows[index]!.node.id === state.cursor);
    const cursorIndex = at === -1 ? 0 : focusable[at]!;
    top = Math.max(0, Math.min(top, Math.max(0, rows.length - height)));
    top = Math.max(0, Math.min(top, cursorIndex));
    top = Math.max(top, cursorIndex - height + 1);
    top = Math.max(0, Math.min(top, Math.max(0, rows.length - height)));
    return true;
  }

  /** The visible slice of rows for the tree area (padded to the height). */
  function window(): { row: TuiRow; index: number }[] {
    ensureVisible();
    const slice: { row: TuiRow; index: number }[] = [];
    for (let i = 0; i < treeRows(); i++) {
      const row = state.rows[top + i];
      if (row !== undefined) slice.push({ row, index: top + i });
    }
    return slice;
  }

  function hint(filtering: boolean): string {
    if (filtering) {
      return `${SGR_DIM}filter:${SGR_RESET} ${SGR_YELLOW}${state.filter}_${SGR_RESET}${SGR_DIM}  Enter/Esc end${SGR_RESET}`;
    }
    return `${SGR_DIM}j/k move · Enter toggle · h/l fold · g/G ends · / filter · q close${SGR_RESET}`;
  }

  function header(rows: number): string {
    const focusable = state.rows.filter((row) => row.focusable).length;
    const right = `${SGR_DIM}${tuiTreePosition(state)} of ${focusable} rows${SGR_RESET}`;
    const left = `${SGR_BOLD}semtext tui — ${title}${SGR_RESET}`;
    const pad = Math.max(1, rows - plainLength(left).length - plainLength(right).length);
    return clampCells(`${left}${' '.repeat(pad)}${right}`, rows);
  }

  function repaint(): void {
    if (api === null) return;
    const cols = api.cols;
    const rows = api.rows;
    api.screen.eraseDisplay(2);
    api.screen.moveTo(0, HEADER_ROW);
    api.screen.write(header(cols));
    const view = window();
    for (let i = 0; i < view.length; i++) {
      const entry = view[i]!;
      const { row } = entry;
      const focused = row.focusable && row.node.id === state.cursor;
      api.screen.moveTo(0, TREE_TOP + i);
      api.screen.write(clampCells(rowText(row, focused), cols));
    }
    api.screen.moveTo(0, rows - 1);
    api.screen.write(clampCells(hint(state.filtering), cols));
  }

  function status(): void {
    if (api === null) return;
    const focusable = state.rows.filter((row) => row.focusable).length;
    api.setStatus(
      state.filter !== '' ? `filter "${state.filter}" — ${focusable} of ${state.rows.filter((r) => r.focusable).length} rows` : `${focusable} rows`,
      'idle',
    );
  }

  function afterChange(): void {
    repaint();
    status();
  }

  return {
    id: 'semtext-tui',
    start(context: AppContext): void {
      api = context;
      api.requestMouse(true);
      api.screen.setCursorVisible(false);
      api.setTitle(`${title} — semtext tui`);
      afterChange();
    },
    key(ev: KeyEvent): void {
      if (api === null) return;
      if (tuiTreeKey(state, ev, treeRows()) === 'quit') {
        api.exit(0);
        return;
      }
      afterChange();
    },
    resize(): void {
      afterChange();
    },
    paste(text: string): void {
      if (!state.filtering) return;
      const line = text.split('\n')[0] ?? '';
      if (line !== '') tuiTreeSetFilter(state, state.filter + line);
      afterChange();
    },
    mouse(ev: MouseEvent): void {
      if (api === null) return;
      if (ev.kind === 'wheel') {
        const delta = ev.dy !== 0 ? ev.dy : ev.dx;
        if (delta === 0) return;
        const height = treeRows();
        top = Math.max(0, Math.min(top + delta, Math.max(0, state.rows.length - height)));
        // Focus follows the view: keep the cursor on a visible row.
        const view = window();
        const visible = view.filter((entry) => entry.row.focusable);
        if (visible.length > 0 && !visible.some((entry) => entry.row.node.id === state.cursor)) {
          state.cursor = visible[0]!.row.node.id;
        }
        afterChange();
        return;
      }
      if (ev.kind !== 'press' || ev.button !== 0) return;
      const treeRow = ev.row - TREE_TOP;
      if (treeRow < 0) return;
      const entry = window()[treeRow];
      const row = entry?.row;
      if (!row || !row.focusable) return;
      state.cursor = row.node.id;
      if (row.expandable && !row.expanded) state.expanded.add(row.node.id); // click focuses, then expands
      tuiTreeRefresh(state);
      afterChange();
    },
    stop(): void {
      // DECSC saves position+attrs, not DECTCEM — restore visibility.
      api?.screen.setCursorVisible(true);
      api = null;
    },
    a11ySummary(): string {
      const row = state.rows.find((entry) => entry.focusable && entry.node.id === state.cursor);
      return `semtext tui — ${title}: ${tuiTreePosition(state)}, ${row?.node.label ?? 'no rows'}`;
    },
    find(): void {
      tuiTreeOpenFilter(state);
      afterChange();
    },
  };
}

/** Exposed for tests: refresh + repaint a live app after out-of-band edits. */
export function tuiAppRepaintForTests(state: TuiTreeState): void {
  tuiTreeRefresh(state);
}
