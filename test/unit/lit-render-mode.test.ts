// @vitest-environment happy-dom
// Unit spec — src/lit/shared/render-mode.ts + src/lit/sem-tui.ts
//
// Feature: the terminal render mode
//   Scenario: mode resolution — attribute, boolean spelling, ancestor frame, opt-out
//   Scenario: the driver mounts the outermost tui element and its pre
//   Scenario: nested sem-* elements never double-frame
//   Scenario: rich elements and pass-through wrappers stay unmounted
//   Scenario: cols reaches the renderers through the frame
//   Scenario: the a11y label names the element
//   Scenario: flipping the wrapper's mode unmounts the pres, rich wiring survives
//   Scenario: flipping back re-mounts the same content
//   Scenario: the toggle is a real button with aria-pressed
//   Scenario: placeholder elements render one line inside a frame
//   Scenario: mount/unmount are idempotent
//   Scenario: the vocabulary CSS gates the hide rule on the driver marker

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  resolveRenderMode,
  hasTuiRenderingAncestor,
  nearestTuiCols,
  mountTui,
  unmountTui,
  rescanRenderModes,
  TUI_ACTIVE_ATTR,
} from '../../src/lit/shared/render-mode.js';
import { SemTui } from '../../src/lit/sem-tui.js';
import { SemNote } from '../../src/lit/sem-note.js';
import { SemFacts } from '../../src/lit/sem-facts.js';

async function mount(html: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  for (const el of Array.from(host.querySelectorAll('*'))) {
    if (!(el as unknown as { updateComplete?: unknown }).updateComplete) {
      customElements.upgrade(el);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  return host;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('mode resolution', () => {
  it('defaults to rich', () => {
    const el = document.createElement('sem-note');
    document.body.appendChild(el);
    expect(resolveRenderMode(el)).toBe('rich');
    expect(hasTuiRenderingAncestor(el)).toBe(false);
  });

  it('the attribute forces either mode', () => {
    const tui = document.createElement('sem-note');
    tui.setAttribute('render-mode', 'tui');
    const rich = document.createElement('sem-note');
    rich.setAttribute('render-mode', 'rich');
    document.body.append(tui, rich);
    expect(resolveRenderMode(tui)).toBe('tui');
    expect(resolveRenderMode(rich)).toBe('rich');
  });

  it('the boolean spelling works, including the opt-out value', () => {
    const tui = document.createElement('sem-note');
    tui.setAttribute('tui', '');
    const back = document.createElement('sem-note');
    back.setAttribute('tui', 'rich');
    document.body.append(tui, back);
    expect(resolveRenderMode(tui)).toBe('tui');
    expect(resolveRenderMode(back)).toBe('rich');
  });

  it('a sem-tui ancestor provides the mode', () => {
    const frame = document.createElement('sem-tui');
    const note = document.createElement('sem-note');
    frame.appendChild(note);
    document.body.appendChild(frame);
    expect(resolveRenderMode(note)).toBe('tui');
    frame.setAttribute('data-mode', 'rich');
    expect(resolveRenderMode(note)).toBe('rich');
    expect(hasTuiRenderingAncestor(note)).toBe(false); // the frame renders nothing itself
  });

  it('an explicit attribute beats the frame', () => {
    const frame = document.createElement('sem-tui');
    const optOut = document.createElement('sem-note');
    optOut.setAttribute('render-mode', 'rich');
    const optIn = document.createElement('sem-note');
    optIn.setAttribute('render-mode', 'tui');
    frame.append(optOut, optIn);
    document.body.appendChild(frame);
    expect(resolveRenderMode(optOut)).toBe('rich');
    expect(resolveRenderMode(optIn)).toBe('tui');
  });

  it('a tui sem-* ancestor marks its descendants inner', () => {
    const frame = document.createElement('sem-tui');
    const facts = document.createElement('sem-facts');
    const fact = document.createElement('sem-fact');
    facts.appendChild(fact);
    frame.appendChild(facts);
    document.body.appendChild(frame);
    expect(hasTuiRenderingAncestor(facts)).toBe(false);
    expect(hasTuiRenderingAncestor(fact)).toBe(true);
  });
});

describe('the document driver', () => {
  it('mounts the outermost tui elements only', async () => {
    const host = await mount(
      `<sem-tui id="frame">
         <sem-note id="outer-note">Rich content one.</sem-note>
         <sem-facts id="facts"><sem-fact>Fact one.</sem-fact></sem-facts>
         <sem-note id="opt-out" render-mode="rich">Stays rich.</sem-note>
       </sem-tui>`,
    );
    rescanRenderModes(document);

    const frame = host.querySelector('sem-tui')!;
    const outerNote = host.querySelector('#outer-note')!;
    const facts = host.querySelector('#facts')!;
    const optOut = host.querySelector('#opt-out')!;
    const fact = host.querySelector('sem-fact')!;

    expect(outerNote.hasAttribute(TUI_ACTIVE_ATTR)).toBe(true);
    expect(outerNote.querySelector('pre.sem-tui')?.textContent).toContain('Rich content one.');
    expect(facts.hasAttribute(TUI_ACTIVE_ATTR)).toBe(true);
    expect(facts.querySelector('pre.sem-tui')?.textContent).toContain('Fact one.');
    // nested + opt-out + frame: never mounted
    expect(fact.hasAttribute(TUI_ACTIVE_ATTR)).toBe(false);
    expect(optOut.hasAttribute(TUI_ACTIVE_ATTR)).toBe(false);
    expect(frame.hasAttribute(TUI_ACTIVE_ATTR)).toBe(false);
    // authored children stay in the DOM
    expect(facts.querySelector('sem-fact')).toBe(fact);
  });

  it('rich elements render unmounted', async () => {
    await mount('<sem-note id="plain">Plain.</sem-note>');
    rescanRenderModes(document);
    const note = document.querySelector('#plain')!;
    expect(note.hasAttribute(TUI_ACTIVE_ATTR)).toBe(false);
    expect(note.querySelector('pre.sem-tui')).toBeNull();
  });

  it('frame cols reaches the renderers', async () => {
    await mount(
      `<sem-tui cols="36"><sem-note>${'word '.repeat(20)}</sem-note></sem-tui>`,
    );
    const frame = document.querySelector('sem-tui')!;
    const note = frame.querySelector('sem-note')!;
    expect(nearestTuiCols(note)).toBe(36);
    rescanRenderModes(document);
    const text = note.querySelector('pre.sem-tui')!.textContent ?? '';
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(36 + 8);
    }
  });

  it('the pre is labelled for screen readers', async () => {
    await mount('<sem-tui><sem-note id="n">Hi.</sem-note></sem-tui>');
    rescanRenderModes(document);
    const pre = document.querySelector('pre.sem-tui')!;
    expect(pre.getAttribute('aria-label')).toBe('sem-note #n — terminal text view');
    expect(pre.getAttribute('part')).toBe('tui');
  });

  it('placeholder elements render one line inside a frame', async () => {
    await mount(
      `<sem-tui><sem-chat id="chat"><div data-role="user">a</div></sem-chat></sem-tui>`,
    );
    rescanRenderModes(document);
    const chat = document.querySelector('sem-chat')!;
    expect(chat.hasAttribute(TUI_ACTIVE_ATTR)).toBe(true);
    expect(chat.querySelector('pre.sem-tui')?.textContent).toBe(
      '[sem-chat #chat: chat · 1 messages]',
    );
  });

  it('unmount restores rich visibility (attr removed, pre removed)', async () => {
    await mount('<sem-note id="n" render-mode="tui">Switch me.</sem-note>');
    rescanRenderModes(document);
    const note = document.querySelector('#n')!;
    expect(note.hasAttribute(TUI_ACTIVE_ATTR)).toBe(true);
    note.removeAttribute('render-mode');
    rescanRenderModes(document);
    expect(note.hasAttribute(TUI_ACTIVE_ATTR)).toBe(false);
    expect(note.querySelector('pre.sem-tui')).toBeNull();
    expect(note.textContent).toContain('Switch me.');
  });
});

describe('mount/unmount idempotency', () => {
  it('mounting twice keeps exactly one pre; unmount without mount is a no-op', async () => {
    const note = document.createElement('sem-note');
    note.setAttribute('render-mode', 'tui');
    note.textContent = 'Once.';
    document.body.appendChild(note);
    mountTui(note, 'text view');
    mountTui(note, 'text view');
    expect(note.querySelectorAll('pre.sem-tui').length).toBe(1);
    unmountTui(note);
    unmountTui(note);
    expect(note.querySelector('pre.sem-tui')).toBeNull();
    expect(note.hasAttribute(TUI_ACTIVE_ATTR)).toBe(false);
  });
});

describe('the sem-tui component', () => {
  it('reflects its theme and starts in tui mode', async () => {
    const host = await mount('<sem-tui theme="amber"></sem-tui>');
    const frame = host.querySelector('sem-tui') as SemTui;
    expect(frame).toBeInstanceOf(SemTui);
    expect(frame.getAttribute('data-theme')).toBe('amber');
    expect(frame.getAttribute('data-mode')).toBe('tui');
    // invalid theme falls back to the default
    frame.setAttribute('theme', 'mauve');
    await frame.updateComplete;
    expect(frame.getAttribute('data-theme')).toBe('dark');
  });

  it('the toggle flips the subtree and dispatches the change event', async () => {
    const host = await mount(
      '<sem-tui toggle><sem-note id="tn">Flip me.</sem-note></sem-tui>',
    );
    const frame = host.querySelector('sem-tui') as SemTui;
    const note = host.querySelector('#tn')!;
    await frame.updateComplete;
    const btn = frame.querySelector('button.sem-tui-toggle') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('Terminal');

    let events = 0;
    document.addEventListener('sem-render-mode-change', () => events++);

    btn.click();
    await frame.updateComplete;
    expect(frame.getAttribute('data-mode')).toBe('rich');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('Rich');
    expect(events).toBe(1);

    // the driver honors the flip
    rescanRenderModes(document);
    expect(note.hasAttribute(TUI_ACTIVE_ATTR)).toBe(false);
    expect(note.querySelector('pre.sem-tui')).toBeNull();
    expect(note.textContent).toContain('Flip me.');

    // and flips back to the same terminal text
    btn.click();
    await frame.updateComplete;
    rescanRenderModes(document);
    expect(note.hasAttribute(TUI_ACTIVE_ATTR)).toBe(true);
    expect(note.querySelector('pre.sem-tui')?.textContent).toContain('Flip me.');
    // rich wiring survived both flips (the authored children never moved)
    expect(note.hasAttribute('data-sem-upgraded')).toBe(true);
    expect(note).toBeInstanceOf(SemNote);
    expect(frame.querySelector('sem-facts')).toBeNull(); // untouched tree shape
  });

  it('without toggle no header renders', async () => {
    const host = await mount('<sem-tui><sem-note>x</sem-note></sem-tui>');
    const frame = host.querySelector('sem-tui')!;
    await frame.updateComplete;
    expect(frame.querySelector('.sem-tui-header')).toBeNull();
  });
});

describe('vocabulary CSS contract', () => {
  const css = (): string =>
    readFileSync('themes/_vocabulary.css', 'utf8');

  it('gates the hide rule on the driver marker and scopes the pre', () => {
    const text = css();
    expect(text.includes('[data-sem-tui-active] > :not(pre.sem-tui)')).toBe(true);
    expect(text.includes('pre.sem-tui')).toBe(true);
    expect(text.includes('--sem-tui-bg')).toBe(true);
    expect(text.includes('sem-tui[data-theme="green"]')).toBe(true);
    expect(text.includes('prefers-reduced-motion')).toBe(true);
  });
});
