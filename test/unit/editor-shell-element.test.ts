// @vitest-environment happy-dom
/**
 * editor-shell-element — `<sem-editor>` Instrument-frame tests (EDITOR.md
 * §5.1–5.5, §7).
 *
 * Runs against the fake EditorDocument (test/unit/helpers/fake-editor-doc.ts)
 * until the model lane's implementation lands; everything asserted here goes
 * through the public contract in src/editor/model/types.ts, so the swap is
 * invisible to these tests.
 */

import { describe, expect, it } from 'vitest';

import '../../src/editor/shell/sem-editor.js';
import { SemEditor } from '../../src/editor/shell/sem-editor.js';
import { type FakeNode, fAttr, fEl, fText, fakeDoc } from './helpers/fake-editor-doc.js';
import type { EditorDocument } from '../../src/editor/model/types.js';

function tree(): FakeNode[] {
  return [
    fEl('n-title', 'title', [fAttr('id', 'doc-title')], [fText('t-title', 'Meeting Notes')]),
    fEl('n-sec', 'section', [fAttr('id', 'sec-1')], [
      fEl('n-h', 'heading', [fAttr('id', 'h-1'), fAttr('level', '2')], [fText('t-h', 'Agenda')]),
    ]),
  ];
}

function makeEditor(): { el: SemEditor; doc: EditorDocument } {
  const el = document.createElement('sem-editor') as SemEditor;
  document.body.appendChild(el);
  const doc = fakeDoc('<sem-doc>…</sem-doc>', tree());
  el.openDocument(doc);
  return { el, doc };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

function toolbarOf(el: SemEditor): HTMLDivElement {
  return el.querySelector('.sem-ed-topbar') as HTMLDivElement;
}

function buttonByLabel(el: SemEditor, label: string): HTMLButtonElement | null {
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
  return buttons.find((b) => b.getAttribute('aria-label') === label) ?? null;
}

describe('<sem-editor> frame', () => {
  it('wires the top bar, outline tree, inspector host, status bar and live region', () => {
    const { el } = makeEditor();
    expect(el.querySelector('.sem-ed-frame')).not.toBeNull();
    expect(el.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(el.querySelector('[role="tree"]')).not.toBeNull();
    expect(el.querySelector('.sem-ed-inspector')).not.toBeNull();
    const live = el.querySelector('.sem-ed-live');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    const viewport = el.querySelector('.sem-ed-panes');
    expect(viewport?.getAttribute('role')).toBe('region');
    expect(el.querySelector('.sem-ed-statusbar')).not.toBeNull();
    el.remove();
  });

  it('openDocument stamps edit-mode, data-mode, the doc name and a clean dirty dot', () => {
    const { el } = makeEditor();
    expect(el.hasAttribute('edit-mode')).toBe(true);
    expect(el.getAttribute('data-mode')).toBe('wysiwyg');
    expect((el.querySelector('.sem-ed-doc-name') as HTMLInputElement).value).toBe('Meeting Notes');
    expect(el.querySelector('.sem-ed-dot')?.hasAttribute('data-on')).toBe(false);
    expect(el.querySelector('.sem-ed-status-saved')?.textContent).toContain('Saved');
    el.remove();
  });

  it('exposes the code pane slot', () => {
    const { el } = makeEditor();
    const slot = el.querySelector('slot[name="code-view"]');
    expect(slot).not.toBeNull();
    el.remove();
  });
});

describe('mode switching', () => {
  it('reflects data-mode, syncs the radiogroup, updates the status bar and emits sem-edit-mode', async () => {
    const { el } = makeEditor();
    const seen: string[] = [];
    el.addEventListener('sem-edit-mode', (e) => seen.push((e as CustomEvent).detail.mode));
    el.mode = 'code';
    await el.updateComplete;
    expect(el.getAttribute('data-mode')).toBe('code');
    expect(seen).toEqual(['code']);
    expect(el.querySelector('[data-mode-value="code"]')?.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('[data-mode-value="wysiwyg"]')?.getAttribute('aria-checked')).toBe('false');
    expect(el.querySelector('.sem-ed-status-mode')?.textContent).toBe('Code');
    el.remove();
  });

  it('cycles wysiwyg → code → split → wysiwyg', async () => {
    const { el } = makeEditor();
    el.cycleMode();
    expect(el.mode).toBe('code');
    el.cycleMode();
    expect(el.mode).toBe('split');
    el.cycleMode();
    expect(el.mode).toBe('wysiwyg');
    await el.updateComplete;
    expect(el.getAttribute('data-mode')).toBe('wysiwyg');
    el.remove();
  });

  it('ArrowRight inside the radiogroup advances the mode', async () => {
    const { el } = makeEditor();
    const group = el.querySelector('[role="radiogroup"]') as HTMLElement;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await el.updateComplete;
    expect(el.mode).toBe('code');
    el.remove();
  });
});

describe('undo / redo buttons', () => {
  it('track the history stack', async () => {
    const { el, doc } = makeEditor();
    const undo = buttonByLabel(el, 'Undo') as HTMLButtonElement;
    const redo = buttonByLabel(el, 'Redo') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);

    doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: 'n-sec', name: 'data-x', value: '1' });
    });
    await flush();
    expect(undo.disabled).toBe(false);

    undo.click();
    await flush();
    const sec = doc.node('n-sec') as { attrs: Array<{ name: string; value: string | null }> };
    expect(sec.attrs.find((a) => a.name === 'data-x')).toBeUndefined();
    expect(redo.disabled).toBe(false);

    redo.click();
    await flush();
    const sec2 = doc.node('n-sec') as { attrs: Array<{ name: string; value: string | null }> };
    expect(sec2.attrs.find((a) => a.name === 'data-x')?.value).toBe('1');
    el.remove();
  });
});

describe('dirty / saved state', () => {
  it('marks the dot dirty on change and clears it via markSaved()', async () => {
    const { el, doc } = makeEditor();
    doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: 'n-sec', name: 'data-x', value: '1' });
    });
    await flush();
    expect(el.querySelector('.sem-ed-dot')?.hasAttribute('data-on')).toBe(true);
    expect(el.querySelector('.sem-ed-status-saved')?.textContent).toBe('Unsaved changes');

    el.markSaved();
    await flush();
    expect(el.querySelector('.sem-ed-dot')?.hasAttribute('data-on')).toBe(false);
    expect(el.querySelector('.sem-ed-status-saved')?.textContent).toContain('Saved');
    el.remove();
  });

  it('reports word + element counts in the status bar', () => {
    const { el } = makeEditor();
    const counts = el.querySelector('.sem-ed-status-counts')?.textContent ?? '';
    expect(counts).toContain('element');
    expect(counts).toContain('word');
    el.remove();
  });

  it('surfaces parse issues in the status bar with a jump list', () => {
    const { el } = makeEditor();
    el.reportIssues(
      [{ code: 'test', severity: 'error', message: 'Unexpected token', range: { start: 4, end: 9 } }],
      true,
    );
    const btn = el.querySelector('.sem-ed-status-problems') as HTMLButtonElement;
    expect(btn.textContent).toBe('1 problem');
    expect(btn.className).toContain('has-problems');
    const panel = el.querySelector('.sem-ed-problems') as HTMLElement;
    expect(panel.hidden).toBe(true);
    btn.click();
    expect(panel.hidden).toBe(false);
    const jump = panel.querySelector('.sem-ed-problem-jump') as HTMLButtonElement;
    expect(jump.textContent).toBe('Unexpected token');
    el.remove();
  });
});

describe('document name', () => {
  it('edits the name in the title bar and writes through to a <title> node', async () => {
    const { el, doc } = makeEditor();
    const input = el.querySelector('.sem-ed-doc-name') as HTMLInputElement;
    input.value = 'Renamed Doc';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(el.docName).toBe('Renamed Doc');
    const titleNode = doc.node('n-title') as { children: Array<{ id: string }> };
    expect(doc.textOf(titleNode.children[0].id)).toBe('Renamed Doc');
    el.remove();
  });
});

describe('outline (semantic tree)', () => {
  it('lists semantic blocks with content-derived titles; metadata (title) is not a row', () => {
    const { el } = makeEditor();
    const rows = Array.from(el.querySelectorAll('[role="treeitem"]'));
    expect(rows.length).toBe(2);
    expect(rows[0]?.getAttribute('data-sem-ed-node')).toBe('n-sec');
    expect(rows[1]?.getAttribute('data-sem-ed-node')).toBe('n-h');
    // content-derived label: the heading's own words, not the tag name
    expect(rows[1]?.querySelector('.sem-ed-outline-title')?.textContent).toBe('Agenda');
    expect(rows[1]?.getAttribute('aria-level')).toBe('2');
    el.remove();
  });

  it('hides presentational wrappers but keeps their semantic descendants', () => {
    const { el } = makeEditor();
    const doc = fakeDoc('<sem-doc>…</sem-doc>', [
      fEl('n-p', 'p', [], [
        fEl('n-note', 'sem-note', [fAttr('variant', 'info')], [fText('n-t', 'Hello there')]),
      ]),
    ]);
    el.openDocument(doc);
    const rows = Array.from(el.querySelectorAll('[role="treeitem"]'));
    expect(rows.map((r) => r.getAttribute('data-sem-ed-node'))).toEqual(['n-note']);
    // descriptor view is unwired in this harness → the tag is the base
    expect(rows[0]?.querySelector('.sem-ed-outline-title')?.textContent).toBe('sem-note — info');
    el.remove();
  });

  it('Enter selects a row and syncs aria-selected + the selection event', () => {
    const { el } = makeEditor();
    const ids: Array<string | null> = [];
    el.addEventListener('sem-edit-selection', (e) => ids.push((e as CustomEvent).detail.id));
    const row = el.querySelector('[data-sem-ed-node="n-h"]') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(el.ctx?.selectedId).toBe('n-h');
    expect(ids).toEqual(['n-h']);
    expect(row.getAttribute('aria-selected')).toBe('true');
    el.remove();
  });

  it('Delete removes the selected node through the model', () => {
    const { el, doc } = makeEditor();
    el.ctx?.select('n-h');
    const row = el.querySelector('[data-sem-ed-node="n-h"]') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(doc.childrenOf('n-sec').length).toBe(0);
    expect(doc.history().length).toBe(1);
    el.remove();
  });

  it('F2 opens the property modal', () => {
    const { el } = makeEditor();
    el.ctx?.select('n-h');
    const row = el.querySelector('[data-sem-ed-node="n-h"]') as HTMLElement;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const dialog = document.body.querySelector('dialog.sem-ed-modal');
    expect(dialog).not.toBeNull();
    dialog?.close();
    el.remove();
  });
});

describe('inspector', () => {
  it('shows schema fields for the selected element and applies live', async () => {
    const { el, doc } = makeEditor();
    (el.ctx as unknown as { schema: unknown }).schema = {
      schemaFor: (tag: string) =>
        tag === 'heading'
          ? {
              tag,
              attrs: [
                { name: 'level', type: 'string', allowedValues: ['1', '2', '3'] },
                { name: 'collapsed', type: 'boolean' },
              ],
            }
          : null,
    };
    el.ctx?.select('n-h');
    await flush();
    const select = el.querySelector('.sem-ed-inspector select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('2');
    select.value = '3';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const heading = doc.node('n-h') as { attrs: Array<{ name: string; value: string | null }> };
    expect(heading.attrs.find((a) => a.name === 'level')?.value).toBe('3');
    el.remove();
  });

  it('shows the empty state with nothing selected', () => {
    const { el } = makeEditor();
    expect(el.querySelector('.sem-ed-inspector-empty')?.textContent).toContain('Select an element');
    el.remove();
  });
});

describe('breadcrumbs', () => {
  it('renders the ancestor chain with the current location', () => {
    const { el } = makeEditor();
    el.ctx?.select('n-h');
    const crumbs = Array.from(el.querySelectorAll('.sem-ed-crumb')).map((c) => c.textContent);
    expect(crumbs.some((t) => t?.includes('Document'))).toBe(true);
    expect(crumbs.some((t) => t?.includes('section'))).toBe(true);
    expect(crumbs.some((t) => t?.includes('heading'))).toBe(true);
    const current = el.querySelector('[aria-current="location"]');
    expect(current?.textContent).toContain('heading');
    el.remove();
  });

  it('clicking an ancestor crumb selects it', () => {
    const { el } = makeEditor();
    el.ctx?.select('n-h');
    const crumbs = Array.from(el.querySelectorAll<HTMLButtonElement>('button.sem-ed-crumb'));
    const sectionCrumb = crumbs.find((c) => c.textContent?.includes('section'));
    sectionCrumb?.click();
    expect(el.ctx?.selectedId).toBe('n-sec');
    el.remove();
  });
});

describe('keyboard shortcuts (§7)', () => {
  it('Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes', async () => {
    const { el, doc } = makeEditor();
    doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: 'n-sec', name: 'data-x', value: '1' });
    });
    const frame = el.querySelector('.sem-ed-frame') as HTMLElement;
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await flush();
    const sec = doc.node('n-sec') as { attrs: Array<{ name: string }> };
    expect(sec.attrs.find((a) => a.name === 'data-x')).toBeUndefined();

    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    const sec2 = doc.node('n-sec') as { attrs: Array<{ name: string; value: string | null }> };
    expect(sec2.attrs.find((a) => a.name === 'data-x')?.value).toBe('1');
    el.remove();
  });

  it('does not swallow undo inside text fields', () => {
    const { el, doc } = makeEditor();
    doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: 'n-sec', name: 'data-x', value: '1' });
    });
    const input = document.createElement('input');
    (el.querySelector('.sem-ed-frame') as HTMLElement).appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(doc.canUndo()).toBe(true);
    el.remove();
  });

  it('Cmd/Ctrl+Shift+E cycles the mode', async () => {
    const { el } = makeEditor();
    const frame = el.querySelector('.sem-ed-frame') as HTMLElement;
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await el.updateComplete;
    expect(el.mode).toBe('code');
    el.remove();
  });

  it('Cmd/Ctrl+Shift+O focuses the outline', () => {
    const { el } = makeEditor();
    const frame = el.querySelector('.sem-ed-frame') as HTMLElement;
    frame.dispatchEvent(new KeyboardEvent('keydown', { key: 'O', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    const focusedRow = document.activeElement as HTMLElement;
    expect(focusedRow.className).toContain('sem-ed-outline-item');
    el.remove();
  });
});

describe('toolbar actions', () => {
  it('Insert/Export/Open dispatch request events with selection context', () => {
    const { el } = makeEditor();
    el.ctx?.select('n-h');
    const seen: string[] = [];
    for (const type of ['sem-edit-insert-request', 'sem-edit-export-request', 'sem-edit-open-request']) {
      el.addEventListener(type, () => seen.push(type));
    }
    buttonByLabel(el, 'Insert')?.click();
    buttonByLabel(el, 'Export')?.click();
    buttonByLabel(el, 'Open')?.click();
    expect(seen).toEqual(['sem-edit-insert-request', 'sem-edit-export-request', 'sem-edit-open-request']);
    const insertDetail = ((): unknown => {
      let detail: unknown;
      el.addEventListener('sem-edit-insert-request', (e) => (detail = (e as CustomEvent).detail), { once: true });
      buttonByLabel(el, 'Insert')?.click();
      return detail;
    })();
    expect(insertDetail).toEqual({ parent: 'n-h', index: null });
    el.remove();
  });

  it('toggles the outline and inspector panels', () => {
    const { el } = makeEditor();
    const frame = el.querySelector('.sem-ed-frame') as HTMLElement;
    // defaults depend on container width (narrow ⇒ sheets open); assert flips
    const flip = (label: string, key: 'outlineOpen' | 'inspectorOpen'): void => {
      const before = frame.dataset[key] === 'true';
      buttonByLabel(el, label)?.click();
      expect(frame.dataset[key]).toBe(before ? 'false' : 'true');
      buttonByLabel(el, label)?.click();
      expect(frame.dataset[key]).toBe(before ? 'true' : 'false');
    };
    flip('Outline', 'outlineOpen');
    flip('Properties', 'inspectorOpen');
    el.remove();
  });
});

describe('read-only mode', () => {
  it('disables the editing verbs and announces the state', async () => {
    const { el, doc } = makeEditor();
    doc.transaction('test', (tx) => {
      tx.push({ type: 'setAttr', node: 'n-sec', name: 'data-x', value: '1' });
    });
    await flush();
    el.readonly = true;
    await el.updateComplete;
    expect(el.hasAttribute('readonly')).toBe(true);
    expect(buttonByLabel(el, 'Insert')?.disabled).toBe(true);
    expect(buttonByLabel(el, 'Undo')?.disabled).toBe(true);
    expect(el.querySelector('.sem-ed-status-ro')?.hidden).toBe(false);
    expect(el.querySelector('.sem-ed-status-saved')?.textContent).toBe('Read-only');
    el.remove();
  });
});
