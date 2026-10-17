// Unit spec — edit descriptors: pilots, coverage, selector + template rules
//
// Feature: pilots (schema lane)
//   Scenario: sem-note declares both body forms as text slots
//   Scenario: sem-facts item list targets the fact children
//   Scenario: sem-table targets rows and carries the rerender seam
// Feature: coverage (EDITOR.md §3.2)
//   Scenario: every schema tag + sem-chat resolves a descriptor
//   Scenario: pilot descriptors are hand-written, not fallbacks
//   Scenario: fallbacks are cached and shaped attributes-only
// Feature: selector rule
//   Scenario: slot and item-list selectors start with ":scope >"
// Feature: templates
//   Scenario: every template parses (model parser when landed, else a
//             structural tag-balance check)
//   Scenario: stops start at 1 and use the ${n:…} / ${n|a,b} grammar
import { describe, expect, it } from 'vitest';

import { getTag, loadSchema } from '../../src/editor/schema/load-schema.js';
import {
  getDescriptor,
  hasHandDescriptor,
  handDescriptors,
  resetDescriptorsForTests,
} from '../../src/editor/schema/registry.js';
import type { EditDescriptor } from '../../src/editor/schema/types.js';

// pilots register by side effect on import
import '../../src/lit/sem-note.edit.js';
import '../../src/lit/sem-facts.edit.js';
import '../../src/lit/sem-table.edit.js';

// The model parser may not have landed when this lane's tests run; validate
// templates with it when available, else fall back to a structural check.
type ModelParse = { ok?: boolean; issues?: { severity: string }[] };
let modelParse: ((src: string) => ModelParse) | null = null;
try {
  const spec = '../../src/editor/model/parse.js';
  const mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  const fn = (mod.tryParse ?? mod.parse ?? mod.parseSource) as ((src: string) => ModelParse) | undefined;
  if (typeof fn === 'function') modelParse = fn;
} catch {
  // model lane has not landed parse.js yet — structural check covers us
}

function tagBalance(src: string): boolean {
  const stack: string[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) return false;
      i = end + 3;
      continue;
    }
    if (src.startsWith('</', lt)) {
      const gt = src.indexOf('>', lt);
      if (gt < 0) return false;
      const name = src.slice(lt + 2, gt).trim().toLowerCase();
      if (stack.pop() !== name) return false;
      i = gt + 1;
      continue;
    }
    // find the real '>' skipping quoted attribute values
    let gt = lt + 1;
    let quote = '';
    while (gt < src.length) {
      const ch = src[gt]!;
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      gt += 1;
    }
    if (quote || src[gt] !== '>') return false;
    const body = src.slice(lt + 1, gt);
    const name = body.split(/\s/)[0]?.toLowerCase() ?? '';
    if (!/^[a-z][a-z0-9-]*$/.test(name)) return false;
    if (!body.endsWith('/')) stack.push(name);
    i = gt + 1;
  }
  return stack.length === 0;
}

function templateParses(xml: string): boolean {
  if (modelParse) {
    const out = modelParse(xml);
    if (typeof out.ok === 'boolean') return out.ok;
    return !(out.issues ?? []).some((i) => i.severity === 'error');
  }
  return tagBalance(xml);
}

function firstStop(xml: string): string | null {
  return /\$\{(\d+)/.exec(xml)?.[1] ?? null;
}

const textStop = /^\$\{\d+:[^{}]*\}$/;
const choiceStop = /^\$\{\d+\|[^{}]*\}$/;

describe('edit descriptors — pilots', () => {
  it('sem-note declares both body forms as text slots', () => {
    const d = getDescriptor('sem-note')!;
    expect(hasHandDescriptor('sem-note')).toBe(true);
    expect(d.bucket).toBe('prose');
    expect(d.textSlots?.length).toBe(2);
    expect(d.textSlots?.some((s) => s.selector === ':scope > .sem-note-body')).toBe(true);
    expect(d.textSlots?.every((s) => s.escape === 'entities')).toBe(true);
  });

  it('sem-facts item list targets the fact children', () => {
    const d = getDescriptor('sem-facts')!;
    expect(d.bucket).toBe('data');
    expect(d.itemList?.childSelector).toBe(':scope > :is(sem-fact, .sem-fact)');
    expect(d.itemList?.template.xml).toContain('<statement>');
  });

  it('sem-table targets rows and carries the rerender seam', () => {
    const d = getDescriptor('sem-table')!;
    expect(d.bucket).toBe('data');
    expect(d.itemList?.childSelector).toBe(':scope > table > tbody > tr');
    expect(typeof d.rerender).toBe('function');
    expect(d.linkFields?.some((l) => l.attr === 'data-value')).toBe(true);
  });
});

describe('edit descriptors — coverage', () => {
  it('resolves a descriptor for every schema tag plus sem-chat', () => {
    const tags = [...loadSchema().tags.map((t) => t.name), 'sem-chat'];
    // Derived: every tag in elements.json (grows with the vocabulary —
    // the round-2 reference defs joined at v0.7.3, sem-tldr at v0.8.2)
    // + the editor-only sem-chat stub. Never re-pinned by hand.
    expect(tags.length).toBe(loadSchema().tags.length + 1);
    for (const name of tags) {
      const d = getDescriptor(name);
      expect(d, name).not.toBe(null);
      expect(d!.title.length, name).toBeGreaterThan(0);
      expect(d!.tag.toLowerCase(), name).toBe(name.toLowerCase());
    }
  });

  it('registers exactly the pilot set as hand descriptors (so far)', () => {
    const hand = handDescriptors().map((d) => d.tag).sort();
    expect(hand).toEqual(['sem-facts', 'sem-note', 'sem-table']);
  });

  it('caches fallbacks and shapes them attributes-only', () => {
    const a = getDescriptor('sem-chronology')!;
    const b = getDescriptor('sem-chronology')!;
    expect(a).toBe(b); // cached
    expect(hasHandDescriptor('sem-chronology')).toBe(false);
    expect(a.textSlots).toBeUndefined();
    expect(a.itemList).toBeUndefined();
    expect(a.templates?.length).toBe(1);
    expect(a.templates?.[0]?.xml.startsWith('<sem-chronology>')).toBe(true);
  });
});

describe('edit descriptors — selector rule', () => {
  it('anchors slot and item-list selectors at :scope children', () => {
    for (const d of handDescriptors() as EditDescriptor[]) {
      for (const slot of d.textSlots ?? []) {
        expect(slot.selector.startsWith(':scope >'), `${d.tag} slot ${slot.selector}`).toBe(true);
      }
      if (d.itemList) {
        expect(d.itemList.childSelector.startsWith(':scope >'), d.tag).toBe(true);
      }
    }
  });
});

describe('edit descriptors — templates', () => {
  it('every template of every descriptor parses', () => {
    const tags = [...loadSchema().tags.map((t) => t.name), 'sem-chat'];
    let checked = 0;
    for (const name of tags) {
      const d = getDescriptor(name)!;
      for (const template of d.templates ?? []) {
        expect(templateParses(template.xml), `${name}/${template.id}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20); // 3 pilots + one per fallback tag
  });

  it('stops start at 1 and use the ${n:…}/${n|a,b} grammar', () => {
    const tags = [...loadSchema().tags.map((t) => t.name), 'sem-chat'];
    for (const name of tags) {
      const d = getDescriptor(name)!;
      for (const template of d.templates ?? []) {
        if (!template.xml.includes('${')) continue;
        expect(firstStop(template.xml), `${name}/${template.id} first stop`).toBe('1');
        // every stop opens with the stop index; text stops are `${n:…}`,
        // choice stops `${n|a,b}`
        for (const stop of template.xml.match(/\$\{\d+[^}]*\}/g) ?? []) {
          expect(textStop.test(stop) || choiceStop.test(stop), `${name}/${template.id} stop "${stop}"`).toBe(true);
        }
      }
    }
  });
});

describe('edit descriptors — registry isolation', () => {
  it('reset clears hand descriptors; fallbacks keep every tag editable', () => {
    resetDescriptorsForTests();
    expect(hasHandDescriptor('sem-note')).toBe(false);
    const d = getDescriptor('sem-note')!;
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.textSlots).toBeUndefined();
  });
});
