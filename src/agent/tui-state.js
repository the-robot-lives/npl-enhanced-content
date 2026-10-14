/**
 * TUI state machine for `semtext tui` — pure logic, no terminal IO.
 *
 * Plain JavaScript (not TS) on purpose: bin/semtext.mjs imports it
 * directly, and bins load only built bundles or plain-JS src modules —
 * the same convention src/validate follows.
 *
 * The runner (bin/semtext.mjs) owns the terminal: raw mode, escape
 * sequences, painting. It translates input bytes into logical keys and
 * calls `handleKey`; everything that decides WHAT the screen shows lives
 * here so it can be tested without a pty.
 *
 * Screen model: the document outline as a collapsible tree. A node's
 * children are visible only while it is `expanded`. A search filters no
 * rows — it matches the whole tree (revealing collapsed ancestors of a
 * hit on jump) and moves the cursor between hits. The raw view swaps the
 * tree for the current element's source XHTML.
 */

/** Convert one core OutlineNode into a collapsed TUI node. */
function toTuiNode(o) {
  return {
    id: o.id,
    type: o.type,
    label: o.label,
    summary: o.summary,
    level: o.level,
    children: o.children.map(toTuiNode),
    expanded: false
  };
}

/**
 * @param {import('./index.js').OutlineNode[]} roots
 * @param {Map<string, string>} [sources] block id -> raw source XHTML
 *   (supplied by the runner; may be lazy)
 */
export function createState(roots, sources = new Map()) {
  return {
    roots: roots.map(toTuiNode),
    sources,
    cursor: 0,
    searching: false,
    query: '',
    /** Search hits in document order ({node, path}); may live under collapsed nodes. */
    matches: [],
    matchIdx: 0,
    /** Raw-source panel open for the current node. */
    raw: false,
    /** Transient message for the status line. */
    status: '',
    shouldQuit: false
  };
}

/** Flatten the tree to the rows currently on screen. */
export function visibleRows(state) {
  const rows = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      rows.push({ node: n, depth });
      if (n.expanded && n.children.length) walk(n.children, depth + 1);
    }
  };
  walk(state.roots, 0);
  return rows;
}

export function current(state) {
  const rows = visibleRows(state);
  if (!rows.length) return null;
  return rows[Math.min(state.cursor, rows.length - 1)];
}

/** What the raw panel shows for the current node (null = none kept). */
export function rawSource(state) {
  const row = current(state);
  if (!row) return null;
  const src = state.sources.get(row.node.id);
  return src === undefined ? null : src;
}

function clamp(state) {
  const n = visibleRows(state).length;
  if (state.cursor >= n) state.cursor = Math.max(0, n - 1);
}

export function move(state, delta) {
  const n = visibleRows(state).length;
  if (!n) return state;
  state.cursor = Math.max(0, Math.min(n - 1, state.cursor + delta));
  return state;
}

/** Enter outside search: expand/collapse the current node. */
export function toggle(state) {
  const row = current(state);
  if (!row) return state;
  if (!row.node.children.length) {
    state.status = `${row.node.id}: leaf — nothing to expand`;
    return state;
  }
  row.node.expanded = !row.node.expanded;
  state.status = `${row.node.expanded ? 'expanded' : 'collapsed'} ${row.node.id}`;
  clamp(state);
  return state;
}

/** Open/close the raw-source panel (closes an open search prompt first). */
export function toggleRaw(state) {
  state.searching = false;
  state.raw = !state.raw;
  const row = current(state);
  state.status = state.raw
    ? `raw source: ${row ? row.node.id : '(none)'} — Esc or r to return`
    : 'raw source closed';
  return state;
}

export function searchStart(state) {
  state.searching = true;
  state.query = '';
  state.matches = [];
  state.matchIdx = 0;
  state.raw = false;
  state.status = 'search — Enter jumps/cycles, Esc cancels';
  return state;
}

function rowText(node) {
  return `${node.id} ${node.type} ${node.label} ${node.summary}`.toLowerCase();
}

/** Every node in document order, visible or not, with ancestor chains. */
function flattenAll(roots, path = [], out = []) {
  for (const n of roots) {
    out.push({ node: n, path });
    flattenAll(n.children, [...path, n], out);
  }
  return out;
}

/** Visible-row index of a node, or -1 while it is hidden. */
function visibleIndexOf(state, node) {
  return visibleRows(state).findIndex((r) => r.node === node);
}

/** Reveal a node: expand its ancestor chain, then put the cursor on it. */
function reveal(state, match) {
  for (const a of match.path) a.expanded = true;
  const idx = visibleIndexOf(state, match.node);
  if (idx >= 0) state.cursor = idx;
}

function recompute(state) {
  state.matches = [];
  state.matchIdx = 0;
  if (!state.query) return;
  const q = state.query.toLowerCase();
  const all = flattenAll(state.roots);
  for (const m of all) {
    if (rowText(m.node).includes(q)) state.matches.push(m);
  }
  if (!state.matches.length) {
    state.status = `no matches for "${state.query}"`;
    return;
  }
  // First match at or after the cursor in document order, else wrap.
  const row = current(state);
  const here = all.findIndex((m) => m.node === (row ? row.node : null));
  let idx = state.matches.findIndex((m) => all.indexOf(m) >= here);
  if (idx === -1) idx = 0;
  state.matchIdx = idx;
  reveal(state, state.matches[idx]);
  state.status = `match ${idx + 1}/${state.matches.length} for "${state.query}"`;
}

/** One printable character typed into the search prompt. */
export function searchKey(state, ch) {
  if (!state.searching) return state;
  if (ch.length !== 1) return state;
  state.query += ch;
  recompute(state);
  return state;
}

export function searchBackspace(state) {
  if (!state.searching) return state;
  state.query = state.query.slice(0, -1);
  recompute(state);
  return state;
}

export function searchCancel(state) {
  state.searching = false;
  state.query = '';
  state.matches = [];
  state.matchIdx = 0;
  state.status = 'search cancelled';
  return state;
}

/** Enter in the prompt: jump to the next match AND commit the search
 *  (prompt closes; the query stays active so `n` keeps cycling). */
export function searchNext(state) {
  if (!state.matches.length) {
    recompute(state);
    return state;
  }
  state.matchIdx = (state.matchIdx + 1) % state.matches.length;
  reveal(state, state.matches[state.matchIdx]);
  state.status = `match ${state.matchIdx + 1}/${state.matches.length} for "${state.query}"`;
  return state;
}

export function searchCommit(state) {
  searchNext(state);
  state.searching = false;
  state.status = `${state.status} — n next · / to search again`;
  return state;
}

export function quit(state) {
  state.shouldQuit = true;
  return state;
}

/**
 * The one dispatch table the runner uses. `key` is a logical key:
 * 'up' | 'down' | 'enter' | 'esc' | 'backspace' | 'ctrl-c' | any single
 * printable character. While the search prompt is open every printable
 * character — including `q` — is query text.
 */
export function handleKey(state, key) {
  switch (key) {
    case 'ctrl-c':
      return quit(state);
    case 'up':
      return move(state, -1);
    case 'down':
      return move(state, 1);
    case 'enter':
      return state.searching ? searchCommit(state) : toggle(state);
    case 'esc':
      if (state.raw) return toggleRaw(state);
      if (state.searching) return searchCancel(state);
      state.status = '';
      return state;
    case 'backspace':
      return searchBackspace(state);
    default:
      if (key.length !== 1) return state; // ignore unhandled named keys
      if (state.searching) return searchKey(state, key);
      if (key === 'q') return quit(state);
      if (key === 'j') return move(state, 1);
      if (key === 'k') return move(state, -1);
      if (key === '/') return searchStart(state);
      if (key === 'n') return searchNext(state);
      if (key === 'r') return toggleRaw(state);
      state.status = '';
      return state;
  }
}
