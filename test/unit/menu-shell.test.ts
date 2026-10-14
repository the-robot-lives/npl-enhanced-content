// @vitest-environment happy-dom
// Unit spec — shell/sem-shell: the §8.5 view preference on the demo shell
//
// Feature: boot decision (§8.5a/b)
//   Scenario: the shell boots on the DOM view until the canvas proves itself
//   Scenario: a clean canvas flips the default to canvas
//   Scenario: renderer="dom" pins the text view above a clean canvas
//   Scenario: renderer="canvas" is the default spelling — a stored switch wins
// Feature: live attribute (§8.5b — observed, property and attribute)
//   Scenario: an attribute change re-resolves
//   Scenario: the property form is observed too
// Feature: session switch (§8.5c)
//   Scenario: switchTo persists under the element id for the browsing session
//   Scenario: a forced fallback is never persisted
//   Scenario: switchTo("canvas") is refused while the canvas is unavailable
//   Scenario: an element without an id stores under "default"
//   Scenario: a throwing store fails silent — the view still applies
// Feature: the integrator seam
//   Scenario: every applied choice reaches viewDelegate

import { describe, it, expect, vi } from 'vitest';
import '../../src/shell/sem-shell.js';
import { SemShell } from '../../src/shell/sem-shell.js';
import type { RendererChoice } from '../../src/terminal/menu/view.js';

class FakeStorage implements Storage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

class ThrowingStorage implements Storage {
  get length(): number {
    return 0;
  }
  clear(): void {}
  getItem(): string | null {
    throw new Error('storage disabled');
  }
  key(): string | null {
    return null;
  }
  removeItem(): void {}
  setItem(): void {
    throw new Error('storage disabled');
  }
}

async function attach(
  opts: { id?: string; renderer?: string; storage?: Storage | null } = {},
): Promise<SemShell> {
  const el = document.createElement('sem-shell') as SemShell;
  if (opts.id !== undefined) el.id = opts.id;
  if (opts.renderer !== undefined) el.setAttribute('renderer', opts.renderer);
  if (opts.storage !== undefined) el.viewStorage = opts.storage;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('boot decision', () => {
  it('boots on the DOM view until the canvas proves itself (§8.5a)', async () => {
    // r2-integrate: the canvas renderer attaches post-first-render (§8) and
    // proves the canvas within the same boot, so a settled boot lands on the
    // canvas default — and the proof is never persisted (§8.2).
    const storage = new FakeStorage();
    const el = await attach({ id: 'boot-a', storage });
    expect(el.viewChoice).toBe('canvas');
    expect(el.canvasAvailable).toBe(true);
    expect(storage.map.size).toBe(0);
    el.remove();
  });

  it('a clean canvas flips the default to canvas (§8.2) — without persisting', async () => {
    const storage = new FakeStorage();
    const el = await attach({ id: 'boot-b', storage });
    el.markCanvasAvailable();
    expect(el.viewChoice).toBe('canvas');
    expect(storage.map.size).toBe(0); // the default is not the user's switch
    el.remove();
  });

  it('renderer="dom" pins the text view above a clean canvas (§8.5b)', async () => {
    const el = await attach({ id: 'boot-c', renderer: 'dom', storage: new FakeStorage() });
    el.markCanvasAvailable();
    expect(el.viewChoice).toBe('dom');
    el.remove();
  });

  it('renderer="canvas" is the default spelling — a stored switch still wins', async () => {
    const storage = new FakeStorage();
    storage.map.set('semtext-view:boot-d', 'dom');
    const el = await attach({ id: 'boot-d', renderer: 'canvas', storage });
    el.markCanvasAvailable();
    expect(el.viewChoice).toBe('dom');
    el.remove();
  });
});

describe('live attribute', () => {
  it('an attribute change re-resolves (§8.5b)', async () => {
    const el = await attach({ id: 'live-a', storage: new FakeStorage() });
    el.markCanvasAvailable();
    expect(el.viewChoice).toBe('canvas');

    el.setAttribute('renderer', 'dom');
    await el.updateComplete;
    expect(el.viewChoice).toBe('dom');

    el.removeAttribute('renderer');
    await el.updateComplete;
    expect(el.viewChoice).toBe('canvas'); // back to the plain default
    el.remove();
  });

  it('the property form is observed too', async () => {
    const el = await attach({ id: 'live-b', storage: new FakeStorage() });
    el.markCanvasAvailable();
    el.renderer = 'dom';
    await el.updateComplete;
    expect(el.getAttribute('renderer')).toBe('dom'); // reflected
    expect(el.viewChoice).toBe('dom');
    el.remove();
  });
});

describe('session switch', () => {
  it('switchTo persists under the element id for the browsing session (§8.5c)', async () => {
    const storage = new FakeStorage();
    const el = await attach({ id: 'switch-a', storage });
    el.markCanvasAvailable();
    el.semView.switchTo('dom');
    expect(el.viewChoice).toBe('dom');
    expect(storage.getItem('semtext-view:switch-a')).toBe('dom');

    // a later element, same session, same id → boots on the stored choice
    const again = await attach({ id: 'switch-a', storage });
    expect(again.viewChoice).toBe('dom');
    again.remove();
    el.remove();
  });

  it('a forced fallback is never persisted (§8.5a)', async () => {
    const storage = new FakeStorage();
    const el = await attach({ id: 'switch-b', storage });
    el.markCanvasAvailable();
    el.markCanvasUnavailable();
    expect(el.viewChoice).toBe('dom');
    expect(storage.map.size).toBe(0);
    el.remove();
  });

  it('switchTo("canvas") is refused while the canvas is unavailable (§8.5a)', async () => {
    const storage = new FakeStorage();
    const applied: RendererChoice[] = [];
    const el = document.createElement('sem-shell') as SemShell;
    el.id = 'switch-c';
    el.viewStorage = storage;
    el.viewDelegate = (choice) => applied.push(choice);
    document.body.appendChild(el);
    await el.updateComplete; // boot: dom, then the post-render canvas proof

    el.markCanvasUnavailable(); // simulate forced-colors / failed 2d (§8.5a)
    applied.length = 0;
    el.semView.switchTo('canvas');
    expect(el.viewChoice).toBe('dom');
    expect(storage.map.size).toBe(0);
    expect(applied).toEqual([]); // the refused switch applies nothing
    el.remove();
  });

  it('an element without an id stores under "default"', async () => {
    const storage = new FakeStorage();
    const el = await attach({ storage });
    el.markCanvasAvailable();
    el.semView.switchTo('dom');
    expect(storage.getItem('semtext-view:default')).toBe('dom');
    el.remove();
  });

  it('a throwing store fails silent — the view still applies', async () => {
    const el = await attach({ id: 'switch-d', storage: new ThrowingStorage() });
    el.markCanvasAvailable();
    expect(() => el.semView.switchTo('dom')).not.toThrow();
    expect(el.viewChoice).toBe('dom');
    el.remove();
  });
});

describe('the integrator seam', () => {
  it('every applied choice reaches viewDelegate', async () => {
    const applied: RendererChoice[] = [];
    const el = document.createElement('sem-shell') as SemShell;
    el.id = 'delegate-a';
    el.viewStorage = new FakeStorage();
    el.viewDelegate = (choice) => applied.push(choice);
    document.body.appendChild(el);
    await el.updateComplete;

    // Boot applies the DOM view (connectedCallback + the first-update
    // `renderer` resolve); the post-render canvas proof flips it (§8).
    expect(applied[0]).toBe('dom');
    expect(applied).toContain('canvas');
    el.semView.switchTo('dom');
    expect(applied[applied.length - 1]).toBe('dom');
    el.remove();
  });
});
