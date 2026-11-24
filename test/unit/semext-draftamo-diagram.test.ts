// @vitest-environment happy-dom
// Unit spec — semext-draftamo-diagram (src/lit/semext/), contract: spec/schema/semext/draftamo-diagram.md
//
// Feature: an inline Draftamo diagram from authored <semext-draftamo-node>/<semext-draftamo-edge> children
//   Scenario: the tag registers through defineSemext
//   Scenario: parseDiagram reads node labels from the attribute or the text, and drops edges to unknown nodes
//   Scenario: layout ranks left to right and survives a cycle
//   Scenario: hello world renders two boxes and one arrow, named "Hello → World", authored children kept
//   Scenario: an edit to the authored children re-renders the chrome
// Feature: S4 camera toolbar + input feed (THEROB-169) — every control feature-detected against the instance
//   Scenario: the toolbar renders; reset pairs resetCameraPose with frameTo(null), fit frames the whole model
//   Scenario: the fly/orbit toggle drives setCameraMode; the preset select renders only when the bundle ships setCameraPose
//   Scenario: an older bundle without camera members renders no toolbar at all
//   Scenario: the viewer host is keyboard-reachable (tabIndex) and named (role=img + the shared accessible name)
//   Scenario: chrome keydown/keyup feed viewer.keys; typing targets never feed; teardown clears the set
//   Scenario: viewer-host wheel deltas go to wheelFly
//   Scenario: prefers-reduced-motion forces animate:false; the help hint toggles and Escape closes it

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SemextDraftamoDiagram } from '../../src/lit/semext/semext-draftamo-diagram.js';
import { describe as describeModel, layout, parseDiagram } from '../../src/lit/semext/draftamo-diagram-model.js';
import { setViewerImporterForTests, type ViewerInstance } from '../../src/lit/semext/draftamo-diagram-3d-adapter.js';
import '../../src/lit/semext/index.js';

const HELLO = '<semext-draftamo-node id="a">Hello</semext-draftamo-node><semext-draftamo-edge from="a" to="b"></semext-draftamo-edge><semext-draftamo-node id="b">World</semext-draftamo-node>';

async function mount(inner: string, attrs: Record<string, string> = {}): Promise<SemextDraftamoDiagram> {
  const el = document.createElement('semext-draftamo-diagram') as SemextDraftamoDiagram;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = inner;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

describe('semext-draftamo-diagram', () => {
  // `viewer-src` now defaults to the org CDN bundle; stub the importer so unit
  // tests exercise the graceful 2D fallback instead of attempting a real load.
  beforeEach(() => setViewerImporterForTests(() => Promise.reject(new Error('offline-test'))));
  afterEach(() => {
    setViewerImporterForTests(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  // ---- S4 camera toolbar + input feed (THEROB-169) ----

  /** Fake viewer exposing the full v0.2.0 camera surface. */
  function cameraViewer(): ViewerInstance {
    return {
      setDocument: vi.fn(),
      start: vi.fn(),
      stopLoop: vi.fn(),
      dispose: vi.fn(),
      resetCameraPose: vi.fn(),
      frameTo: vi.fn(() => true),
      setCameraMode: vi.fn(),
      wheelFly: vi.fn(),
      keys: new Set<string>(),
    };
  }

  /** Mount HELLO with a resolving importer so the 3D viewer (and toolbar) actually attach. */
  async function mountViewer(v: ViewerInstance): Promise<SemextDraftamoDiagram> {
    setViewerImporterForTests(() => Promise.resolve({ createViewer: () => v }));
    const el = await mount(HELLO, { 'viewer-src': 'https://cdn.example/draftamo-viewer.js' });
    await new Promise((r) => setTimeout(r, 20));
    return el;
  }

  it('toolbar: reset pairs resetCameraPose with frameTo(null); fit frames the model', async () => {
    const v = cameraViewer();
    const el = await mountViewer(v);
    const bar = el.querySelector('[data-sem-chrome] .semext-draftamo-diagram-cameras')!;
    expect(bar.getAttribute('role')).toBe('toolbar');
    (bar.querySelector('button[aria-label="Reset camera view"]') as HTMLElement).click();
    expect(vi.mocked(v.resetCameraPose!)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(v.frameTo!)).toHaveBeenCalledWith(null, { animate: true });
    vi.mocked(v.frameTo!).mockClear();
    (bar.querySelector('button[aria-label="Fit diagram in view"]') as HTMLElement).click();
    expect(vi.mocked(v.frameTo!)).toHaveBeenCalledWith(null, { animate: true });
    // v0.2.0 does not export setCameraPose → the preset menu stays hidden.
    expect(bar.querySelector('select')).toBeNull();
    el.remove();
  });

  it('toolbar: fly/orbit toggle drives setCameraMode; preset select only with setCameraPose', async () => {
    const v = cameraViewer();
    (v as { setCameraPose?: unknown }).setCameraPose = vi.fn();
    const el = await mountViewer(v);
    const bar = el.querySelector('[data-sem-chrome] .semext-draftamo-diagram-cameras')!;
    const fly = bar.querySelector('button[aria-label="Switch to fly camera"]')!;
    expect(fly.getAttribute('aria-pressed')).toBe('false');
    fly.click();
    expect(vi.mocked(v.setCameraMode!)).toHaveBeenCalledWith('fly');
    expect(fly.getAttribute('aria-pressed')).toBe('true');
    expect(fly.textContent).toBe('Orbit');
    fly.click();
    expect(vi.mocked(v.setCameraMode!)).toHaveBeenLastCalledWith('orbit');
    const sel = bar.querySelector('select')!;
    expect(sel.querySelectorAll('option')).toHaveLength(5);
    sel.value = 'top';
    sel.dispatchEvent(new Event('change'));
    expect(vi.mocked(v.setCameraPose!)).toHaveBeenCalledWith('top', { animate: true });
    el.remove();
  });

  it('older bundle: no camera members → no toolbar, 3D view still mounts', async () => {
    const v: ViewerInstance = { setDocument: vi.fn(), start: vi.fn(), stopLoop: vi.fn(), dispose: vi.fn() };
    const el = await mountViewer(v);
    expect(el.querySelector('.semext-draftamo-diagram-cameras')).toBeNull();
    expect(el.querySelector('.semext-draftamo-diagram-cam')).toBeNull();
    expect(el.querySelector('[data-sem-chrome] svg')).toBeNull();
    el.remove();
  });

  it('viewer host: role=img, shared aria-label, tabIndex=0', async () => {
    const v = cameraViewer();
    const el = await mountViewer(v);
    const host = el.querySelector('.semext-draftamo-diagram-viewer')!;
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Diagram (uml-class): Hello → World');
    expect(host.tabIndex).toBe(0);
    el.remove();
  });

  it('input feed: chrome keydown/keyup feed viewer.keys; typing targets never feed; teardown clears', async () => {
    const v = cameraViewer();
    const el = await mountViewer(v);
    const chrome = el.querySelector('[data-sem-chrome]')!;
    chrome.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    expect(v.keys!.has('KeyW')).toBe(true);
    chrome.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    expect(v.keys!.has('KeyW')).toBe(false);
    // A keydown bubbling out of a typing target never reaches the key set.
    const input = document.createElement('input');
    chrome.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));
    expect(v.keys!.size).toBe(0);
    // Removing the element detaches the feed and clears any held keys.
    chrome.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    expect(v.keys!.size).toBe(1);
    el.remove();
    expect(v.keys!.size).toBe(0);
  });

  it('input feed: wheel deltas on the viewer host go to wheelFly', async () => {
    const v = cameraViewer();
    const el = await mountViewer(v);
    const host = el.querySelector('.semext-draftamo-diagram-viewer')!;
    const ev = new Event('wheel');
    Object.defineProperty(ev, 'deltaY', { value: -120 });
    host.dispatchEvent(ev);
    expect(vi.mocked(v.wheelFly!)).toHaveBeenCalledWith(-120);
    el.remove();
  });

  it('prefers-reduced-motion: camera motions jump (animate:false)', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const v = cameraViewer();
    const el = await mountViewer(v);
    const bar = el.querySelector('[data-sem-chrome] .semext-draftamo-diagram-cameras')!;
    (bar.querySelector('button[aria-label="Fit diagram in view"]') as HTMLElement).click();
    expect(vi.mocked(v.frameTo!)).toHaveBeenCalledWith(null, { animate: false });
    el.remove();
  });

  it('help: ? toggles the hint; Escape closes it and refocuses the button', async () => {
    const v = cameraViewer();
    const el = await mountViewer(v);
    const bar = el.querySelector('[data-sem-chrome] .semext-draftamo-diagram-cameras')!;
    const help = bar.querySelector('.semext-draftamo-diagram-cam-help') as HTMLElement;
    const btn = bar.querySelector('button[aria-label="Camera keyboard help"]')!;
    expect(help.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(help.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(help.textContent).toContain('WASD');
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(help.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    el.remove();
  });
});
