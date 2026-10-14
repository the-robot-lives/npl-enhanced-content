// @vitest-environment happy-dom
// script-in-view — the visibility watches the autostart contract rides on.
import { describe, it, expect } from 'vitest';
import { watchInView, watchVisible, type VisibilitySource } from '../../src/terminal/script/in-view.js';

interface FakeEntry {
  target: Element;
  intersectionRatio: number;
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly cb: (entries: FakeEntry[]) => void) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
  show(target: Element, ratio: number): void {
    this.cb([{ target, intersectionRatio: ratio }]);
  }
}

function makeElement(): Element {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('watchInView', () => {
  it('starts at the threshold, pauses below the hold, resumes on re-entry', () => {
    FakeIntersectionObserver.instances = [];
    const el = makeElement();
    const events: string[] = [];
    watchInView(el, {
      IntersectionObserver: FakeIntersectionObserver as unknown as typeof IntersectionObserver,
      onShown: () => void events.push('shown'),
      onHidden: () => void events.push('hidden'),
    });
    const io = FakeIntersectionObserver.instances[0]!;
    io.show(el, 0.2); // below start: nothing yet
    expect(events).toEqual([]);
    io.show(el, 0.6); // crossing the start threshold
    expect(events).toEqual(['shown']);
    io.show(el, 0.3); // between hold and start: stays shown
    expect(events).toEqual(['shown']);
    io.show(el, 0.01); // below the hold: pause
    expect(events).toEqual(['shown', 'hidden']);
    io.show(el, 0.2); // back between hold and start: still paused
    expect(events).toEqual(['shown', 'hidden']);
    io.show(el, 0.9); // re-entry
    expect(events).toEqual(['shown', 'hidden', 'shown']);
  });

  it('without IntersectionObserver the demo starts once, immediately', async () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const events: string[] = [];
    watchInView(makeElement(), { IntersectionObserver: undefined, onShown: () => void events.push('shown') });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events).toEqual(['shown']);
  });
});

describe('watchVisible', () => {
  it('mirrors visibilitychange, and dispose stops listening', () => {
    const events: string[] = [];
    const listeners = new Map<string, () => void>();
    const source: VisibilitySource = {
      get hidden() {
        return sourceValue;
      },
      set hidden(value: boolean) {
        sourceValue = value;
      },
      addEventListener: (type, fn) => void listeners.set(type, fn),
      removeEventListener: (type) => void listeners.delete(type),
    };
    let sourceValue = false;
    const watch = watchVisible(source, {
      onShown: () => void events.push('shown'),
      onHidden: () => void events.push('hidden'),
    });
    source.hidden = true;
    listeners.get('visibilitychange')!();
    expect(events).toEqual(['hidden']);
    source.hidden = false;
    listeners.get('visibilitychange')!();
    expect(events).toEqual(['hidden', 'shown']);
    watch.dispose();
    source.hidden = true;
    listeners.get('visibilitychange')?.();
    expect(events).toEqual(['hidden', 'shown']);
  });
});
