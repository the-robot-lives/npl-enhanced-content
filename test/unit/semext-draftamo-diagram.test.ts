// @vitest-environment happy-dom
// Unit spec — semext-draftamo-diagram (src/lit/semext/), contract: spec/schema/semext/draftamo-diagram.md
//
// Feature: an inline Draftamo diagram from authored <semext-draftamo-node>/<semext-draftamo-edge> children
//   Scenario: the tag registers through defineSemext
//   Scenario: parseDiagram reads node labels from the attribute or the text, and drops edges to unknown nodes
//   Scenario: layout ranks left to right and survives a cycle
//   Scenario: hello world renders two boxes and one arrow, named "Hello → World", authored children kept
//   Scenario: an edit to the authored children re-renders the chrome

import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { SemextDraftamoDiagram } from '../../src/lit/semext/semext-draftamo-diagram.js';
import { describe as describeModel, layout, parseDiagram } from '../../src/lit/semext/draftamo-diagram-model.js';
import { setViewerImporterForTests } from '../../src/lit/semext/draftamo-diagram-3d-adapter.js';
import '../../src/lit/semext/index.js';

const HELLO = '<semext-draftamo-node id="a">Hello</semext-draftamo-node><semext-draftamo-edge from="a" to="b"></semext-draftamo-edge><semext-draftamo-node id="b">World</semext-draftamo-node>';

async function mount(inner: string): Promise<SemextDraftamoDiagram> {
  const el = document.createElement('semext-draftamo-diagram') as SemextDraftamoDiagram;
  el.innerHTML = inner;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('semext-draftamo-diagram', () => {
  // `viewer-src` now defaults to the org CDN bundle; stub the importer so unit
  // tests exercise the graceful 2D fallback instead of attempting a real load.
  beforeEach(() => setViewerImporterForTests(() => Promise.reject(new Error('offline-test'))));
  afterEach(() => setViewerImporterForTests(null));

  it('registers the tag', () => {
    expect(customElements.get('semext-draftamo-diagram')).toBe(SemextDraftamoDiagram);
  });

  it('parseDiagram: label attr beats text, text beats id, unknown-edge dropped', () => {
    const host = document.createElement('div');
    host.innerHTML = '<semext-draftamo-node id="a" label="Alpha">ignored</semext-draftamo-node><semext-draftamo-node id="b">Beta</semext-draftamo-node><semext-draftamo-node id="c"></semext-draftamo-node><semext-draftamo-edge from="a" to="b"></semext-draftamo-edge><semext-draftamo-edge from="a" to="zzz"></semext-draftamo-edge>';
    const m = parseDiagram(host);
    expect(m.nodes.map((n) => n.label)).toEqual(['Alpha', 'Beta', 'c']);
    expect(m.edges).toHaveLength(1);
    expect(describeModel(m)).toBe('Alpha → Beta');
  });

  it('layout: ranks left to right and a cycle does not hang', () => {
    const m = { nodes: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }], edges: [{ from: 'a', to: 'b', label: '' }, { from: 'b', to: 'c', label: '' }, { from: 'c', to: 'a', label: '' }] };
    const { pos } = layout(m);
    expect(pos.get('b')!.x).toBeGreaterThan(pos.get('a')!.x);
    expect(pos.get('c')!.x).toBeGreaterThan(pos.get('b')!.x);
  });

  it('hello world: two boxes, one arrow, accessible name, children kept', async () => {
    const el = await mount(HELLO);
    const chrome = el.querySelector('[data-sem-chrome]')!;
    expect(chrome.querySelectorAll('rect')).toHaveLength(2);
    expect(chrome.querySelectorAll('line')).toHaveLength(1);
    expect(chrome.querySelector('svg')!.getAttribute('aria-label')).toBe('Diagram (uml-class): Hello → World');
    expect(el.querySelectorAll(':scope > semext-draftamo-node')).toHaveLength(2);
    expect(el.textContent).toContain('Hello');
  });

  it('re-renders when an authored node is added', async () => {
    const el = await mount(HELLO);
    const n = document.createElement('semext-draftamo-node');
    n.setAttribute('id', 'c');
    n.textContent = 'Again';
    el.insertBefore(n, el.querySelector('[data-sem-chrome]'));
    await new Promise((r) => setTimeout(r, 20));
    await el.updateComplete;
    expect(el.querySelectorAll('[data-sem-chrome] rect')).toHaveLength(3);
  });
});
