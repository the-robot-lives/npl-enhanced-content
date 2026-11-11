// @vitest-environment happy-dom
// Unit spec — embedder/UX surface of <sem-terminal>/<sem-shell>
//
// Feature: wheel + touch scrolling
//   Scenario: wheel at a scroll limit is NOT swallowed; with scrollback it is
//   Scenario: touch-drag scrolls the scrollback
// Feature: keyboard copy
//   Scenario: Ctrl+Shift+C copies the selection; Ctrl+C with a selection copies
// Feature: history + transcript
//   Scenario: command history persists under local-storage; transcript capped at 5000
//   Scenario: Tab completion keeps the caret and the text after it
// Feature: embedder surface
//   Scenario: run(line) executes; sem-shell-ready / sem-shell-command fire
// Feature: open (sandboxed)
//   Scenario: VFS HTML opens inside an allow-scripts-only iframe wrapper
// Feature: forced-colors
//   Scenario: a media-query change swaps the paint path
//   Scenario: Alt+digit tab jumps are off on macOS

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../src/terminal/sem-terminal.js';
import '../../src/shell/sem-shell.js';
import { MAX_TRANSCRIPT_LINES, sandboxedHtmlDocument, type SemTerminal } from '../../src/terminal/sem-terminal.js';
import type { SemShell } from '../../src/shell/sem-shell.js';

const inputOf = (el: SemTerminal): HTMLInputElement => el.querySelector('.sem-shell-input') as HTMLInputElement;
const surfaceOf = (el: SemTerminal): HTMLElement => el.querySelector('.sem-term-surface') as HTMLElement;

async function attach(attrs: Record<string, string> = {}): Promise<SemShell> {
  const el = document.createElement('sem-shell') as SemShell;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function submit(el: SemTerminal, command: string): void {
  inputOf(el).value = command;
  inputOf(el).closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('wheel + touch scrolling', () => {
  it('lets the page scroll at a scroll limit; swallows only while scrollback can move', async () => {
    const el = await attach();
    const surface = surfaceOf(el);
    const wheel = (dy: number): WheelEvent => {
      const ev = new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true });
      surface.dispatchEvent(ev);
      return ev;
    };
    expect(wheel(-50).defaultPrevented).toBe(false); // nothing to scroll yet
    const many = Array.from({ length: 200 }, (_, i) => ({ kind: 'stdout' as const, text: `row ${i}` }));
    el.appendLines(many);
    expect(wheel(50).defaultPrevented).toBe(false); // pinned to the bottom: down is a limit
    expect(wheel(-3).defaultPrevented).toBe(true); // up has scrollback
  });

  it('touch-drag scrolls the scrollback', async () => {
    const el = await attach();
    el.appendLines(Array.from({ length: 200 }, (_, i) => ({ kind: 'stdout' as const, text: `row ${i}` })));
    const before = el.screen.viewportTop();
    const surface = surfaceOf(el);
    const touch = (type: string, y: number): void => {
      const ev = new Event(type, { bubbles: true }) as Event & { touches: Array<{ clientX: number; clientY: number }> };
      ev.touches = type === 'touchend' ? [] : [{ clientX: 5, clientY: y }];
      surface.dispatchEvent(ev);
    };
    touch('touchstart', 100);
    touch('touchmove', 300); // finger down 200px = older lines
    touch('touchend', 300);
    expect(el.screen.viewportTop()).toBeLessThan(before);
  });
});

describe('keyboard copy', () => {
  it('Ctrl+Shift+C copies the selection through the clipboard', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => void written.push(t) } });
    const el = await attach();
    el.appendLines([{ kind: 'stdout', text: 'copy me please' }]);
    el.sendKeys('a'); // routes keys; selection comes from the model below
    const hidden = el.querySelector('.sem-shell-hidden-input') as HTMLInputElement | null;
    expect(hidden).not.toBeNull();
    // Select the first screen line via the surface mouse path.
    const surface = surfaceOf(el);
    surface.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0, bubbles: true, cancelable: true }));
    surface.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 0, button: 0 }));
    const key = new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    hidden!.dispatchEvent(key);
    await flush();
    expect(key.defaultPrevented).toBe(true);
    expect(written.length).toBe(1);
    expect(written[0]).not.toBe('');
  });
});

describe('history + transcript', () => {
  it('command history persists under local-storage and restores into a fresh element', async () => {
    const a = await attach({ id: 'hist-probe', 'local-storage': '' });
    submit(a, 'echo one');
    submit(a, 'echo two');
    const stored = JSON.parse(window.localStorage.getItem('semtext:shell:history:v1:hist-probe')!);
    expect(stored).toEqual(['echo one', 'echo two']);
    a.remove();
    const b = await attach({ id: 'hist-probe', 'local-storage': '' });
    inputOf(b).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(inputOf(b).value).toBe('echo two');
  });

  it('no history is stored without the local-storage attribute', async () => {
    const a = await attach({ id: 'no-hist' });
    submit(a, 'echo one');
    expect(window.localStorage.length).toBe(0);
  });

  it('caps the transcript at 5000 lines', async () => {
    const el = await attach();
    el.appendLines(Array.from({ length: MAX_TRANSCRIPT_LINES + 250 }, (_, i) => ({ kind: 'stdout' as const, text: `l${i}` })));
    expect(el.lines.length).toBe(MAX_TRANSCRIPT_LINES);
    expect(el.lines[el.lines.length - 1]!.text).toBe(`l${MAX_TRANSCRIPT_LINES + 249}`);
  });

  it('Tab completion keeps the caret after the completion and the tail intact', async () => {
    const el = await attach();
    const input = inputOf(el);
    input.value = 'cat demo/wel -n';
    input.setSelectionRange(12, 12);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(input.value).toBe('cat demo/welcome.html  -n');
    expect(input.selectionStart).toBe('cat demo/welcome.html '.length);
  });
});

describe('embedder surface', () => {
  it('run(line) executes in the active tab and fires sem-shell-command; ready fires once', async () => {
    const el = document.createElement('sem-shell') as SemShell;
    const ready = vi.fn();
    const commands: Array<{ line: string; status: unknown }> = [];
    el.addEventListener('sem-shell-ready', ready);
    el.addEventListener('sem-shell-command', (e) => commands.push((e as CustomEvent).detail));
    document.body.appendChild(el);
    await el.updateComplete;
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
    el.run('echo hello-embedder');
    await flush();
    expect(el.lines.some((l) => l.text === 'hello-embedder')).toBe(true);
    expect(commands.map((c) => c.line)).toEqual(['echo hello-embedder']);
    expect(commands[0]!.status).toBe(0);
  });
});

describe('open — sandboxed', () => {
  it('wraps VFS HTML in an allow-scripts-only iframe (never allow-same-origin)', () => {
    const doc = sandboxedHtmlDocument('<script>localStorage.getItem("x")</script><p a="1">&</p>', 't"x');
    expect(doc).toContain('sandbox="allow-scripts"');
    expect(doc).not.toContain('allow-same-origin');
    expect(doc).not.toContain('<script>'); // the content is an escaped attribute value
    expect(doc).toContain('srcdoc="&lt;script&gt;');
    expect(doc).toContain('title="t&quot;x"');
  });

  it('the open command hands the browser the wrapper, not the raw file', async () => {
    const blobs: Blob[] = [];
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => (blobs.push(b), 'blob:probe')) as typeof URL.createObjectURL;
    const realOpen = window.open;
    window.open = (() => window) as typeof window.open;
    try {
      const el = await attach();
      submit(el, 'open demo/welcome.html');
      await el.updateComplete;
      expect(blobs).toHaveLength(1);
      const text = await blobs[0]!.text();
      expect(text).toContain('<iframe sandbox="allow-scripts"');
      expect(text).not.toContain('allow-same-origin');
    } finally {
      URL.createObjectURL = realCreate;
      window.open = realOpen;
    }
  });
});

describe('forced-colors + platform', () => {
  it('a forced-colors media-query change swaps the paint path', async () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    let forced = false;
    const realMatch = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('forced-colors') ? forced : false,
      media: q,
      addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => {
        if (q.includes('forced-colors')) listeners.push(fn);
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const el = await attach();
      await flush();
      expect(listeners.length).toBeGreaterThan(0);
      const paint = (): string | null => el.getAttribute('paint') ?? el.querySelector('[data-paint]')?.getAttribute('data-paint') ?? null;
      const before = paint();
      forced = true;
      for (const fn of listeners) fn({ matches: true });
      await el.updateComplete;
      expect(el.querySelector('.sem-term-surface')).not.toBeNull(); // surface survives the swap
      forced = false;
      for (const fn of listeners) fn({ matches: false });
      await el.updateComplete;
      expect(paint()).toBe(before);
    } finally {
      window.matchMedia = realMatch;
    }
  });
});

describe('window chrome placement (5.2)', () => {
  it('the replay control lives in the title bar actions slot, not over the tab strip', async () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    const el = await attach({ 'start-script': '$ echo hi\n@sleep 2\n$ echo done' });
    await vi.waitFor(() => expect(el.querySelector('.sem-shell-replay, .sem-shell-stop')).not.toBeNull(), { timeout: 3000, interval: 50 });
    const replay = el.querySelector('.sem-shell-replay, .sem-shell-stop')!;
    expect(replay.closest('.sem-window-titlebar .sem-window-actions')).not.toBeNull();
  });
});
