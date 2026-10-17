// @vitest-environment happy-dom
// Unit spec — terminal tabs (CORE-V2 §11.2/§11.3, shell-v3 Epoch 3)
//
// Feature: per-tab sessions (§11.2 — each tab owns one session, VFS shared)
//   Scenario: `tab new` opens + activates a second session with its own cwd
//   Scenario: env, history, and transcript are per-tab; the VFS is shared
//   Scenario: switch restores the session's lines and its input buffer
//   Scenario: an OSC 0 title in one tab's output names only that tab
//   Scenario: direnv TAB_TITLE names the cd'ing tab; TAB_THEME themes the frame
// Feature: the `tab`/`tabs` builtin
//   Scenario: new/close/rename/list and the `tabs` alias
//   Scenario: errors — bad position, unknown subcommand
//   Scenario: the last tab never closes; capacity is 9
// Feature: tab keys + strip (§11.3)
//   Scenario: Ctrl+Shift+T opens, Ctrl+Shift+W closes, Ctrl+PgUp/PgDn cycle
//   Scenario: Alt+1..9 jump by position
//   Scenario: strip is a tablist — aria-selected, roving tabindex, arrows
//   Scenario: click activates; × closes
// Feature: close confirm (a live app owns its screen)
//   Scenario: first ×/Ctrl+Shift+W on a live tab confirms; second closes
// Feature: `tabs` attribute keeps the strip visible with a single tab
// Feature: replay renders in the start-script FETCH flow (r2 follow-up)
//   Scenario: fetched file → replay button appears → click replays the demo

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '../../src/shell/sem-shell.js';
import { SemShell } from '../../src/shell/sem-shell.js';

async function mount(attributes: Record<string, string> = {}): Promise<SemShell> {
  const el = document.createElement('sem-shell') as SemShell;
  el.id = 'tabs-spec';
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Run one line through the ACTIVE session via the prompt form (the demo driver's path). */
async function run(el: SemShell, line: string): Promise<void> {
  const input = el.querySelector('.sem-shell-input') as HTMLInputElement;
  input.value = line;
  const form = el.querySelector('.sem-shell-prompt') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await el.updateComplete;
}

function frameKey(el: SemShell, init: KeyboardEventInit): void {
  (el.querySelector('.sem-shell-frame') as HTMLElement).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
  );
}

function strip(el: SemShell): HTMLElement | null {
  return el.querySelector('.sem-term-tabs');
}

function tabs(el: SemShell): HTMLElement[] {
  return Array.from(el.querySelectorAll('[role="tab"]'));
}

function activeTab(el: SemShell): HTMLElement | null {
  return (el.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null) ?? null;
}

function lastLine(el: SemShell): string {
  return el.lines.at(-1)?.text ?? '';
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('per-tab sessions (§11.2)', () => {
  it('tab new opens + activates a second session with its own cwd', async () => {
    const el = await mount();
    await el.core.vfs.mkdir('/proj');
    await run(el, 'cd /proj');
    expect(el.cwd).toBe('/proj');
    await run(el, 'tab new');
    // The new tab is active, fresh at `/`, and the strip is visible.
    expect(el.tabModel.count).toBe(2);
    expect(el.cwd).toBe('/');
    expect(strip(el)).not.toBeNull();
    expect(activeTab(el)?.textContent).toContain('shell 2');
    // Session 1 kept its cwd.
    frameKey(el, { key: '1', altKey: true });
    await el.updateComplete;
    expect(el.cwd).toBe('/proj');
  });

  it('env, history, and transcript are per-tab; the VFS is shared', async () => {
    const el = await mount();
    await run(el, 'export TAB_SPEC=from-a');
    await run(el, 'echo transcript-a');
    await run(el, 'tab new');
    await run(el, 'echo transcript-b');
    // Env: the new session never saw the export.
    expect(el.core.state.env.TAB_SPEC).toBeUndefined();
    // Transcript: the new session's lines hold only its own output.
    expect(el.lines.some((line) => line.text.includes('transcript-a'))).toBe(false);
    expect(el.lines.some((line) => line.text.includes('transcript-b'))).toBe(true);
    // History: ArrowUp in the new session does not summon tab A's line.
    const input = el.querySelector('.sem-shell-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(input.value).not.toContain('transcript-a');
    // Shared VFS: tab B sees the file tab A wrote.
    el.core.vfs.mountFile('/shared.txt', 'shared');
    frameKey(el, { key: '1', altKey: true });
    await el.updateComplete;
    expect(el.core.vfs.read('/shared.txt')).toBe('shared');
  });

  it('switch restores the session lines and the input buffer', async () => {
    const el = await mount();
    await run(el, 'echo from-a');
    const input = el.querySelector('.sem-shell-input') as HTMLInputElement;
    input.value = 'hel';
    // Any keydown adopts the visible value into the discipline (syncFrom).
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    // Open tab 2 by KEY — the form path would overwrite the draft buffer.
    frameKey(el, { key: 't', ctrlKey: true, shiftKey: true });
    await el.updateComplete;
    await run(el, 'echo from-b');
    input.value = 'wor';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    frameKey(el, { key: '1', altKey: true });
    await el.updateComplete;
    expect(el.lines.some((line) => line.text.includes('from-a'))).toBe(true);
    expect(el.lines.some((line) => line.text.includes('from-b'))).toBe(false);
    expect(input.value).toBe('hel');
  });

  it('an OSC 0 title in one tab output names only that tab', async () => {
    const el = await mount();
    el.core.vfs.mountFile('/osc.txt', '\x1b]0;hello from osc\x07plain\n');
    await run(el, 'cat /osc.txt');
    await el.updateComplete;
    // The active session's feed carries the title (the title bar reads it).
    expect(el.titleFeed.title).toBe('hello from osc');
    await run(el, 'tab new');
    // The strip shows it on tab 1 only; the new active tab keeps its label.
    expect(tabs(el)[0]?.textContent).toContain('hello from osc');
    expect(activeTab(el)?.textContent).not.toContain('hello from osc');
  });

  it('direnv TAB_TITLE names the cd-ing tab; TAB_THEME themes the frame', async () => {
    const el = await mount();
    await el.core.vfs.mkdir('/proj');
    el.core.vfs.mountFile('/proj/.envrc', 'export TAB_TITLE=proj\nexport TAB_THEME=ocean\n');
    await run(el, 'direnv allow /proj'); // .envrc loads only when approved
    await run(el, 'cd /proj');
    await el.updateComplete;
    expect(el.titleFeed.title).toBe('proj');
    expect(el.querySelector('.sem-shell-frame')?.getAttribute('data-sem-tab-theme')).toBe('ocean');
    // A second tab keeps its default label — chrome is per-tab.
    await run(el, 'tab new');
    expect(tabs(el)[0]?.textContent).toContain('proj');
    expect(activeTab(el)?.textContent).toContain('shell 2');
  });
});

describe('the tab/tabs builtin', () => {
  it('new/close/rename/list and the tabs alias', async () => {
    const el = await mount();
    await run(el, 'tab new work');
    expect(activeTab(el)?.textContent).toContain('work');
    await run(el, 'tab rename dept');
    expect(activeTab(el)?.textContent).toContain('dept');
    await run(el, 'tabs');
    const listing = el.lines.slice(-2).map((line) => line.text);
    expect(listing[0]).toMatch(/^1  /); // tab 1: not active, default label
    expect(listing[1]).toMatch(/^2\* /); // tab 2: active, renamed
    // Switch back to tab 1, then close by position: tab 2 goes away.
    frameKey(el, { key: '1', altKey: true });
    await el.updateComplete;
    await run(el, 'tab close 2');
    expect(el.tabModel.count).toBe(1);
    expect(el.lines.at(-1)?.text).toContain('closed');
  });

  it('errors — bad position and unknown subcommand', async () => {
    const el = await mount();
    await run(el, 'tab close x');
    // The shell appends an `exit` status line after the error.
    expect(el.lines.at(-2)?.text).toContain('strip number');
    await run(el, 'tab frobnicate');
    expect(el.lines.at(-2)?.text).toContain('unknown subcommand');
  });

  it('the last tab never closes; capacity is 9', async () => {
    const el = await mount();
    await run(el, 'tab close 1');
    expect(el.tabModel.count).toBe(1);
    expect(lastLine(el)).toContain('last tab stays open');
    for (let i = 0; i < 8; i++) await run(el, 'tab new');
    expect(el.tabModel.count).toBe(9);
    await run(el, 'tab new');
    expect(el.tabModel.count).toBe(9);
    expect(lastLine(el)).toContain('9-tab limit');
  });
});

describe('tab keys + strip (§11.3)', () => {
  it('Ctrl+Shift+T opens, Ctrl+Shift+W closes, Ctrl+PgUp/PgDn cycle', async () => {
    const el = await mount();
    frameKey(el, { key: 't', ctrlKey: true, shiftKey: true });
    await el.updateComplete;
    expect(el.tabModel.count).toBe(2);
    frameKey(el, { key: 'PageUp', ctrlKey: true });
    await el.updateComplete;
    expect(el.tabModel.indexOf(el.tabModel.activeId ?? 0)).toBe(0);
    frameKey(el, { key: 'PageDown', ctrlKey: true });
    await el.updateComplete;
    expect(el.tabModel.indexOf(el.tabModel.activeId ?? 0)).toBe(1);
    frameKey(el, { key: 'w', ctrlKey: true, shiftKey: true });
    await el.updateComplete;
    expect(el.tabModel.count).toBe(1);
  });

  it('Alt+1..9 jump by position', async () => {
    const el = await mount();
    await run(el, 'tab new');
    await run(el, 'tab new');
    frameKey(el, { key: '2', altKey: true });
    await el.updateComplete;
    expect(el.tabModel.indexOf(el.tabModel.activeId ?? 0)).toBe(1);
    frameKey(el, { key: '3', altKey: true });
    await el.updateComplete;
    expect(el.tabModel.indexOf(el.tabModel.activeId ?? 0)).toBe(2);
  });

  it('the strip is a tablist — aria-selected, roving tabindex, arrow focus', async () => {
    const el = await mount();
    await run(el, 'tab new');
    const list = el.querySelector('[role="tablist"]');
    expect(list).not.toBeNull();
    const all = tabs(el);
    expect(all).toHaveLength(2);
    // Exactly one selected tab holds the roving tab stop; the rest are -1.
    const selected = all.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute('tabindex')).toBe('0');
    const inactive = all.find((tab) => tab.getAttribute('aria-selected') !== 'true');
    expect(inactive?.getAttribute('tabindex')).toBe('-1');
    // Deterministic start: activate tab 1, then ArrowRight moves the
    // selection AND the focus to tab 2.
    all[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    (all[0] as HTMLElement).focus();
    (all[0] as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    await el.updateComplete;
    expect(el.tabModel.indexOf(el.tabModel.activeId ?? 0)).toBe(1);
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe(String(el.tabModel.tabs[1]?.id));
  });

  it('click activates; the × button closes', async () => {
    const el = await mount();
    await run(el, 'tab new');
    tabs(el)[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    expect(el.tabModel.indexOf(el.tabModel.activeId ?? 0)).toBe(0);
    const close = el.querySelector('[data-tab-close="2"]');
    close?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    expect(el.tabModel.count).toBe(1);
  });
});

describe('close confirm for a live app', () => {
  it('first Ctrl+Shift+W confirms, second closes', async () => {
    const el = await mount();
    el.core.vfs.mountFile('/page.txt', 'one\ntwo\nthree\n');
    await run(el, 'tab new');
    await run(el, 'bat /page.txt'); // a tty claims the full-screen pager (§6.4)
    await el.updateComplete;
    expect(el.appLive).toBe(true);
    frameKey(el, { key: 'w', ctrlKey: true, shiftKey: true });
    await el.updateComplete;
    // Armed, not closed: the strip asks, the tab stays.
    expect(el.tabModel.count).toBe(2);
    expect(activeTab(el)?.textContent).toContain('confirm close?');
    frameKey(el, { key: 'w', ctrlKey: true, shiftKey: true });
    await el.updateComplete;
    expect(el.tabModel.count).toBe(1);
  });
});

describe('the tabs attribute', () => {
  it('keeps the strip visible with a single tab', async () => {
    const el = await mount({ tabs: '' });
    expect(strip(el)).not.toBeNull();
    expect(tabs(el)).toHaveLength(1);
    const plain = await mount();
    expect(strip(plain)).toBeNull();
  });
});

describe('replay in the start-script FETCH flow (r2 follow-up)', () => {
  it('a fetched file shows the replay button; clicking replays the demo', async () => {
    // happy-dom's IntersectionObserver never reports; autostart waits for
    // "in view" forever. A fake observer reports immediately visible —
    // the same injectable seam script-autostart.test.ts uses.
    class FakeIntersectionObserver {
      #callback: (entries: Array<{ intersectionRatio: number }>) => void;
      constructor(callback: (entries: Array<{ intersectionRatio: number }>) => void) {
        this.#callback = callback;
      }
      observe(target: Element): void {
        this.#callback([{ intersectionRatio: 1 }]);
        void target;
      }
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('$ echo replay-marker-42\n', { status: 200 })),
    );
    const el = await mount({ 'start-script': '/demo/scripts/landing.txt' });
    // THE r2 bug: the button never rendered because the fetched body never
    // reached #hasScript.
    await vi.waitFor(() => expect(el.querySelector('.sem-shell-replay')).not.toBeNull(), { timeout: 4_000 });
    await vi.waitFor(
      () => expect(el.lines.some((line) => line.text.includes('replay-marker-42'))).toBe(true),
      { timeout: 15_000, interval: 100 },
    );
    const markerCount = () => el.lines.filter((line) => line.text.includes('replay-marker-42')).length;
    const first = markerCount();
    (el.querySelector('.sem-shell-replay') as HTMLButtonElement).click();
    await el.updateComplete;
    await vi.waitFor(() => expect(markerCount()).toBeGreaterThan(first), { timeout: 15_000, interval: 100 });
  }, 40_000);
});
