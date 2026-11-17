/**
 * draftamo-diagram-3d-adapter — maps a parsed DiagramModel ({id,label} nodes +
 * {from,to,label} edges) onto the Draftamo 3D viewer's GraphDocument schema
 * (draftamo-render `src/holograph/types.ts`, READ-ONLY contract — types are
 * mirrored structurally here; this repo never imports the cross-repo module).
 *
 * Every schema-required field is DERIVED, never invented:
 *   - node.kind   = "class"   (a valid key of the generated KIND_REGISTRY)
 *   - description = ""        · metrics = zeros
 *   - trd3d.position/dimensions come from the shared 2D `layout()` boxes
 *     (center-x / flat-y / center-z) — without these every node sits at the
 *     renderer's (0,0,0) default and the pile overlaps.
 *   - edge.kind = "depends_on" (neutral member of the EdgeKind union)
 */

import { layout, type DiagramModel } from './draftamo-diagram-model.js';

/** Structural mirror of draftamo-render GraphNode (required fields only + trd3d). */
export interface ViewerNode {
  id: string;
  label: string;
  kind: string;
  description: string;
  metrics: { complexity: number; churn: number; risk: number };
  trd3d?: { position?: { x: number; y: number; z: number }; dimensions?: { width: number; height: number; depth: number } };
}

/** Structural mirror of draftamo-render GraphEdge. */
export interface ViewerEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
  label: string;
}

/** Structural mirror of draftamo-render GraphDocument (required fields only). */
export interface ViewerDocument {
  id: string;
  slug: string;
  title: string;
  version: number;
  updatedAt: string;
  summary: string;
  nodes: ViewerNode[];
  edges: ViewerEdge[];
}

/** Map the parsed inline model onto the viewer's GraphDocument schema. */
export function toViewerDocument(model: DiagramModel, o: { id?: string; title?: string } = {}): ViewerDocument {
  const title = o.title ?? 'Diagram';
  const id = o.id ?? 'semext-draftamo-diagram';
  const { pos } = layout(model);
  return {
    id,
    slug: id,
    title,
    version: 1,
    updatedAt: new Date().toISOString(),
    summary: title,
    nodes: model.nodes.map((n) => {
      const b = pos.get(n.id)!;
      return {
        id: n.id,
        label: n.label,
        kind: 'class',
        description: '',
        metrics: { complexity: 0, churn: 0, risk: 0 },
        trd3d: {
          position: { x: b.x + b.w / 2, y: 0, z: b.y + b.h / 2 },
          dimensions: { width: b.w, height: b.h, depth: b.h },
        },
      };
    }),
    edges: model.edges.map((e, i) => ({
      id: `e${i}`,
      sourceId: e.from,
      targetId: e.to,
      kind: 'depends_on',
      label: e.label ?? '',
    })),
  };
}

/**
 * The module the element lazily loads (`viewer-src`). Kept as an injectable
 * indirection so unit tests can stand in a fake `{ createViewer }` module
 * without a real ESM import of a runtime-supplied URL.
 */
export type ViewerModule = { createViewer: (host: HTMLElement, opts?: unknown) => ViewerInstance };
export interface ViewerInstance {
  setDocument(doc: ViewerDocument, opts?: { tracedEdgeIds?: Set<string> | null }): void;
  start(): void;
  stopLoop(): void;
  dispose(): void;
}
export type ViewerImporter = (src: string) => Promise<ViewerModule>;

let importer: ViewerImporter = (src) => import(/* @vite-ignore */ src) as Promise<ViewerModule>;

/** Test hook: swap the dynamic importer (pass null to restore the default). */
export function setViewerImporterForTests(fn: ViewerImporter | null): void {
  importer = fn ?? ((src) => import(/* @vite-ignore */ src) as Promise<ViewerModule>);
}

export function importViewerModule(src: string): Promise<ViewerModule> {
  return importer(src);
}
