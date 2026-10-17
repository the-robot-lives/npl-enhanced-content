// @vitest-environment happy-dom
/**
 * editor-shell-property-modal — the schema-driven Properties dialog
 * (EDITOR.md §5.4): widgets by attribute shape, warn-not-block required
 * fields, Advanced section for unknown attrs, sub-item list editing, JSON
 * payload validation, one-transaction save, cancel = no ops.
 *
 * The dialog is driven directly through `openPropertiesModal(ctx)` with the
 * fake document; `sem-editor` is imported only for its registration
 * side-effect on the tag (not needed by these tests, kept for parity).
 */

import { afterEach, describe, expect, it } from 'vitest';

import '../../src/editor/shell/sem-editor.js';
import { openPropertiesModal } from '../../src/editor/shell/property-modal.js';
import { setTemplateCompiler, type EditorContext, type SchemaProvider, type ShellDescriptor, type DescriptorProvider } from '../../src/editor/shell/context.js';
import { type FakeNode, fAttr, fEl, fText, fakeDoc } from './helpers/fake-editor-doc.js';
import type { EditorDocument } from '../../src/editor/model/types.js';

interface HostHandle {
  el: HTMLElement;
  doc: EditorDocument;
  ctx: EditorContext;
}

function sectionWith(overrides: Partial<{ attrs: FakeNode['attrs']; items: FakeNode[]; payload: FakeNode | null }> = {}): { root: FakeNode; section: FakeNode } {
  const section = fEl('n-sec', 'section', overrides.attrs ?? [fAttr('id', 'sec-1')], [
    ...(overrides.items ?? [
      fEl('n-f1', 'sem-fact', [], [fText('t-f1', 'First fact')]),
      fEl('n-f2', 'sem-fact', [], [fText('t-f2', 'Second fact')]),
    ]),
    ...(overrides.payload === null
      ? []
      : [overrides.payload ?? fEl('n-payload', 'script', [fAttr('type', 'application/json')], [fText('t-payload', '{"a":1}')])]),
  ]);
  const root = fEl('n-title', 'title', [], [fText('t-title', 'Meeting Notes')]);
  return { root, section };
}

function setup(section: FakeNode): HostHandle {
  const el = document.createElement('sem-editor');
  document.body.appendChild(el);
  const doc = fakeDoc('<sem-doc>x</sem-doc>', [section]);
  el.openDocument(doc);
  const ctx = el.ctx as EditorContext;
  ctx.select(section.id);
  ctx.schema = schema;
  return { el, doc, ctx, section };
}

afterEach(() => {
  document.body.textContent = '';
  setTemplateCompiler(null);
});

const schema: SchemaProvider = {
  schemaFor: (tag) =>
    tag === 'section'
      ? {
          tag: 'section',
          attrs: [
            { name: 'id', required: true, type: 'string', description: 'unique id' },
            { name: 'level', type: 'integer', default: '2' },
            { name: 'tone', type: 'string', allowedValues: ['quiet', 'loud'] },
            { name: 'collapsed', type: 'boolean' },
          ],
        }
      : null,
};


describe('opening', () => {
  it('returns null without an element selection', () => {
    const { el, doc, ctx } = setup(sectionWith().section);
    ctx.select(null);
    expect(openPropertiesModal(ctx)).toBeNull();
    ctx.select('t-title'); // a text node
    expect(openPropertiesModal(ctx)).toBeNull();
    el.remove();
  });

  it('renders a modal dialog titled for the tag', () => {
    const { el, doc, ctx } = setup(sectionWith().section);
    const dialog = openPropertiesModal(ctx);
    expect(dialog).not.toBeNull();
    expect(document.body.querySelector('dialog.sem-ed-modal')).not.toBeNull();
    expect(dialog?.querySelector('h2')?.textContent?.toLowerCase()).toContain('section');
    void doc;
    dialog?.close();
    el.remove();
  });
});

describe('attribute widgets', () => {
  it('text field: typing + Save applies one setAttr in one transaction', () => {
    const { section } = sectionWith({ attrs: [] });
    const { el, doc, ctx } = setup(section);
    ctx.schema = schema;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const input = dialog.querySelector<HTMLInputElement>('#sem-ed-f-id');
    expect(input).not.toBeNull();
    input!.value = 'renamed';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    const node = doc.node(section.id) as { attrs: Array<{ name: string; value: string | null }> };
    expect(node.attrs.find((a) => a.name === 'id')?.value).toBe('renamed');
    expect(doc.history().length).toBe(1);
    el.remove();
  });

  it('integer field renders a number input with the default as placeholder', () => {
    const { el, doc, ctx } = setup(sectionWith().section);
    ctx.schema = schema;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const input = dialog.querySelector<HTMLInputElement>('#sem-ed-f-level');
    expect(input?.type).toBe('number');
    expect(input?.placeholder).toBe('2');
    dialog.close();
    el.remove();
  });

  it('enum select: current off-enum value is preserved as "(custom)", custom… reveals a text box', () => {
    const { el, doc, ctx } = setup(sectionWith({ attrs: [fAttr('tone', 'weird')] }).section);
    ctx.schema = schema;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const select = dialog.querySelector<HTMLSelectElement>('#sem-ed-f-tone');
    expect(select).not.toBeNull();
    const texts = Array.from(select!.options).map((o) => o.textContent);
    expect(texts.some((t) => t === 'weird (custom)')).toBe(true);
    expect(texts.some((t) => t === 'custom…')).toBe(true);
    select!.value = '__sem-ed-custom__';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    const customBox = dialog.querySelector<HTMLInputElement>('input[placeholder="custom value"]');
    expect(customBox?.hidden).toBe(false);
    dialog.close();
    el.remove();
  });

  it('boolean checkbox: checked + Save = bare attribute (value null); unchecking removes it', () => {
    const { section } = sectionWith();
    const { el, doc, ctx } = setup(section);
    ctx.schema = schema;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const check = dialog.querySelector<HTMLInputElement>('#sem-ed-f-collapsed');
    expect(check?.type).toBe('checkbox');
    check!.checked = true;
    check!.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    let node = doc.node(section.id) as { attrs: Array<{ name: string; value: string | null }> };
    expect(node.attrs.find((a) => a.name === 'collapsed')?.value).toBeNull();

    const dialog2 = openPropertiesModal(ctx) as HTMLDialogElement;
    const check2 = dialog2.querySelector<HTMLInputElement>('#sem-ed-f-collapsed');
    expect(check2?.checked).toBe(true);
    check2!.checked = false;
    check2!.dispatchEvent(new Event('change', { bubbles: true }));
    dialog2.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    node = doc.node(section.id) as { attrs: Array<{ name: string; value: string | null }> };
    expect(node.attrs.find((a) => a.name === 'collapsed')).toBeUndefined();
    el.remove();
  });

  it('required warnings are inline and never block Save', () => {
    const { section } = sectionWith({ attrs: [] });
    const { el, doc, ctx } = setup(section);
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const warn = dialog.querySelector<HTMLElement>('label[for="sem-ed-f-id"]')?.parentElement?.querySelector('.sem-ed-field-warn');
    expect(warn?.hidden).toBe(false);
    // make a non-required change while the id warning is up, then save
    const level = dialog.querySelector<HTMLInputElement>('#sem-ed-f-level');
    level!.value = '3';
    level!.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    expect(doc.history().length).toBe(1); // save applied despite the open warning
    const node = doc.node(section.id) as { attrs: Array<{ name: string; value: string | null }> };
    expect(node.attrs.find((a) => a.name === 'level')?.value).toBe('3');
    expect(warn?.hidden).toBe(false); // the warning was advisory, not blocking
    el.remove();
  });

  it('filling a required field hides its warning', () => {
    const { section } = sectionWith({ attrs: [] });
    const { el, doc, ctx } = setup(section);
    ctx.schema = schema;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const input = dialog.querySelector<HTMLInputElement>('#sem-ed-f-id');
    input!.value = 'now-set';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    const warn = dialog.querySelector<HTMLElement>('label[for="sem-ed-f-id"]')?.parentElement?.querySelector('.sem-ed-field-warn');
    expect(warn?.hidden).toBe(true);
    void doc;
    dialog.close();
    el.remove();
  });
});

describe('advanced section (unknown attrs)', () => {
  it('lists unknown attrs and removes them on Save', () => {
    const { section } = sectionWith({ attrs: [fAttr('id', 'x'), fAttr('data-legacy', 'junk')] });
    const { el, doc, ctx } = setup(section);
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const advanced = dialog.querySelector('details.sem-ed-advanced');
    expect(advanced).not.toBeNull();
    const input = advanced?.querySelector<HTMLInputElement>('#sem-ed-adv-data-legacy');
    expect(input?.value).toBe('junk');
    advanced?.querySelector<HTMLButtonElement>('button.sem-ed-btn-danger')!.click();
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    const node = doc.node(section.id) as { attrs: Array<{ name: string }> };
    expect(node.attrs.find((a) => a.name === 'data-legacy')).toBeUndefined();
    el.remove();
  });

  it('editing an unknown attr updates it on Save', () => {
    const { section } = sectionWith({ attrs: [fAttr('data-legacy', 'junk')] });
    const { el, doc, ctx } = setup(section);
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const input = dialog.querySelector<HTMLInputElement>('#sem-ed-adv-data-legacy');
    input!.value = 'fixed';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    const node = doc.node(section.id) as { attrs: Array<{ name: string; value: string | null }> };
    expect(node.attrs.find((a) => a.name === 'data-legacy')?.value).toBe('fixed');
    el.remove();
  });
});

describe('cancel / Esc = no ops', () => {
  it('applies nothing and fires onClose(false)', () => {
    const sw = sectionWith({ attrs: [fAttr('id', 'before')] });
    const { el, doc, ctx } = setup(sw.section);
    const section = sw.section;
    let closed: boolean | undefined;
    const dialog = openPropertiesModal(ctx, { onClose: (saved) => (closed = saved) }) as HTMLDialogElement;
    const input = dialog.querySelector<HTMLInputElement>('#sem-ed-f-id');
    input!.value = 'changed';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.close(); // cancel path (returnValue stays '')
    expect(closed).toBe(false);
    expect(doc.version).toBe(0);
    expect(doc.history().length).toBe(0);
    const node = doc.node(section.id) as { attrs: Array<{ name: string; value: string | null }> };
    expect(node.attrs.find((a) => a.name === 'id')?.value).toBe('before');
    expect(document.body.querySelector('dialog.sem-ed-modal')).toBeNull();
    el.remove();
  });
});

describe('version guard', () => {
  it('refuses Save when the document changed under the dialog', () => {
    const { el, doc, ctx } = setup(sectionWith().section);
    let closed: boolean | undefined;
    const dialog = openPropertiesModal(ctx, { onClose: (saved) => (closed = saved) }) as HTMLDialogElement;
    doc.transaction('external', (tx) => {
      tx.push({ type: 'setAttr', node: 'n-sec', name: 'id', value: 'external' });
    });
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    expect(dialog.querySelector<HTMLElement>('.sem-ed-modal-summary')?.textContent).toContain('changed');
    expect(closed).toBeUndefined(); // still open, still unclosed
    expect(doc.history().length).toBe(1); // only the external one
    dialog.close();
    el.remove();
  });
});

describe('sub-item list editor', () => {
  const descriptors: DescriptorProvider = {
    descriptorFor: (tag): ShellDescriptor | null =>
      tag === 'section'
        ? {
            tag: 'section',
            title: 'Section',
            itemList: {
              childSelector: ':scope > sem-fact',
              label: 'Fact',
              template: { id: 'tpl-fact', label: 'Fact', xml: '<sem-fact><p>new</p></sem-fact>' },
            },
          }
        : null,
    all: () => [],
  };

  it('lists matching rows in document order', () => {
    const { el, doc, ctx } = setup(sectionWith().section);
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const rows = dialog.querySelectorAll('.sem-ed-item-row');
    expect(rows.length).toBe(2);
    expect(rows[0]?.textContent).toContain('First fact');
    void doc;
    dialog.close();
    el.remove();
  });

  it('reorder down + Save = ONE transaction with one moveNode', () => {
    const { section } = sectionWith();
    const { el, doc, ctx } = setup(section);
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    dialog.querySelector<HTMLButtonElement>('.sem-ed-item-row button[aria-label="Move Fact 1 down"]')!.click();
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    expect(doc.history().length).toBe(1);
    const children = doc.childrenOf(section.id) as Array<{ id: string }>;
    expect(children[0]?.id).toBe('n-f2');
    expect(children[1]?.id).toBe('n-f1');
    el.remove();
  });

  it('remove row + Save deletes the node in the same transaction discipline', () => {
    const { section } = sectionWith();
    const { el, doc, ctx } = setup(section);
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Remove Fact 1"]')!.click();
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    const children = doc.childrenOf(section.id) as Array<{ id: string }>;
    expect(children.map((c) => c.id)).toEqual(['n-f2', 'n-payload']);
    el.remove();
  });

  it('Add row + Save inserts the compiled template (compiler wired)', () => {
    setTemplateCompiler((xml, doc) =>
      doc.createElement({ tag: 'sem-fact', children: [doc.createText('compiled')] }),
    );
    const { section } = sectionWith();
    const { el, doc, ctx } = setup(section);
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const add = dialog.querySelector<HTMLButtonElement>('button.sem-ed-btn-add');
    expect(add?.disabled).toBe(false);
    add!.click();
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    const children = doc.childrenOf(section.id) as Array<{ id: string; name: string }>;
    expect(children.length).toBe(4); // fact, fact, compiled, payload
    expect(children[2]?.name).toBe('sem-fact');
    expect(doc.textOf(children[2]!.id)).toBe('compiled');
    el.remove();
  });

  it('Add is disabled with an explanation when no compiler is wired', () => {
    const { el, doc, ctx } = setup(sectionWith().section);
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const add = dialog.querySelector<HTMLButtonElement>('button.sem-ed-btn-add');
    expect(add?.disabled).toBe(true);
    expect(add?.title).toContain('No template compiler');
    void doc;
    dialog.close();
    el.remove();
  });
});

describe('JSON payload editor', () => {
  const descriptors: DescriptorProvider = {
    descriptorFor: (tag): ShellDescriptor | null =>
      tag === 'section'
        ? { tag: 'section', title: 'Section', jsonItems: { selector: ':scope > script[type="application/json"]', label: 'Payload', schemaHint: 'object' } }
        : null,
    all: () => [],
  };

  it('loads the payload text; live-invalid JSON shows an error and Save leaves it unchanged', () => {
    const { section } = sectionWith();
    const { el, doc, ctx } = setup(section);
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const area = dialog.querySelector<HTMLTextAreaElement>('textarea.sem-ed-json');
    expect(area?.value).toBe('{"a":1}');
    area!.value = '{not json';
    area!.dispatchEvent(new Event('input', { bubbles: true }));
    const err = dialog.querySelector<HTMLElement>('textarea.sem-ed-json ~ .sem-ed-field-warn');
    expect(err?.hidden).toBe(false);
    expect(err?.textContent).toContain('Invalid JSON');
    const versionBefore = doc.version;
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    expect(doc.version).toBe(versionBefore); // invalid payload blocked the save
    dialog.close();
    el.remove();
  });

  it('valid JSON edit + Save = one setText on the payload raw text node', () => {
    const { section } = sectionWith();
    const { el, doc, ctx } = setup(section);
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const area = dialog.querySelector<HTMLTextAreaElement>('textarea.sem-ed-json');
    area!.value = '{"a":2,"b":[1,2]}';
    area!.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    expect(doc.history().length).toBe(1);
    expect(doc.textOf('t-payload')).toBe('{"a":2,"b":[1,2]}');
    el.remove();
  });

  it('creates the payload node when the element has none', () => {
    const sw = sectionWith({ payload: null });
    const { el, doc, ctx } = setup(sw.section);
    const section = sw.section;
    ctx.descriptorView = descriptors;
    const dialog = openPropertiesModal(ctx) as HTMLDialogElement;
    const area = dialog.querySelector<HTMLTextAreaElement>('textarea.sem-ed-json');
    expect(area?.value).toBe('');
    area!.value = '{"fresh":true}';
    area!.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('.sem-ed-btn-primary')!.click();
    const children = doc.childrenOf(section.id) as Array<{ name: string }>;
    const script = children.find((c) => c.name === 'script');
    expect(script).toBeDefined();
    expect(doc.textOf((script as unknown as { id: string }).id)).toBe('{"fresh":true}');
    el.remove();
  });
});
