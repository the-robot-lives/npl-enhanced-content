// @vitest-environment happy-dom
// Unit spec — draftamo-diagram-3d-adapter (src/lit/semext/), contract: the
// draftamo-render viewer's GraphDocument schema (cross-repo, READ-ONLY:
// app/frontend/packages/draftamo-render/src/holograph/types.ts).
//
// Feature: semext-draftamo-diagram viewer-src — an optional lazy 3D view
//   Scenario: the adapter maps nodes/edges onto the GraphDocument schema with only derived fields
//   Scenario: the element lazily imports viewer-src, calls createViewer(host) + setDocument + start
//   Scenario: an import/construction failure warns and keeps the 2D SVG fallback
//   Scenario: no viewer-src attribute = today's 2D behavior, untouched

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SemextDraftamoDiagram } from '../../src/lit/semext/semext-draftamo-diagram.js';
import { parseDiagram } from '../../src/lit/semext/draftamo-diagram-model.js';
import { setViewerImporterForTests, toViewerDocument, type ViewerInstance } from '../../src/lit/semext/draftamo-diagram-3d-adapter.js';
import '../../src/lit/semext/index.js';

const HELLO = '<node id="a">Hello</node><edge from="a" to="b" label="uses"></edge><node id="b">World</node>';

function modelOf(inner: string) {
  const host = document.createElement('div');
  host.innerHTML = inner;
  return parseDiagram(host);
}

async function mount(inner: string, attrs: Record<string, string> = {}): Promise<SemextDraftamoDiagram> {
  const el = document.createElement('semext-draftamo-diagram') as SemextDraftamoDiagram;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = inner;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  setViewerImporterForTests(null);
  vi.restoreAllMocks();
});

describe('draftamo-diagram-3d-adapter', () => {
  it('maps nodes/edges onto the GraphDocument schema (derived fields only)', () => {
    const doc = toViewerDocument(modelOf(HELLO), { id: 'd1', title: 'Hello (uml-class)' });
    expect(doc.id).toBe('d1');
    expect(doc.slug).toBe('d1');
    expect(doc.title).toBe('Hello (uml-class)');
    expect(doc.version).toBe(1);
    expect(typeof doc.updatedAt).toBe('string');
    expect(doc.summary).toBe('Hello (uml-class)');
    expect(doc.nodes).toHaveLength(2);
    expect(doc.nodes[0]).toMatchObject({
      id: 'a',
      label: 'Hello',
      kind: 'class', // valid key of the generated KIND_REGISTRY
      description: '',
      metrics: { complexity: 0, churn: 0, risk: 0 },
    });
    // Position/dimensions derived from the shared layout boxes (no origin pile).
    expect(doc.nodes[0].trd3d!.position).toEqual({ x: expect.any(Number), y: 0, z: expect.any(Number) });
    expect(doc.nodes[0].trd3d!.dimensions).toEqual({ width: 120, height: 44, depth: 44 });
    const b0 = doc.nodes[0].trd3d!.position!;
    const b1 = doc.nodes[1].trd3d!.position!;
    expect(b1.x).toBeGreaterThan(b0.x); // ranked left to right
    expect(doc.edges).toEqual([{ id: 'e0', sourceId: 'a', targetId: 'b', kind: 'depends_on', label: 'uses' }]);
  });

  it('viewer-src: lazily imports the module, createViewer(host) + setDocument + start', async () => {
    const viewer: ViewerInstance = { setDocument: vi.fn(), start: vi.fn(), stopLoop: vi.fn(), dispose: vi.fn() };
    const createViewer = vi.fn(() => viewer);
    setViewerImporterForTests(() => Promise.resolve({ createViewer }));
    const el = await mount(HELLO, { 'viewer-src': 'https://cdn.example/draftamo-viewer.js' });
    await new Promise((r) => setTimeout(r, 20));
    expect(createViewer).toHaveBeenCalledTimes(1);
    expect(createViewer.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
    expect(el.querySelector('[data-sem-chrome]')).toBeTruthy();
    const host = createViewer.mock.calls[0][0] as HTMLElement;
    expect(el.querySelector('[data-sem-chrome]')!.contains(host)).toBe(true);
    expect(viewer.setDocument).toHaveBeenCalledTimes(1);
    const [doc, opts] = viewer.setDocument.mock.calls[0];
    expect(doc.nodes.map((n: { id: string }) => n.id)).toEqual(['a', 'b']);
    expect(doc.edges).toHaveLength(1);
    expect(opts).toEqual({ tracedEdgeIds: expect.any(Set) });
    expect(viewer.start).toHaveBeenCalledTimes(1);
    // 3D view replaced the 2D SVG.
    expect(el.querySelector('[data-sem-chrome] svg')).toBeNull();
    expect(el.querySelector('[data-sem-chrome] .semext-draftamo-diagram-viewer')).toBe(host);
    el.remove();
  });

  it('import rejection: warns and keeps the 2D SVG fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setViewerImporterForTests(() => Promise.reject(new Error('offline')));
    const el = await mount(HELLO, { 'viewer-src': 'https://cdn.example/draftamo-viewer.js' });
    await new Promise((r) => setTimeout(r, 20));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('2D SVG');
    // 2D fallback intact, no half-mounted viewer host.
    expect(el.querySelector('[data-sem-chrome] svg')).toBeTruthy();
    expect(el.querySelector('.semext-draftamo-diagram-viewer')).toBeNull();
    el.remove();
  });

  it('no viewer-src: 2D SVG unchanged', async () => {
    const importer = vi.fn();
    setViewerImporterForTests(importer);
    const el = await mount(HELLO);
    await new Promise((r) => setTimeout(r, 20));
    expect(importer).not.toHaveBeenCalled();
    expect(el.querySelector('[data-sem-chrome] svg')).toBeTruthy();
    expect(el.querySelectorAll('[data-sem-chrome] rect')).toHaveLength(2);
    el.remove();
  });
});
