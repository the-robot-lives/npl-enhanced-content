// @vitest-environment happy-dom
// Unit spec — the insert lane's surfaces (EDITOR.md §5.5): the block panel,
// the generic wizard stepper, the `/` command, the `+` zones, and the wire
// (shell hooks + the sem-edit-insert-request consumer).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import '../../src/lit/sem-note.js';
import '../../src/lit/sem-note.edit.js';
import { SemNote } from '../../src/lit/sem-note.js';
import { attachEditor, bindingFor, createContext } from '../../src/editor/controller/attach.js';
import type { EditorContext, ElementBinding } from '../../src/editor/controller/types.js';
import type { EditorDocument, NodeId } from '../../src/editor/model/types.js';
import { createDocument } from '../../src/editor/model/document.js';
import { registerDescriptor } from '../../src/editor/schema/index.js';
import type { WizardField } from '../../src/editor/schema/types.js';
import { createInsertShellHooks, wireInsert } from '../../src/editor/insert/wire.js';
import { openInsertPanel } from '../../src/editor/insert/panel.js';
import { openWizard } from '../../src/editor/insert/wizard.js';
import { attachPlusZones } from '../../src/editor/insert/plus.js';
import { attachSlashCommand, resolveSlashTarget } from '../../src/editor/insert/slash.js';
import { insertEntryAt } from '../../src/editor/insert/apply.js';
import { compileSnippet } from '../../src/editor/insert/compile.js';
import type { InsertEntry, InsertTarget } from '../../src/editor/insert/types.js';

const SOURCE = '<sem-facts><sem-fact>One</sem-fact></sem-facts><sem-note><span class="sem-note-body">Hello</span></sem-note>';
const NOTE = '<sem-note variant="info"><span class="sem-note-body">Hello</span></sem-note>';

// Registered at module top level — BEFORE the first insertCatalog() call —
// because the catalog memoizes (last-wins registration must precede it).
// sem-fact is a REAL schema tag, so placement still admits it (only inside
// sem-facts), which is what the wizard-handoff test needs.
registerDescriptor({
  tag: 'sem-fact',
  title: 'Fact',
  bucket: 'data',
  summary: 'wizard fixture',
  templates: [{ id: 'f', label: 'f', xml: '<sem-fact>x</sem-fact>' }],
  wizard: { steps: [{ title: 'S', fields: [], template: { id: 's', label: 's', xml: '<sem-fact>x</sem-fact>' } }] },
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

function setup(): {
  doc: EditorDocument; ctx: EditorContext; rootId: NodeId; factsId: NodeId; noteId: NodeId;
  announced: string[];
} {
  const doc = createDocument(SOURCE);
  const announced: string[] = [];
  const ctx = createContext({ doc, announce: (m) => announced.push(m) });
  const element = (tag: string): ElementNode =>
    doc.root.children.find((n) => n.kind === 'element' && n.name === tag) as ElementNode;
  return {
    doc, ctx, announced,
    rootId: doc.root.id,
    factsId: element('sem-facts').id,
    noteId: element('sem-note').id,
  };
}

function makeBound(markup = NOTE): { el: SemNote; ctx: EditorContext; binding: ElementBinding } {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup;
  const el = wrap.firstElementChild as SemNote;
  document.body.appendChild(el);
  const ctx = createContext({ doc: createDocument(SOURCE) });
  const c = attachEditor(el, ctx);
  if (c === null) throw new Error('attach failed');
  const binding = bindingFor(el);
  if (binding === undefined) throw new Error('no binding');
  return { el, ctx, binding };
}

const entry = (over: Partial<InsertEntry> = {}): InsertEntry => ({
  tag: 'sem-note',
  title: 'Note',
  summary: 'test fixture',
  bucket: 'prose',
  template: { id: 't', label: 't', xml: '<sem-note><span class="sem-note-body">fresh</span></sem-note>' },
  wizard: null,
  ...over,
});

// ── panel ───────────────────────────────────────────────────────────────────

describe('openInsertPanel', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.querySelectorAll('dialog').forEach((d) => d.remove()); });

  it('refuses an empty placement: announce + onCancel, no dialog', () => {
    const { ctx, noteId, announced } = setup();
    let cancelled = 0;
    const dialog = openInsertPanel(ctx, { parentId: noteId, index: 0 }, { onCancel: () => cancelled++ });
    expect(dialog).toBeNull();
    expect(announced[0]).toContain('No blocks');
    expect(cancelled).toBe(1);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('renders grouped tiles as text, filters them, closes on pick with ONE insert', () => {
    const { doc, ctx, rootId, announced } = setup();
    const dialog = openInsertPanel(ctx, { parentId: rootId, index: 1 });
    expect(dialog).not.toBeNull();
    expect(document.querySelectorAll('.sem-ed-ins-group').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.sem-ed-ins-tile').length).toBeGreaterThan(10);
    // textContent only — no tile ever got innerHTML from schema data
    expect(dialog!.querySelector('.sem-ed-ins-tile')!.innerHTML).not.toContain('<sem-');

    const search = dialog!.querySelector<HTMLInputElement>('.sem-ed-input')!;
    search.value = 'chronology';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const tiles = dialog!.querySelectorAll('.sem-ed-ins-tile:not([hidden])');
    expect(tiles).toHaveLength(1);
    expect(tiles[0].textContent).toContain('sem-chronology');

    (tiles[0] as HTMLButtonElement).click();
    expect(doc.childrenOf(rootId)).toHaveLength(3);
    expect(doc.childrenOf(rootId)[1]?.name).toBe('sem-chronology');
    expect(announced.some((m) => m.startsWith('Inserted'))).toBe(true);
    expect(dialog!.dataset.semEdResult).toBe('insert');
    expect(document.querySelector('dialog')).toBeNull(); // closed + removed
  });

  it('no-match query shows the empty state', () => {
    const { ctx, rootId } = setup();
    const dialog = openInsertPanel(ctx, { parentId: rootId, index: 0 })!;
    const search = dialog.querySelector<HTMLInputElement>('.sem-ed-input')!;
    search.value = 'qqq-nope';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(dialog.querySelector('.sem-ed-ins-empty')?.textContent).toContain('No blocks match');
    expect(dialog.querySelector('.sem-ed-ins-tile')).toBeNull();
  });

  it('a pick after the document moved is refused (panel stays open)', () => {
    const { doc, ctx, rootId } = setup();
    const dialog = openInsertPanel(ctx, { parentId: rootId, index: 0 })!;
    // move the tree under the panel with a lane-external insert (fresh ids)
    const node = compileSnippet('<sem-note><span class="sem-note-body">x</span></sem-note>', doc)!;
    doc.apply({ type: 'insertNode', parent: rootId, index: 0, node });
    const tile = dialog.querySelector<HTMLButtonElement>('.sem-ed-ins-tile')!;
    tile.click();
    expect(dialog.querySelector('.sem-ed-ins-hint')?.textContent).toContain('changed while this panel was open');
    expect(document.querySelector('dialog')).not.toBeNull(); // still open
  });

  it('Esc (close without returnValue) fires onCancel and restores focus', () => {
    const { ctx, rootId } = setup();
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    let cancelled = 0;
    const dialog = openInsertPanel(ctx, { parentId: rootId, index: 0 }, { onCancel: () => cancelled++ })!;
    dialog.close(); // no returnValue set → cancel path
    expect(cancelled).toBe(1);
    expect(document.activeElement).toBe(before);
  });

  it('a wizard entry hands off to the stepper instead of inserting', () => {
    const { ctx, factsId } = setup();
    const dialog = openInsertPanel(ctx, { parentId: factsId, index: 0 })!;
    const tile = dialog.querySelector<HTMLButtonElement>('.sem-ed-ins-tile')!;
    expect(tile.textContent).toContain('…'); // wizard tiles promise more steps
    tile.click();
    expect(document.querySelector('dialog.sem-ed-ins-wizard')).not.toBeNull();
  });
});

// ── wizard ──────────────────────────────────────────────────────────────────

// POSITIONAL convention: fields across ALL steps, in order (caption, href,
// body, level, collapsed) ↔ the final template's stops 1..5. Placeholder
// text is a human label, not a key.
const WIZ_TEMPLATE =
  '<sem-note caption="${2:Link}" level="${4|info,warn|}" collapsed="${5:toggle}">${1:Caption} ${3:Body}</sem-note>';

function wizardEntry(): InsertEntry {
  const f = (name: string, label: string, over: Partial<WizardField> = {}): WizardField => ({
    name, label, type: 'text', ...over,
  });
  return entry({
    tag: 'sem-note',
    title: 'Wiz Note',
    wizard: {
      steps: [
        {
          title: 'Basics',
          fields: [f('caption', 'Caption', { required: true }), f('href', 'Link', { type: 'url' })],
          template: { id: 's1', label: 's1', xml: '<sem-note caption="${1:caption}"></sem-note>' },
        },
        {
          title: 'Options',
          fields: [
            f('body', 'Body', { type: 'textarea', required: true }),
            f('level', 'Level', { type: 'select', options: ['info', 'warn'] }),
            f('collapsed', 'Collapsed', { type: 'boolean' }),
          ],
          template: { id: 's2', label: 's2', xml: WIZ_TEMPLATE },
        },
      ],
    },
  });
}

function field(dialog: HTMLDialogElement, name: string): HTMLInputElement {
  return dialog.querySelector<HTMLInputElement>(`#sem-ed-w-${name}`)!;
}
const setInput = (el: HTMLInputElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('openWizard (the generic stepper)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.querySelectorAll('dialog').forEach((d) => d.remove()); });

  it('validates per step: required + unsafe URL block Next, problems are announced', () => {
    const { doc, ctx, rootId, announced } = setup();
    const dialog = openWizard(ctx, wizardEntry(), { parentId: rootId, index: 2 })!;
    setInput(field(dialog, 'href'), 'javascript:alert(1)');
    (dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!).click();
    const status = dialog.querySelector('.sem-ed-modal-summary')!;
    expect(status.textContent).toContain('Caption is required');
    expect(status.textContent).toContain('Link');
    expect(dialog.querySelector('.sem-ed-ins-steps')?.textContent).toContain('Step 1 of 2');
    expect(announced.some((m) => m.includes('required'))).toBe(true);
    expect(doc.root.children).toHaveLength(2);
  });

  it('values persist across Back; Finish interpolates the final template in ONE op', () => {
    const { doc, ctx, rootId, announced } = setup();
    const version = doc.version;
    const dialog = openWizard(ctx, wizardEntry(), { parentId: rootId, index: 2 })!;
    const next = dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!;

    setInput(field(dialog, 'caption'), 'He said "hi" <b>');
    setInput(field(dialog, 'href'), 'https://example.com/a?b=1');
    next.click();
    expect(dialog.querySelector('.sem-ed-ins-steps')?.textContent).toContain('Step 2 of 2');

    setInput(field(dialog, 'body'), 'wizard body text');
    const level = dialog.querySelector<HTMLSelectElement>('#sem-ed-w-level')!;
    level.value = 'warn';
    level.dispatchEvent(new Event('change', { bubbles: true }));
    const collapsed = field(dialog, 'collapsed');
    collapsed.checked = true;
    collapsed.dispatchEvent(new Event('change', { bubbles: true }));

    const back = dialog.querySelectorAll<HTMLButtonElement>('.sem-ed-modal-actions .sem-ed-btn')[1]!;
    back.click();
    expect(field(dialog, 'caption').value).toBe('He said "hi" <b>'); // draft survives Back
    next.click();
    expect(dialog.querySelector('.sem-ed-ins-steps')?.textContent).toContain('Step 2 of 2');

    next.click(); // Finish
    expect(dialog.dataset.semEdResult).toBe('insert');
    expect(doc.childrenOf(rootId)).toHaveLength(3);
    expect(doc.version).toBe(version + 1); // one transaction
    const node = doc.childrenOf(rootId)[2]!;
    expect(node.kind).toBe('element');
    const attrs = (node as { attrs: { name: string; value: string | null }[] }).attrs;
    expect(attrs.find((a) => a.name === 'collapsed')).toBeDefined(); // boolean → bare attr
    expect(attrs.find((a) => a.name === 'caption')?.value).toBe('https://example.com/a?b=1'); // href ↔ stop 2
    expect(attrs.find((a) => a.name === 'level')?.value).toBe('warn'); // choice stop takes the select value
    expect(doc.textOf(node.id)).toBe('He said "hi" <b> wizard body text'); // decoded, not escaped
    expect(announced.some((m) => m.includes('via wizard'))).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('Finish re-validates EVERY step and routes back to the failing one', () => {
    const { doc, ctx, rootId } = setup();
    let cancelled = 0;
    const dialog = openWizard(ctx, wizardEntry(), { parentId: rootId, index: 2 }, { onCancel: () => cancelled++ })!;
    const buttons = dialog.querySelectorAll<HTMLButtonElement>('.sem-ed-modal-actions .sem-ed-btn');
    const back = buttons[1]!;
    const next = dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!;

    setInput(field(dialog, 'caption'), 'ok');
    setInput(field(dialog, 'href'), 'https://example.com');
    next.click(); // → step 2
    back.click(); // → step 1 (draft intact)
    setInput(field(dialog, 'caption'), ''); // invalidate step 1 retroactively
    next.click(); // → step 2
    next.click(); // Finish → step 1 must fail re-validation
    expect(dialog.querySelector('.sem-ed-ins-steps')?.textContent).toContain('Step 1 of 2');
    expect(dialog.querySelector('.sem-ed-modal-summary')?.textContent).toContain('Caption is required');
    expect(doc.root.children).toHaveLength(2);
    dialog.close();
    expect(cancelled).toBe(1);
  });

  it('a value containing stop grammar is inserted literally', () => {
    const { doc, ctx, rootId } = setup();
    const one = entry({
      wizard: { steps: [{ title: 'S', fields: [{ name: 'caption', label: 'C', type: 'text' }], template: { id: 't', label: 't', xml: '<sem-note><span class="sem-note-body">${1:caption}</span></sem-note>' } }] },
    });
    const dialog = openWizard(ctx, one, { parentId: rootId, index: 2 })!;
    setInput(field(dialog, 'caption'), '${2|evil|}');
    (dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!).click();
    const node = doc.childrenOf(rootId)[2]!;
    expect(doc.textOf(node.id)).toBe('${2|evil|}');
  });
});

// ── plus zones ──────────────────────────────────────────────────────────────

describe('attachPlusZones', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('stamps n+1 chrome zones, opens the panel at the right boundary, restamps, detaches', async () => {
    const { doc, ctx, rootId } = setup();
    const container = document.createElement('div');
    container.innerHTML = '<p>one</p><p>two</p>';
    document.body.appendChild(container);
    const opened: InsertTarget[] = [];
    const detach = attachPlusZones({ container, ctx, openPanel: (t) => opened.push(t) });

    const zones = container.querySelectorAll('.sem-ed-ins-plus-zone');
    expect(zones).toHaveLength(3);
    expect(container.querySelectorAll('[data-sem-chrome]')).toHaveLength(3);

    (zones[1].querySelector('button') as HTMLButtonElement).click();
    expect(opened).toEqual([{ parentId: rootId, index: 1 }]);
    expect(zones[1].querySelector('button')?.getAttribute('aria-label')).toBe('Insert block between position 1 and 2');

    // foreign child added → restamped (4 boundaries); chrome-only churn is not
    container.appendChild(document.createElement('p'));
    await tick();
    expect(container.querySelectorAll('.sem-ed-ins-plus-zone')).toHaveLength(4);
    const chrome = document.createElement('div');
    chrome.setAttribute('data-sem-chrome', '');
    container.insertBefore(chrome, container.firstChild);
    await tick();
    expect(container.querySelectorAll('.sem-ed-ins-plus-zone')).toHaveLength(4);

    detach();
    expect(container.querySelectorAll('.sem-ed-ins-plus-zone')).toHaveLength(0);
    void doc;
  });
});

// ── slash ───────────────────────────────────────────────────────────────────

function slashSetup(): ReturnType<typeof setup> & { canvas: HTMLDivElement; slot: HTMLElement } {
  const base = setup();
  const canvas = document.createElement('div');
  canvas.className = 'sem-editor-canvas';
  document.body.appendChild(canvas);
  const host = document.createElement('sem-note');
  host.innerHTML = NOTE;
  canvas.appendChild(host);
  attachEditor(host as SemNote, base.ctx);
  const slot = document.createElement('div');
  slot.setAttribute('contenteditable', 'true');
  host.appendChild(slot);
  return { ...base, canvas, slot };
}

describe('the slash command', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('a "/" in an empty slot opens the menu; a pick inserts after the host', () => {
    const { doc, ctx, rootId, canvas, slot } = slashSetup();
    const detach = attachSlashCommand({ root: canvas, ctx });
    slot.textContent = '/';
    slot.dispatchEvent(new Event('input', { bubbles: true }));
    const menu = document.querySelector('.sem-ed-ins-menu');
    expect(menu).not.toBeNull();
    expect(slot.textContent).toBe(''); // trigger consumed
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Filter blocks');

    const items = menu!.querySelectorAll('.sem-ed-ins-menu-item');
    expect(items.length).toBeGreaterThan(10); // root-level placement
    (items[0] as HTMLButtonElement).click();
    expect(doc.childrenOf(rootId)).toHaveLength(3); // one op landed
    expect(document.querySelector('.sem-ed-ins-menu')).toBeNull();
    detach();
  });

  it('a "/" with preceding text is literal (no menu)', () => {
    const { ctx, canvas, slot } = slashSetup();
    const detach = attachSlashCommand({ root: canvas, ctx });
    slot.textContent = 'a/';
    slot.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.sem-ed-ins-menu')).toBeNull();
    expect(slot.textContent).toBe('a/');
    detach();
  });

  it('Esc dismisses and restores the literal "/" with the caret after it', () => {
    const { ctx, canvas, slot } = slashSetup();
    const detach = attachSlashCommand({ root: canvas, ctx });
    slot.textContent = '/';
    slot.dispatchEvent(new Event('input', { bubbles: true }));
    const filter = document.querySelector<HTMLInputElement>('.sem-ed-ins-menu input')!;
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.sem-ed-ins-menu')).toBeNull();
    expect(slot.textContent).toBe('/');
    detach();
  });

  it('resolveSlashTarget walks up to the first level that accepts blocks', () => {
    const { ctx, slot } = slashSetup();
    const target = resolveSlashTarget(ctx, slot);
    expect(target).not.toBeNull();
    expect(target!.parentId).toBe(ctx.doc.root.id);
    expect(target!.index).toBe(2); // after the bound host (3rd boundary)
  });

  it('a pick through insertEntryAt lands via the resolved target', () => {
    const { doc, ctx, slot } = slashSetup();
    const target = resolveSlashTarget(ctx, slot)!;
    insertEntryAt(ctx, entry(), target);
    const names = doc.childrenOf(ctx.doc.root.id).map((n) => (n as { name?: string }).name);
    expect(names[names.length - 1]).toBe('sem-note');
  });
});

// ── wire ────────────────────────────────────────────────────────────────────

describe('createInsertShellHooks / wireInsert', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.querySelectorAll('dialog').forEach((d) => d.remove()); });

  it('openInserter maps before/after to the parent list around the element', () => {
    const { ctx } = setup();
    const { binding } = makeBound();
    const hooks = createInsertShellHooks({ ctx });
    hooks.openInserter!(binding, 'before');
    let dialog = document.querySelector('dialog.sem-ed-ins-panel');
    expect(dialog).not.toBeNull();
    dialog!.close();
    hooks.openInserter!(binding, 'after');
    dialog = document.querySelector('dialog.sem-ed-ins-panel');
    expect(dialog).not.toBeNull();
    dialog!.close();
  });

  it('sem-edit-insert-request opens the panel; detach stops it', () => {
    const { ctx, rootId } = setup();
    const detach = wireInsert({ ctx });
    document.dispatchEvent(new CustomEvent('sem-edit-insert-request', { detail: { parent: rootId, index: 1 } }));
    expect(document.querySelector('dialog.sem-ed-ins-panel')).not.toBeNull();
    document.querySelector('dialog')!.close();
    detach();
    document.dispatchEvent(new CustomEvent('sem-edit-insert-request', { detail: { parent: rootId, index: 0 } }));
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('a stale parent id announces instead of opening', () => {
    const { ctx, announced } = setup();
    const detach = wireInsert({ ctx });
    document.dispatchEvent(new CustomEvent('sem-edit-insert-request', { detail: { parent: 'n9999' as NodeId, index: 0 } }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(announced[0]).toContain('no longer valid');
    detach();
  });
});
