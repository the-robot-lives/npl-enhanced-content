/**
 * draftamo-diagram-model — the pure parse + layout behind `semext-draftamo-diagram`.
 * No Lit, no rendering: authored `<semext-draftamo-node>` / `<semext-draftamo-edge>` children in, a ranked layout out.
 */
export interface DiagramNode { id: string; label: string }
export interface DiagramEdge { from: string; to: string; label: string }
export interface DiagramModel { nodes: DiagramNode[]; edges: DiagramEdge[] }
export interface Box { x: number; y: number; w: number; h: number }
export interface DiagramLayout { pos: Map<string, Box>; width: number; height: number }

/** Read authored `<semext-draftamo-node id label?>text</…>` and `<semext-draftamo-edge from to label?>` children. */
export function parseDiagram(host: Element): DiagramModel {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  for (const c of Array.from(host.children)) {
    if (c.hasAttribute('data-sem-chrome')) continue;
    const tag = c.tagName.toLowerCase();
    if (tag === 'semext-draftamo-node') {
      const id = c.getAttribute('id') ?? `n${nodes.length}`;
      const label = c.getAttribute('label') ?? (c.textContent ?? '').trim();
      nodes.push({ id, label: label || id });
    } else if (tag === 'semext-draftamo-edge') {
      edges.push({ from: c.getAttribute('from') ?? '', to: c.getAttribute('to') ?? '', label: c.getAttribute('label') ?? '' });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
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
