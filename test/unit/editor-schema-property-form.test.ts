// Unit spec — editor schema property form: field widgets by type/enum
//
// Feature: widget selection
//   Scenario: an enum attribute is a select
//   Scenario: a boolean attribute is a checkbox (bare spelling)
//   Scenario: a number attribute is a number input
//   Scenario: untyped attributes are text
// Feature: select options
//   Scenario: the enum lists verbatim
//   Scenario: an off-enum current value is appended "(custom)", kept visible
// Feature: field shape
//   Scenario: required and default carry through
//   Scenario: bare booleans report presence, not value
// Feature: the whole form
//   Scenario: fields follow schema order with globals last
//   Scenario: unknown authored attributes land in advanced, class never does
import { describe, expect, it } from 'vitest';

import type { AttrNode, ElementNode } from '../../src/editor/model/types.js';
import { attributeForm, fieldSpecForAttr, widgetForAttr } from '../../src/editor/schema/property-form.js';
import { getTag } from '../../src/editor/schema/load-schema.js';

let seq = 0;
function attr(name: string, value: string | null = null): AttrNode {
  seq += 1;
  return { name, value, rawValue: value, quote: value === null ? '' : '"', pre: ' ', range: { start: 0, end: 0 } };
}
function el(name: string, attrs: AttrNode[]): ElementNode {
  seq += 1;
  return {
    kind: 'element', id: `x${seq}`, parentId: null, range: { start: 0, end: 0 },
    name, attrs, children: [], selfClosing: false, preGt: '', closeTag: null,
  };
}

describe('editor schema property form', () => {
  it('selects widgets by type and enum', () => {
    const note = getTag('sem-note')!;
    const variant = note.attributes.find((a) => a.name === 'variant')!;
    const collapsed = note.attributes.find((a) => a.name === 'collapsed')!;
    expect(widgetForAttr(variant)).toBe('select');
    expect(widgetForAttr(collapsed)).toBe('checkbox');
    expect(widgetForAttr({ ...variant, allowedValues: [] })).toBe('text');
    expect(widgetForAttr({ ...variant, allowedValues: [], type: 'integer' })).toBe('number');
  });

  it('lists the enum verbatim and appends an off-enum value as (custom)', () => {
    const note = getTag('sem-note')!;
    const variant = note.attributes.find((a) => a.name === 'variant')!;
    const plain = fieldSpecForAttr(variant, { present: true, value: 'warning' });
    expect(plain.options).toEqual(['info', 'warning', 'tip', 'danger']);
    expect(plain.customValue).toBe(null);
    const custom = fieldSpecForAttr(variant, { present: true, value: 'weird' });
    expect(custom.options).toEqual(['info', 'warning', 'tip', 'danger', 'weird (custom)']);
    expect(custom.customValue).toBe('weird');
  });

  it('carries required and default through', () => {
    const facts = getTag('sem-facts')!;
    const id = facts.attributes.find((a) => a.name === 'id')!;
    const field = fieldSpecForAttr(id, { present: true, value: 'auth-facts' });
    expect(field.required).toBe(true);
    const variant = getTag('sem-note')!.attributes.find((a) => a.name === 'variant')!;
    expect(fieldSpecForAttr(variant).default).toBe('info');
  });

  it('reports bare-boolean presence, not value', () => {
    const note = getTag('sem-note')!;
    const collapsed = note.attributes.find((a) => a.name === 'collapsed')!;
    const off = fieldSpecForAttr(collapsed, { present: false, value: null });
    const on = fieldSpecForAttr(collapsed, { present: true, value: null });
    expect(off.bare).toBe(true);
    expect(off.present).toBe(false);
    expect(on.present).toBe(true);
    expect(on.current).toBe(null); // authored bare: present with null value
  });

  it('orders fields schema-first with globals last, and parks unknowns in advanced', () => {
    const form = attributeForm('sem-note', [attr('variant', 'tip'), attr('frob', '1'), attr('class', 'x')]);
    expect(form.title).toBe('Note');
    expect(form.fields[0]?.attr).toBe('variant');
    // sem-note declares id/kind/tags itself (not flagged); only the appended
    // audience carries the loader's global flag — and it comes last
    const appended = form.fields.filter((f) => f.global).map((f) => f.attr);
    expect(appended).toEqual(['audience']);
    expect(form.fields.at(-1)?.global).toBe(true);
    expect(form.advanced.map((a) => a.name)).toEqual(['frob']);
    expect(form.advanced[0]?.value).toBe('1');
  });

  it('builds a field for every schema attribute of the tag', () => {
    const form = attributeForm('sem-note');
    const note = getTag('sem-note')!;
    expect(form.fields.length).toBe(note.attributes.length);
  });

  it('returns an empty form for names outside the schema', () => {
    const form = attributeForm('div', [attr('frob', '1')]);
    expect(form.fields).toEqual([]);
    expect(form.advanced.map((a) => a.name)).toEqual(['frob']);
  });
});
