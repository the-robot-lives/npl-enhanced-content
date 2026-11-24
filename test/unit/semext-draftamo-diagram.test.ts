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
// Feature: THEROB-170 native JSON export/rehydration — carrier, serialize, sanitize, extraction
//   Scenario: graphToJson/graphFromJson round-trip (v1 shape, deterministic)
//   Scenario: parseDiagram hydrates from the data payload when authored children are absent
//   Scenario: authored children win over a stale payload; the element re-syncs the payload
//   Scenario: invalid payload → empty model + warn once (re-render never re-warns)
//   Scenario: authored diagram syncs the data child as LAST child with the v1 JSON
//   Scenario: serialize strips chrome, keeps authored children + the payload
//   Scenario: extraction mints ONE diagram record (graph + counts + text); children mint nothing; JS on/off identical
//   Scenario: sanitize keeps the data payload child

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SemextDraftamoDiagram } from '../../src/lit/semext/semext-draftamo-diagram.js';
import { describe as describeModel, layout, parseDiagram, graphToJson, graphFromJson } from '../../src/lit/semext/draftamo-diagram-model.js';
import { setViewerImporterForTests, type ViewerInstance } from '../../src/lit/semext/draftamo-diagram-3d-adapter.js';
import '../../src/lit/semext/index.js';
import { serialize } from '../../src/agent/index.js';
import { sanitizeHtml } from '../../src/editor/safety/sanitize.js';
import { extractRecords } from '../../src/extract/records.js';
import type { EditorNode } from '../../src/editor/model/types.js';

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

  // ---- THEROB-170 native JSON export/rehydration ----

  it('graphToJson/graphFromJson round-trip (v1 shape, deterministic)', () => {
    const host = document.createElement('div');
    host.innerHTML = HELLO;
    const j = graphToJson(parseDiagram(host), { kind: 'uml-class', label: 'Diagram' });
    expect(j.v).toBe(1);
    expect(j.kind).toBe('uml-class');
    expect(j.label).toBe('Diagram');
    expect(j.nodes).toEqual([{ id: 'a', label: 'Hello' }, { id: 'b', label: 'World' }]);
    expect(j.edges).toEqual([{ from: 'a', to: 'b', label: '' }]);
    const back = graphFromJson(JSON.stringify(j))!;
    expect(back.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(back.edges).toEqual([{ from: 'a', to: 'b', label: '' }]);
    // Anything that is not a valid v1 payload → null (never a throw).
    expect(graphFromJson('not json')).toBeNull();
    expect(graphFromJson('{"v":2,"kind":"k","nodes":[],"edges":[]}')).toBeNull();
    expect(graphFromJson('{"v":1,"kind":"k","nodes":[{}],"edges":[]}')).toBeNull();
    expect(graphFromJson('{"v":1,"kind":"k","nodes":[],"edges":[{"from":"x"}]}')).toBeNull();
  });

  it('parseDiagram hydrates from the data payload when authored children are absent', () => {
    const authored = document.createElement('div');
    authored.innerHTML = HELLO;
    const payload = graphToJson(parseDiagram(authored), { kind: 'uml-class', label: 'Diagram' });
    const host = document.createElement('div');
    host.innerHTML = '<semext-draftamo-data>' + JSON.stringify(payload) + '</semext-draftamo-data>';
    const m = parseDiagram(host);
    expect(m.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(m.edges).toHaveLength(1);
    expect(describeModel(m)).toBe('Hello → World');
  });

  it('authored children win over a stale payload; the element re-syncs it', async () => {
    const el = await mount(HELLO + '<semext-draftamo-data>{"v":1,"kind":"stale","nodes":[],"edges":[]}</semext-draftamo-data>');
    const data = el.querySelector(':scope > semext-draftamo-data')!;
    const parsed = JSON.parse(data.textContent!);
    // The authored model replaced the stale payload (and hydrated nothing from it).
    expect(parsed.kind).toBe('uml-class');
    expect(parsed.nodes).toEqual([{ id: 'a', label: 'Hello' }, { id: 'b', label: 'World' }]);
    expect(parsed.edges).toEqual([{ from: 'a', to: 'b', label: '' }]);
    expect(el.querySelectorAll(':scope > semext-draftamo-node')).toHaveLength(2);
    expect(el.querySelectorAll('[data-sem-chrome] rect')).toHaveLength(2);
    el.remove();
  });

  it('invalid payload → empty model + warn once (re-render never re-warns)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = await mount('<semext-draftamo-data>not json</semext-draftamo-data>');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-sem-chrome]')).toBeNull();
    // An attribute change re-renders; the invalid payload warns exactly once.
    el.setAttribute('label', 'Again');
    await el.updateComplete;
    expect(warn).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('authored diagram syncs the data child as LAST child with the v1 JSON', async () => {
    const el = await mount(HELLO);
    const data = el.querySelector(':scope > semext-draftamo-data')!;
    expect(data.getAttribute('data-sem-chrome')).toBeNull();
    expect(el.lastElementChild).toBe(data);
    expect(JSON.parse(data.textContent!)).toEqual({
      v: 1,
      kind: 'uml-class',
      label: 'Diagram',
      nodes: [{ id: 'a', label: 'Hello' }, { id: 'b', label: 'World' }],
      edges: [{ from: 'a', to: 'b', label: '' }],
    });
    el.remove();
  });

  it('serialize strips chrome and keeps authored children + the payload', async () => {
    const el = await mount(HELLO);
    const out = serialize(el);
    expect(out).not.toContain('data-sem-chrome');
    expect(out).toContain('<semext-draftamo-node');
    expect(out).toContain('<semext-draftamo-data>');
    // Re-parse the export: parseDiagram reads DIRECT children, so parse the
    // diagram element itself, not the wrapper host.
    const host = document.createElement('div');
    host.innerHTML = out;
    expect(describeModel(parseDiagram(host.firstElementChild as Element))).toBe('Hello → World');
    el.remove();
  });

  it('extraction: ONE diagram record, children mint nothing, JS on/off identical', async () => {
    const el = await mount(HELLO);
    // Move the live element into a wrapper: the runtime chrome mints nothing,
    // the diagram host mints exactly one record.
    const wrap = document.createElement('div');
    wrap.append(el);
    const live = extractRecords(wrap);
    expect(live).toHaveLength(1);
    expect(live[0].type).toBe('semext-draftamo-diagram');
    expect(live[0].text).toBe('Hello → World');
    expect(live[0].fields.nodes).toBe(2);
    expect(live[0].fields.edges).toBe(1);
    expect(live[0].fields.graph).toEqual({
      v: 1,
      kind: 'uml-class',
      nodes: [{ id: 'a', label: 'Hello' }, { id: 'b', label: 'World' }],
      edges: [{ from: 'a', to: 'b', label: '' }],
    });
    // No `label` attribute → the native JSON omits the optional label key.
    expect('label' in (live[0].fields.graph as Record<string, unknown>)).toBe(false);
    // JS-off leg: the same markup without the runtime yields the identical record.
    const raw = document.createElement('div');
    raw.innerHTML = '<semext-draftamo-diagram>' + HELLO + '</semext-draftamo-diagram>';
    const off = extractRecords(raw);
    expect(off).toHaveLength(1);
    expect(off[0]).toEqual(live[0]);
    el.remove();
  });

  it('sanitize keeps the data payload child', () => {
    const payload = {
      v: 1,
      kind: 'uml-class',
      label: 'Diagram',
      nodes: [{ id: 'a', label: 'Hello' }, { id: 'b', label: 'World' }],
      edges: [{ from: 'a', to: 'b', label: '' }],
    };
    const host = document.createElement('div');
    host.innerHTML = '<semext-draftamo-diagram>' + HELLO + '<semext-draftamo-data>' + JSON.stringify(payload) + '</semext-draftamo-data></semext-draftamo-diagram>';
    const out = serialize(host.firstElementChild as Element);
    expect(out).toContain('<semext-draftamo-data>');
    const knownTags = new Set<string>(['semext-draftamo-diagram', 'semext-draftamo-node', 'semext-draftamo-edge', 'semext-draftamo-data']);
    const res = sanitizeHtml(out, { knownTags });
    const tags: string[] = [];
    const walk = (nodes: EditorNode[]): void => {
      for (const n of nodes) {
        if (n.kind === 'element') {
          tags.push(n.name.toLowerCase());
          walk(n.children);
        }
      }
    };
    walk(res.nodes);
    expect(tags).toContain('semext-draftamo-diagram');
    expect(tags).toContain('semext-draftamo-node');
    expect(tags).toContain('semext-draftamo-data');
    expect(res.droppedTags).toBe(0);
  });
});
