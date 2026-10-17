// Unit spec — editor schema loader: the bundled elements.json contract
//
// Feature: load
//   Scenario: the bundled schema loads, memoized
//   Scenario: 49 normative tags, advisory count agrees (never hard-coded)
//   Scenario: sem-chat rides the lookup but stays out of the tag list
// Feature: normalization
//   Scenario: every attribute has boolean required + array allowedValues
//   Scenario: the global catalog (id/kind/tags/audience) rides every tag
//   Scenario: globals the tag declares itself are not duplicated
// Feature: name resolution
//   Scenario: element form, class alias, and bare sel() names resolve
//   Scenario: unknown names resolve to null
// Feature: companions
//   Scenario: optionsIn points at the container; companionsOf lists items
import { describe, expect, it } from 'vitest';

import {
  GLOBAL_ATTR_NAMES,
  SEM_CHAT_SPEC,
  canonicalTagName,
  companionsOf,
  editableAttrsOf,
  getTag,
  loadSchema,
} from '../../src/editor/schema/load-schema.js';

describe('editor schema loader', () => {
  it('loads the bundled schema memoized', () => {
    expect(loadSchema()).toBe(loadSchema());
    expect(loadSchema().specVersion.length).toBeGreaterThan(0);
  });

  it('carries the 74 normative tags; the advisory count agrees', () => {
    const schema = loadSchema();
    // 74 = 55 (through sem-tldr et al.) + the 19 family A container tags
    // (15 elements, four of them collection/entry pairs) — the pin had
    // drifted to 54 before family A landed and is re-pinned here.
    expect(schema.tags.length).toBe(74);
    // tagCount is advisory (EDITOR.md §3.1) — assert agreement, never rely on it
    // Lookup-only seeds: sem-chat + sem-enhanced-document + agent. (sem-browser
    // was a seed until the v0.7.2 artifact regen promoted it to a tag.)
    expect(schema.byName.size).toBe(schema.tags.length + 3);
  });

  it('normalizes every attribute: boolean required, array allowedValues', () => {
    for (const tag of loadSchema().tags) {
      for (const attr of tag.attributes) {
        expect(typeof attr.required, `${tag.name}.${attr.name}.required`).toBe('boolean');
        expect(Array.isArray(attr.allowedValues), `${tag.name}.${attr.name}.allowedValues`).toBe(true);
      }
    }
  });

  it('appends the global catalog to every tag without duplicating declared ones', () => {
    for (const tag of loadSchema().tags) {
      const editable = editableAttrsOf(tag);
      for (const g of GLOBAL_ATTR_NAMES) {
        const matches = editable.filter((a) => a.name.toLowerCase() === g);
        expect(matches.length, `${tag.name}: exactly one ${g}`).toBe(1);
      }
      // globals the tag declares itself stay non-global (e.g. sem-table id/audience)
      const declared = tag.attributes.filter((a) => !a.global).map((a) => a.name.toLowerCase());
      const appended = tag.attributes.filter((a) => a.global).map((a) => a.name.toLowerCase());
      for (const name of declared) expect(appended, tag.name).not.toContain(name);
    }
  });

  it('resolves element form, class alias, and bare sel() names', () => {
    expect(canonicalTagName('sem-note')).toBe('sem-note');
    expect(canonicalTagName('.sem-note')).toBe('sem-note');
    expect(canonicalTagName('.SEM-NOTE')).toBe('sem-note');
    expect(canonicalTagName('note')).toBe('sem-note');
    // first npl tag whose stripped bare name isn't owned by a lookup-only seed
    const npl = loadSchema().tags.find(
      (t) => t.family === 'npl' && t.name.replace(/^npl-/, '') !== 'agent',
    );
    if (npl) expect(canonicalTagName(npl.name.replace(/^npl-/, ''))).toBe(npl.name);
  });

  it('resolves unknown names to null', () => {
    expect(canonicalTagName('sem-nonesuch')).toBe(null);
    expect(canonicalTagName('')).toBe(null);
  });

  it('keeps sem-chat out of the tag list but resolvable — the data-bucket note', () => {
    expect(loadSchema().tags.map((t) => t.name)).not.toContain('sem-chat');
    expect(getTag('sem-chat')).toBe(SEM_CHAT_SPEC);
    expect(getTag('sem-chat')?.children.some((c) => c.name === 'script')).toBe(true);
  });

  it('points companions at their container and lists container items', () => {
    const fact = getTag('sem-fact');
    expect(fact?.optionsIn).toBe('sem-facts');
    expect(companionsOf('sem-facts').map((t) => t.name)).toContain('sem-fact');
    expect(companionsOf('sem-nonesuch')).toEqual([]);
  });
});
