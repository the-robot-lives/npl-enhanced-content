// Unit spec — menu/view: the §8.5 view preference (decision + session store)
//
// Feature: view resolution (§8.5a/b/c precedence)
//   Scenario: a refused canvas pins dom above everything
//   Scenario: renderer="dom" pins dom
//   Scenario: renderer="canvas" is the default spelling, not a pin
//   Scenario: the stored session switch applies when no pin
//   Scenario: no attribute, no storage → canvas (the one default, §8.2)
// Feature: session storage (§8.5c)
//   Scenario: key is semtext-view:<element-id>
//   Scenario: unreadable stored values are simply absent
//   Scenario: a throwing store fails silent on both read and write
// Feature: select-all range
//   Scenario: empty buffer → null; otherwise end col beyond any width

import { describe, it, expect } from 'vitest';
import {
  isRendererChoice,
  isViewStorageKey,
  readStoredView,
  resolveViewChoice,
  selectAllRange,
  viewStorageKey,
  writeStoredView,
} from '../../src/terminal/menu/view.js';

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

describe('view resolution', () => {
  const base = { attr: null, stored: null, canvasAvailable: true };

  it('a refused canvas pins dom above everything (§8.5a)', () => {
    expect(resolveViewChoice({ ...base, attr: 'canvas', canvasAvailable: false })).toBe('dom');
    expect(resolveViewChoice({ ...base, attr: 'dom', canvasAvailable: false })).toBe('dom');
    expect(resolveViewChoice({ ...base, stored: 'canvas', canvasAvailable: false })).toBe('dom');
  });

  it('renderer="dom" pins dom (§8.5b)', () => {
    expect(resolveViewChoice({ ...base, attr: 'dom', stored: 'canvas' })).toBe('dom');
  });

  it('renderer="canvas" is the default spelling — the stored switch wins over it', () => {
    expect(resolveViewChoice({ ...base, attr: 'canvas', stored: 'dom' })).toBe('dom');
  });

  it('an unknown attribute value behaves like an absent one', () => {
    expect(resolveViewChoice({ ...base, attr: 'yaml' })).toBe('canvas');
    expect(resolveViewChoice({ ...base, attr: 'yaml', stored: 'dom' })).toBe('dom');
  });

  it('no attribute, no storage → canvas (§8.2 the one default)', () => {
    expect(resolveViewChoice(base)).toBe('canvas');
    expect(resolveViewChoice({ ...base, attr: '' })).toBe('canvas');
  });
});

describe('session storage', () => {
  it('the key is semtext-view:<element-id>', () => {
    expect(viewStorageKey('demo-shell')).toBe('semtext-view:demo-shell');
    expect(isViewStorageKey('semtext-view:demo-shell')).toBe(true);
    expect(isViewStorageKey('semtext:shell:v1:x')).toBe(false);
  });

  it('round-trips through a real store', () => {
    const storage = new FakeStorage();
    expect(readStoredView(storage, 'a')).toBeNull();
    writeStoredView(storage, 'a', 'dom');
    expect(readStoredView(storage, 'a')).toBe('dom');
    writeStoredView(storage, 'a', 'canvas');
    expect(readStoredView(storage, 'a')).toBe('canvas');
  });

  it('unreadable stored values are simply absent', () => {
    const storage = new FakeStorage();
    storage.map.set(viewStorageKey('a'), 'yaml');
    expect(readStoredView(storage, 'a')).toBeNull();
    expect(readStoredView(null, 'a')).toBeNull();
  });

  it('a throwing store fails silent on both read and write', () => {
    const storage = new ThrowingStorage();
    expect(readStoredView(storage, 'a')).toBeNull();
    expect(() => writeStoredView(storage, 'a', 'dom')).not.toThrow();
  });
});

describe('select-all range', () => {
  it('an empty buffer has nothing to select', () => {
    expect(selectAllRange(0)).toBeNull();
  });

  it('spans ring + primary with an end column beyond any width', () => {
    const range = selectAllRange(5);
    expect(range).toEqual({
      start: { line: 0, col: 0 },
      end: { line: 4, col: Number.MAX_SAFE_INTEGER },
    });
  });
});

describe('choice guard', () => {
  it('accepts only the two paints', () => {
    expect(isRendererChoice('dom')).toBe(true);
    expect(isRendererChoice('canvas')).toBe(true);
    expect(isRendererChoice('yaml')).toBe(false);
    expect(isRendererChoice(null)).toBe(false);
  });
});
