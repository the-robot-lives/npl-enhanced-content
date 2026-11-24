/**
 * draftamo-diagram-model — the pure parse + layout behind `semext-draftamo-diagram`.
 * No Lit, no rendering: authored `<semext-draftamo-node>` / `<semext-draftamo-edge>` children (or a
 * `<semext-draftamo-data>` v1 JSON payload) in, a ranked layout and the portable graph form out.
 * Dependency-free by design: the extract pipeline (src/extract/records.ts) imports this module
 * directly, so it must stay free of Lit, DOM construction and any other import.
 */
export interface DiagramNode { id: string; label: string }
export interface DiagramEdge { from: string; to: string; label: string }
export interface DiagramModel { nodes: DiagramNode[]; edges: DiagramEdge[] }
export interface Box { x: number; y: number; w: number; h: number }
export interface DiagramLayout { pos: Map<string, Box>; width: number; height: number }

/**
 * The native, portable graph payload (THEROB-170): what `<semext-draftamo-data>`
 * carries inline, what extraction emits, and what a saved/exported document
 * rehydrates from. Versioned so future carriers can evolve.
 */
export interface DiagramJson {
  v: 1;
  kind: string;
  label?: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label: string }[];
}

/** Read authored `<semext-draftamo-node id label?>text</…>` and `<semext-draftamo-edge from to label?>` children.
 *  When the authored set is empty, hydrate from an authored `<semext-draftamo-data>` v1 payload
 *  (the JS-written export copy — THEROB-170); authored children always win when present, and an
 *  invalid payload simply leaves the empty model (the element warns once). */
export function parseDiagram(host: Element): DiagramModel {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  let data: string | null = null;
  for (const c of Array.from(host.children)) {
    if (c.hasAttribute('data-sem-chrome')) continue;
    const tag = c.tagName.toLowerCase();
    if (tag === 'semext-draftamo-data') {
      data = c.textContent ?? '';
    } else if (tag === 'semext-draftamo-node') {
      const id = c.getAttribute('id') ?? `n${nodes.length}`;
      const label = c.getAttribute('label') ?? (c.textContent ?? '').trim();
      nodes.push({ id, label: label || id });
    } else if (tag === 'semext-draftamo-edge') {
      edges.push({ from: c.getAttribute('from') ?? '', to: c.getAttribute('to') ?? '', label: c.getAttribute('label') ?? '' });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  if (nodes.length === 0 && edges.length === 0 && data !== null) {
    const hydrated = graphFromJson(data);
    if (hydrated) return hydrated;
  }
  return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

/** The portable v1 form of a parsed model. Deterministic key order; compact when stringified. */
export function graphToJson(model: DiagramModel, o: { kind?: string; label?: string } = {}): DiagramJson {
  return {
    v: 1,
    kind: (o.kind ?? '').trim() || 'uml-class',
    ...(o.label && o.label.trim() ? { label: o.label.trim() } : {}),
    nodes: model.nodes.map((n) => ({ id: n.id, label: n.label })),
    edges: model.edges.map((e) => ({ from: e.from, to: e.to, label: e.label })),
  };
}

/** Parse a v1 `DiagramJson` payload; null when it is not one (shape, version or JSON failure). */
export function graphFromJson(text: string): DiagramModel | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const j = raw as Record<string, unknown>;
  if (j.v !== 1 || typeof j.kind !== 'string' || !Array.isArray(j.nodes) || !Array.isArray(j.edges)) return null;
  const nodes: DiagramNode[] = [];
  const ids = new Set<string>();
  for (const n of j.nodes) {
    if (!n || typeof n !== 'object') return null;
    const { id, label } = n as Record<string, unknown>;
    if (typeof id !== 'string' || !id) return null;
    if (ids.has(id)) continue;
    ids.add(id);
    nodes.push({ id, label: typeof label === 'string' && label ? label : id });
  }
  const edges: DiagramEdge[] = [];
  for (const e of j.edges) {
    if (!e || typeof e !== 'object') return null;
    const { from, to, label } = e as Record<string, unknown>;
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    edges.push({ from, to, label: typeof label === 'string' ? label : '' });
  }
  return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

/** Left-to-right layout by longest-path rank; cycle-safe (a back edge never raises a rank). */
export function layout(model: DiagramModel, o: { w?: number; h?: number; gx?: number; gy?: number; pad?: number } = {}): DiagramLayout {
  const { w = 120, h = 44, gx = 64, gy = 28, pad = 16 } = o;
  const { nodes, edges } = model;
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) {
      if (rank.get(e.to)! <= rank.get(e.from)! && rank.get(e.from)! + 1 < nodes.length) rank.set(e.to, rank.get(e.from)! + 1);
    }
  }
  const rows = new Map<number, number>();
  const pos = new Map<string, Box>();
  for (const n of nodes) {
    const r = rank.get(n.id)!;
    const row = rows.get(r) ?? 0;
    rows.set(r, row + 1);
    pos.set(n.id, { x: pad + r * (w + gx), y: pad + row * (h + gy), w, h });
  }
  const boxes = [...pos.values()];
  return {
    pos,
    width: Math.max(0, ...boxes.map((p) => p.x + p.w)) + pad,
    height: Math.max(0, ...boxes.map((p) => p.y + p.h)) + pad,
  };
}

/** Plain-text summary ("Hello → World"), used for the SVG's accessible name. */
export function describe(model: DiagramModel): string {
  const label = new Map(model.nodes.map((n) => [n.id, n.label]));
  return model.edges.length
    ? model.edges.map((e) => `${label.get(e.from)} → ${label.get(e.to)}`).join(', ')
    : model.nodes.map((n) => n.label).join(', ');
}
