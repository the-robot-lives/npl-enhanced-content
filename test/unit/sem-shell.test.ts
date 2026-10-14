// @vitest-environment happy-dom
// Unit spec — the elements: <sem-terminal> (core) and <sem-shell> (the
// SemText demo configured on top of it)
//
// Feature: zero-JS contract
//   Scenario: authored children are the static transcript (no input element)
//   Scenario: the upgrade replaces them with a live region + prompt
// Feature: the core stays SemText-free
//   Scenario: a bare <sem-terminal> has no demo commands
// Feature: the demo plugin on <sem-shell>
//   Scenario: boot reports the local mount and the refused CDN demo plugin
//   Scenario: ls / semtext run through the prompt
// Feature: terminal mechanics
//   Scenario: up/down history with draft restore; Ctrl+L clears
// Feature: open
//   Scenario: non-HTML refused with a stderr line, no window
//   Scenario: .html opens a blob window with noopener,noreferrer
// Feature: plugins attribute
//   Scenario: a failing manifest URL prints a line and is recorded; the terminal keeps working

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../../src/terminal/sem-terminal.js';
import '../../src/shell/sem-shell.js';
import { SemTerminal } from '../../src/terminal/sem-terminal.js';
import { SemShell } from '../../src/shell/sem-shell.js';

type Opened = { url: string; target: string; features: string };

let opened: Opened[];
let realOpen: typeof window.open;

const inputOf = (el: SemTerminal): HTMLInputElement =>
  el.querySelector('.sem-shell-input') as HTMLInputElement;

function type(el: SemTerminal, command: string): void {
  const input = inputOf(el);
  input.value = command;
  input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function attach(tag: string): Promise<SemTerminal> {
  const el = document.createElement(tag) as SemTerminal;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

beforeEach(() => {
  opened = [];
  realOpen = window.open;
  window.open = ((url: string, target: string, features: string) => {
    opened.push({ url, target, features });
    return window;
  }) as typeof window.open;
});

afterEach(() => {
  window.open = realOpen;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('zero-JS contract', () => {
  it('authored children are the static transcript, with no input element', () => {
    const el = document.createElement('sem-shell') as SemShell;
    el.innerHTML =
      '<div class="sem-shell-frame"><div class="sem-shell-transcript" role="log"><div class="sem-shell-line">$ ls</div></div></div>';
    expect(el.querySelector('.sem-shell-input')).toBeNull();
    document.body.appendChild(el);
    return el.updateComplete.then(() => {
      expect(el.querySelector('.sem-shell-input')).not.toBeNull();
      expect(el.textContent).not.toContain('$ ls');
      expect(el.querySelector('[role="log"]')).not.toBeNull();
      expect(el.querySelector('[role="log"]')!.getAttribute('aria-live')).toBe('polite');
    });
  });
});

describe('the core stays SemText-free', () => {
  it('a bare <sem-terminal> has no demo commands', async () => {
    const el = await attach('sem-terminal');
    type(el, 'ls');
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'stderr' && l.text.includes('command not found: ls'))).toBe(true);
    expect(el.lines.some((l) => l.text.includes('demo/'))).toBe(false);
  });

  it('a failing plugins URL prints a line, is recorded, and the terminal keeps working', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    const el = document.createElement('sem-terminal') as SemTerminal;
    el.setAttribute('plugins', 'one.json two.json');
    document.body.appendChild(el);
    await el.updateComplete;
    await vi.waitFor(() => expect(el.core.loadErrors).toHaveLength(2));
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'stderr' && l.text.includes('one.json'))).toBe(true);
    type(el, 'help');
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'stdout' && l.text === 'commands:')).toBe(true);
  });
});

describe('<sem-shell> — the demo plugin', () => {
  it('boots with the local mount and the refused CDN demo plugin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const el = await attach('sem-shell');
    expect(el.lines.some((l) => l.text.includes('semtext-demo 0.1.0 mounted'))).toBe(true);
    await vi.waitFor(() =>
      expect(el.lines.some((l) => l.kind === 'stderr' && l.text.includes('integrity'))).toBe(true),
    );
    expect(fetchMock).not.toHaveBeenCalled(); // refused before any network request
    expect(el.core.loadErrors).toHaveLength(1);
    expect(el.core.hasCommand('semtext')).toBe(true);
  });

  it('ls and semtext run through the prompt', async () => {
    const el = await attach('sem-shell');
    type(el, 'ls --color=never');
    type(el, 'semtext outline demo/welcome.html');
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'stdout' && l.text === 'demo/')).toBe(true);
    expect(el.lines.some((l) => l.kind === 'stdout' && l.text.startsWith('h1 Welcome'))).toBe(true);
    expect(el.cwd).toBe('/');
  });

  it('plain ls colorizes directories; color is off when piped', async () => {
    const el = await attach('sem-shell');
    type(el, 'ls');
    type(el, 'ls | wc -l');
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'stdout' && l.text.includes('\x1b[01;34m'))).toBe(true);
    // the piped stage saw plain text: wc counted 2 entries (demo/, README.md)
    expect(el.lines.some((l) => l.kind === 'stdout' && /^ *2$/.test(l.text))).toBe(true);
  });
});

describe('terminal mechanics', () => {
  it('up/down history with draft restore; Ctrl+L clears', async () => {
    const el = await attach('sem-shell');
    type(el, 'ls');
    type(el, 'pwd');
    const input = inputOf(el);
    input.value = 'draft text';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(input.value).toBe('ls');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(input.value).toBe('pwd');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(input.value).toBe('draft text');
    el.lines = [...el.lines, { kind: 'stdout', text: 'filler' }];
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
    expect(el.lines).toEqual([]);
  });
});

describe('scripted playback + the flashcard view', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the script attribute types on open, runs, and Escape hands over', async () => {
    vi.useFakeTimers();
    const el = document.createElement('sem-shell') as SemShell;
    // The trailing wait keeps the script running while the test inspects it;
    // the run step after the wait must never land once Escape stops playback.
    el.setAttribute(
      'script',
      '[{"type":"type","text":"ls","delayMs":10},{"type":"key","key":"Enter"},{"type":"wait","ms":5000},{"type":"run"}]',
    );
    document.body.appendChild(el);
    await el.updateComplete;
    const input = inputOf(el);
    expect(input.readOnly).toBe(false); // typing starts after the open delay
    vi.advanceTimersByTime(350);
    expect(el.playing).toBe(true);
    expect(input.value).toBe('l'); // first char landed with the start
    expect(input.readOnly).toBe(true); // the script owns the keyboard
    vi.advanceTimersByTime(20); // the rest runs with zero gaps between steps
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'stdout' && l.text.includes('demo/'))).toBe(true);
    expect(input.value).toBe(''); // consumed by the run
    expect(el.playing).toBe(true); // the 5000ms wait is still pending
    el.querySelector('.sem-shell-frame')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await el.updateComplete;
    expect(el.playing).toBe(false);
    expect(el.lines.some((l) => l.kind === 'comment' && l.text.includes('playback stopped'))).toBe(true);
    const freed = inputOf(el);
    expect(freed.readOnly).toBe(false);
    vi.advanceTimersByTime(10_000); // the stopped script never resumes
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'cmd' && l.text.endsWith('$ '))).toBe(false);
  });

  it('a replay button restarts the script; no script, no button', async () => {
    vi.useFakeTimers();
    const el = document.createElement('sem-shell') as SemShell;
    el.setAttribute('script', '[{"type":"comment","text":"hi"},{"type":"wait","ms":300}]');
    document.body.appendChild(el);
    await el.updateComplete;
    const replay = el.querySelector('.sem-shell-replay') as HTMLButtonElement;
    expect(replay).not.toBeNull();
    vi.advanceTimersByTime(350);
    expect(el.playing).toBe(true);
    expect(el.lines.filter((l) => l.kind === 'comment' && l.text === 'hi')).toHaveLength(1);
    replay.click();
    await el.updateComplete;
    expect(el.playing).toBe(true); // restarted, still a script
    expect(el.lines.filter((l) => l.kind === 'comment' && l.text === 'hi')).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(el.playing).toBe(false); // and it finished again
    const bare = await attach('sem-terminal');
    expect(bare.querySelector('.sem-shell-replay')).toBeNull();
  });

  it('semtext tui opens the overlay; j, Enter, / and q drive it; Escape closes', async () => {
    const el = await attach('sem-shell');
    type(el, 'semtext tui demo/token-rotation.html');
    await el.updateComplete;
    const tui = el.querySelector('.sem-tui') as HTMLElement;
    expect(tui).not.toBeNull();
    expect(tui.getAttribute('role')).toBe('dialog');
    expect(tui.textContent).toContain('Token Rotation');
    expect(tui.textContent).toContain('card 1/');
    const front = tui.querySelector('.sem-tui-front')!.textContent ?? '';
    expect(front.length).toBeGreaterThan(0);
    expect(tui.querySelector('.sem-tui-back')).toBeNull(); // collapsed
    tui.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    await el.updateComplete;
    expect(tui.textContent).toContain('card 2/');
    tui.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await el.updateComplete;
    expect(tui.querySelector('.sem-tui-back')).not.toBeNull();
    tui.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    await el.updateComplete;
    expect(el.querySelector('.sem-tui')).toBeNull();
    expect(el.playing).toBe(false); // q closes the view without stopping a script
  });

  it('the TUI filter row narrows cards; its Escape stays in the row', async () => {
    const el = await attach('sem-shell');
    type(el, 'semtext tui demo/token-rotation.html');
    await el.updateComplete;
    const tui = el.querySelector('.sem-tui') as HTMLElement;
    tui.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    await el.updateComplete;
    const filter = tui.querySelector('.sem-tui-filter') as HTMLInputElement;
    expect(filter).not.toBeNull();
    filter.value = 'PKCE';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(tui.textContent).toContain('filter: PKCE');
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;
    expect(el.querySelector('.sem-tui-filter')).toBeNull(); // row closed, view kept
    expect(tui.textContent).toContain('filter: PKCE');
  });
});
describe('open', () => {
  it('non-HTML refused with a stderr line, no window', async () => {
    const el = await attach('sem-shell');
    type(el, 'open README.md');
    await el.updateComplete;
    expect(el.lines.some((l) => l.kind === 'stderr' && l.text.includes('not an HTML document'))).toBe(true);
    expect(opened).toEqual([]);
  });

  it('.html opens a blob window with noopener,noreferrer', async () => {
    const el = await attach('sem-shell');
    type(el, 'open demo/welcome.html');
    await el.updateComplete;
    expect(opened).toHaveLength(1);
    expect(opened[0].target).toBe('_blank');
    expect(opened[0].features).toBe('noopener,noreferrer');
    expect(opened[0].url).toMatch(/^blob:/);
  });
});

describe('storage + Tab completion', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const attachShell = async (id?: string): Promise<SemShell> => {
    const el = document.createElement('sem-shell') as SemShell;
    if (id) el.id = id;
    el.setAttribute('local-storage', '');
    document.body.appendChild(el);
    await el.updateComplete;
    return el;
  };

  it('local-storage without an id warns and stays off', async () => {
    const el = await attachShell();
    expect(el.lines.some((l) => l.kind === 'stderr' && l.text.includes('give this element an id'))).toBe(true);
    expect(window.localStorage.length).toBe(0); // nothing was persisted
  });

  it('local-storage with an id persists edits into a fresh element', async () => {
    const first = await attachShell('persist-probe');
    type(first, 'echo remembered > /notes.txt');
    await first.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0)); // the write-through flush
    expect(window.localStorage.getItem('semtext:shell:v1:persist-probe')).not.toBeNull();

    const second = await attachShell('persist-probe'); // a "reload"
    await new Promise((resolve) => setTimeout(resolve, 0)); // the restore graft is queued
    expect(second.core.vfs.read('/notes.txt')).toBe('remembered\n');
  });

  it('Tab completes through the element: extends, then lists', async () => {
    const el = await attachShell('tab-probe');
    const input = inputOf(el);
    const lineCount = (): number => el.lines.length;

    input.value = 'cat demo/wel';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await el.updateComplete;
    expect(input.value).toBe('cat demo/welcome.html '); // a single candidate extends + space
    expect(el.lines.length).toBe(lineCount()); // ...quietly

    input.value = 'cat demo/';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await el.updateComplete;
    const note = el.lines[el.lines.length - 1];
    expect(note?.kind).toBe('comment'); // candidates listed as one comment line
    expect(note?.text).toContain('token-rotation.html'); // listed inline
    expect(note?.text).toContain('more'); // capped display above 8 candidates
  });
});
