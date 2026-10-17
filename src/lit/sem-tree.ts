/**
 * sem-tree — the shared engine behind sem-site-tree + sem-file-tree
 * (spec/schema/sem-site-tree.md, spec/schema/sem-file-tree.md).
 *
 * One internal model, two authoring forms: a structured container of bare
 * `<node path label kind>` children (element children or `.sem-node`
 * classed divs) and an indented unicode/whitespace tree inside a `<pre>`
 * (`<sem-file-tree mode="text">`). Both parse to the same TreeNode model;
 * the interactive chrome — per-node collapse, filter box, find box — is
 * built once here (TreeHost) and shared by the two thin registrations.
 *
 * The parsers, filter and find logic are PURE (exported for the unit
 * tier): no DOM is touched except through the authored container, and the
 * authored DOM stays the record — the JS-off page renders the nodes/pre
 * as-is with CSS guides, counters and attribute labels, and every
 * generated class (`.sem-tree-chrome`, `.sem-tree-toggle`,
 * `.sem-file-tree-view`) carries no record text. All hide/interactive
 * rules gate on the container's `[data-sem-upgraded]` marker (D12).
 *
 * This module registers nothing: it carries no `SemElement.register`
 * call, so the lazy manifest scan skips it and the two registration
 * chunks import it as their shared factored chunk.
 */

import { SemElement } from './base.js';

/** One tree entry. `label`/`kind` are optional author-facing refinements
 *  of `path`; `el` links a structured node to its authored element (null
 *  for text-mode rows, which generate their own row elements). */
export interface TreeNode {
  path: string;
  label: string | null;
  kind: string | null;
  children: TreeNode[];
  el: Element | null;
}

export interface TreeContainer {
  roots: TreeNode[];
  mode: 'structured' | 'text';
}

/** Structured form: recursive walk of the container's node children. */
export function parseStructuredTree(container: ParentNode): TreeNode[] {
  const out: TreeNode[] = [];
  for (const el of Array.from(container.children)) {
    if (el.localName !== 'node' && !el.classList.contains('sem-node')) continue;
    out.push({
      path: el.getAttribute('data-path') ?? el.getAttribute('path') ?? '',
      label: el.getAttribute('data-label') ?? el.getAttribute('label'),
      kind: el.getAttribute('data-kind') ?? el.getAttribute('kind'),
      children: parseStructuredTree(el),
      el,
    });
  }
  return out;
}

const BOX = /[│├└─]/;

/** Text form: indentation → the same model. Box-drawing prefixes
 *  (`├── `, `│   `, `└── `, blank four-space segments) measure depth in
 *  4-column segments; plain indentation measures in the smallest positive
 *  indent unit the listing uses. A trailing `/` marks a directory. */
export function parseTreeText(text: string): TreeNode[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  const box = lines.some((l) => BOX.test(l));
  let unit = 0;
  if (!box) {
    for (const l of lines) {
      const spaces = l.length - l.trimStart().length;
      if (spaces > 0 && (unit === 0 || spaces < unit)) unit = spaces;
    }
    if (unit === 0) unit = 2;
  }
  const roots: TreeNode[] = [];
  const stack: { node: TreeNode; depth: number }[] = [];
  for (const line of lines) {
    const prefix = (line.match(/^[\s│├└─]*/) ?? [''])[0];
    const name = line.slice(prefix.length).trim();
    if (!name) continue;
    const depth = box
      ? (prefix.match(/[│├└]\s{0,3}|\s{4}/g) ?? []).length
      : Math.round(prefix.length / unit);
    const isDir = name.endsWith('/');
    const node: TreeNode = {
      path: name.replace(/\/$/, ''),
      label: null,
      kind: isDir ? 'dir' : null,
      children: [],
      el: null,
    };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
    stack.push({ node, depth });
  }
  return roots;
}

/** Dispatch on authored content: node children → structured; else the
 *  first `<pre>` → text. An explicit `mode` attribute overrides. */
export function parseTreeContainer(el: Element, modeAttr?: string | null): TreeContainer {
  const mode = modeAttr === 'text' || modeAttr === 'structured' ? modeAttr : null;
  const structured = parseStructuredTree(el);
  if (mode !== 'text' && (structured.length > 0 || mode === 'structured')) {
    return { roots: structured, mode: 'structured' };
  }
  const pre = el.querySelector('pre');
  return { roots: parseTreeText(pre ? pre.textContent ?? '' : ''), mode: 'text' };
}

export interface FlatNode {
  id: number;
  node: TreeNode;
  parent: FlatNode | null;
  depth: number;
}

/** Document-order flattening — ids are stable per parse, which the find
 *  cycler and the filter's ancestor walks rely on. */
export function flattenTree(roots: TreeNode[]): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (nodes: TreeNode[], parent: FlatNode | null, depth: number): void => {
    for (const node of nodes) {
      const flat: FlatNode = { id: out.length, node, parent, depth };
      out.push(flat);
      walk(node.children, flat, depth + 1);
    }
  };
  walk(roots, null, 0);
  return out;
}

const matchesQuery = (n: TreeNode, q: string): boolean =>
  n.path.toLowerCase().includes(q) || (n.label ?? '').toLowerCase().includes(q);

export interface TreeFilterResult {
  /** null = empty query: everything visible, no markers to clear. */
  kept: Set<TreeNode> | null;
  /** Branch roots the filter must force open (ancestors of matches). */
  open: Set<TreeNode>;
}

/** Filter: a node stays visible iff it or any descendant matches; every
 *  ancestor of a kept node is kept too (the ancestor chain never
 *  disappears) and forced open so the match is actually reachable. */
export function filterTree(roots: TreeNode[], query: string): TreeFilterResult {
  const q = query.trim().toLowerCase();
  if (!q) return { kept: null, open: new Set() };
  const kept = new Set<TreeNode>();
  const open = new Set<TreeNode>();
  const walk = (node: TreeNode): boolean => {
    let childHit = false;
    for (const c of node.children) if (walk(c)) childHit = true;
    if (matchesQuery(node, q) || childHit) {
      kept.add(node);
      if (childHit) open.add(node);
      return true;
    }
    return false;
  };
  for (const r of roots) walk(r);
  return { kept, open };
}

/** Find: every node whose path or label matches, document order — the
 *  caller marks them and cycles `data-match-current` on Enter. */
export function findInTree(roots: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  const out: TreeNode[] = [];
  if (!q) return out;
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (matchesQuery(n, q)) out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Ancestor ids of a flat node, root-first — the find cycler opens these
 *  so the current match is never hidden inside a collapsed branch. */
export function ancestorsOf(flat: FlatNode): FlatNode[] {
  const out: FlatNode[] = [];
  for (let p = flat.parent; p; p = p.parent) out.unshift(p);
  return out;
}

/**
 * TreeHost — shared behaviour for both tree containers. The subclass
 * registrations exist so each tag ships its own lazy chunk keyed by the
 * build's manifest scan; everything they do lives here.
 */
export class TreeHost extends SemElement {
  #wired = false;

  updated(): void {
    if (this.#wired) return;
    this.afterParse('sem-tree', () => {
      if (!this.#wired && this.isConnected) {
        this.#wired = true;
        this.#build();
      }
    });
  }

  #build(): void {
    const { roots, mode } = parseTreeContainer(this, this.getAttribute('data-mode') ?? this.getAttribute('mode'));
    const flat = flattenTree(roots);
    if (flat.length === 0) return;

    // Text mode: the authored <pre> stays the record (CSS hides it only
    // under the upgrade marker); the interactive view is generated rows.
    if (mode === 'text') {
      const view = document.createElement('div');
      view.className = 'sem-file-tree-view';
      for (const f of flat) {
        const row = document.createElement('div');
        row.className = 'sem-tree-view-row';
        row.setAttribute('data-depth', String(f.depth));
        row.style.paddingLeft = `calc(${f.depth} * 1.1rem + .25rem)`;
        f.node.el = row;
        // rows join the view in document order; toggles attach below
        view.appendChild(row);
      }
      this.appendChild(view);
    }

    // Decorate every node: branch nodes grow a toggle button carrying the
    // label text; leaves grow a label span (the CSS ::before attr() label
    // is the JS-off rendering and stops under the upgrade marker, so both
    // shapes need an explicit JS-on label). Stable data-node-id for the
    // chrome's lookups.
    const byId = (n: TreeNode): HTMLElement => n.el as HTMLElement;

    // Text rows are flat siblings: a collapsed branch must hide its
    // descendant ROWS explicitly (no nesting for CSS to inherit).
    const applyTextCollapse = (): void => {
      if (mode !== 'text') return;
      const closed = new Set<number>();
      for (const f of flat) {
        const el = byId(f.node);
        const blocked = f.parent !== null && closed.has(f.parent.id);
        el.toggleAttribute('data-branch-hidden', blocked);
        if (blocked || el.hasAttribute('collapsed')) closed.add(f.id);
      }
    };

    for (const f of flat) {
      const el = byId(f.node);
      el.setAttribute('data-node-id', String(f.id));
      const name = f.node.label ?? f.node.path;
      if (f.node.children.length > 0) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sem-tree-toggle';
        const collapsed = el.hasAttribute('collapsed');
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${name}`);
        btn.textContent = name;
        el.insertBefore(btn, el.firstChild);
        btn.addEventListener('click', () => {
          const nowCollapsed = !el.hasAttribute('collapsed');
          el.toggleAttribute('collapsed', nowCollapsed);
          btn.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
          btn.setAttribute('aria-label', `${nowCollapsed ? 'Expand' : 'Collapse'} ${name}`);
          applyTextCollapse();
        });
      } else {
        const labelSpan = document.createElement('span');
        labelSpan.className = 'sem-tree-label';
        labelSpan.textContent = name;
        el.insertBefore(labelSpan, el.firstChild);
      }
    }

    // Chrome: filter + find + count. Generated chrome, classed, gated.
    const chrome = document.createElement('div');
    chrome.className = 'sem-tree-chrome';
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'sem-tree-filter';
    filter.setAttribute('aria-label', `Filter ${this.localName}`);
    filter.placeholder = 'Filter…';
    const find = document.createElement('input');
    find.type = 'search';
    find.className = 'sem-tree-find';
    find.setAttribute('aria-label', `Find in ${this.localName}`);
    find.placeholder = 'Find… (Enter cycles matches)';
    const count = document.createElement('span');
    count.className = 'sem-tree-count';
    count.setAttribute('role', 'status');
    chrome.appendChild(filter);
    chrome.appendChild(find);
    chrome.appendChild(count);
    this.insertBefore(chrome, this.firstChild);

    filter.addEventListener('input', () => {
      const { kept, open } = filterTree(roots, filter.value);
      for (const f of flat) {
        const el = byId(f.node);
        if (kept === null) {
          el.removeAttribute('data-filter-hidden');
        } else {
          el.toggleAttribute('data-filter-hidden', !kept.has(f.node));
        }
      }
      // matches must be reachable: force their ancestor chain open
      if (kept !== null) {
        for (const f of flat) {
          if (!open.has(f.node)) continue;
          const el = byId(f.node);
          el.removeAttribute('collapsed');
          el.querySelector('.sem-tree-toggle')?.setAttribute('aria-expanded', 'true');
        }
        applyTextCollapse();
      }
      count.textContent = kept === null ? '' : `${kept.size} shown`;
    });

    let matches: FlatNode[] = [];
    let cursor = -1;

    const setCurrent = (i: number): void => {
      for (const m of matches) byId(m.node).removeAttribute('data-match-current');
      cursor = i;
      if (cursor < 0) return;
      const cur = matches[cursor];
      const el = byId(cur.node);
      el.setAttribute('data-match-current', '');
      for (const a of ancestorsOf(cur)) {
        const ae = byId(a.node);
        ae.removeAttribute('collapsed');
        ae.querySelector('.sem-tree-toggle')?.setAttribute('aria-expanded', 'true');
      }
      applyTextCollapse();
      el.scrollIntoView({ block: 'nearest' });
    };

    find.addEventListener('input', () => {
      // map found nodes back to their build-time flat entries by node
      // identity — flattenTree renumbers ids over the subset, so an id
      // from a re-flatten must never index the build-time array
      const flatByNode = new Map(flat.map((f) => [f.node, f]));
      matches = findInTree(roots, find.value)
        .map((n) => flatByNode.get(n))
        .filter((f) => Boolean(f));
      for (const f of flat) {
        const el = byId(f.node);
        el.removeAttribute('data-match');
        el.removeAttribute('data-match-current');
      }
      for (const m of matches) byId(m.node).setAttribute('data-match', '');
      count.textContent = matches.length ? `0 of ${matches.length}` : '';
      cursor = -1;
    });

    find.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || matches.length === 0) return;
      e.preventDefault();
      setCurrent((cursor + 1) % matches.length);
      count.textContent = `${cursor + 1} of ${matches.length}`;
    });
  }
}
