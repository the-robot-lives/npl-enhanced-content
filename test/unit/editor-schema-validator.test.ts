// Unit spec — editor schema validator: warnings, never blocks
//
// Feature: tag identity
//   Scenario: vocabulary-looking unknown tag warns
//   Scenario: plain HTML never warns
//   Scenario: class alias resolves to the element spec
// Feature: attributes
//   Scenario: unknown attribute warns
//   Scenario: missing required attribute warns (sem-facts id)
//   Scenario: off-enum value warns; on-enum passes
//   Scenario: data mirror of a canonical attribute hints the alias
//   Scenario: data mirror beside the canonical attribute passes
//   Scenario: author data-* hooks never warn
// Feature: companions
//   Scenario: companion outside its container warns; inside passes
// Feature: shape
//   Scenario: every issue is severity warning with the node it names
//   Scenario: deep walk finds issues at depth
import { describe, expect, it } from 'vitest';

import type { AttrNode, DocumentNode, EditorNode, ElementNode } from '../../src/editor/model/types.js';
import { validateElement, validateTree } from '../../src/editor/schema/validator.js';

let seq = 0;
function attr(name: string, value: string | null = null): AttrNode {
  seq += 1;
  return { name, value, rawValue: value, quote: value === null ? '' : '"', pre: ' ', range: { start: 0, end: 0 } };
}
function el(name: string, attrs: AttrNode[] = [], children: EditorNode[] = []): ElementNode {
  seq += 1;
  return {
    kind: 'element',
    id: `x${seq}`,
    parentId: null,
    range: { start: 0, end: 0 },
    name,
    attrs,
    children,
    selfClosing: false,
    preGt: '',
    closeTag: null,
  };
}
const doc = (...children: EditorNode[]): DocumentNode => ({
  kind: 'document',
  id: 'root',
  parentId: null,
  range: { start: 0, end: 0 },
  children,
});
const codes = (issues: ReturnType<typeof validateTree>) => issues.map((i) => i.code);

describe('editor schema validator', () => {
  it('warns on vocabulary-looking unknown tags', () => {
    const issues = validateElement(el('sem-nonesuch'));
    expect(codes(issues)).toEqual(['unknown-tag']);
    expect(issues[0]?.severity).toBe('warning');
  });

  it('never warns on plain HTML', () => {
    expect(validateTree(doc(el('div', [attr('class', 'wrapper')], [el('p'), el('strong')])))).toEqual([]);
  });

  it('warns on unknown attributes of a known tag', () => {
    const issues = validateElement(el('sem-note', [attr('variant', 'tip'), attr('frob', '1')]));
    expect(codes(issues)).toEqual(['unknown-attr']);
    expect(issues[0]?.attr).toBe('frob');
  });

  it('warns on a missing required attribute (sem-facts id)', () => {
    expect(codes(validateElement(el('sem-facts')))).toContain('missing-required');
    expect(validateElement(el('sem-facts', [attr('id', 'facts-1')])).map((i) => i.code)).not.toContain('missing-required');
  });

  it('warns on off-enum values and passes on-enum ones', () => {
    expect(codes(validateElement(el('sem-note', [attr('variant', 'bogus')])))).toEqual(['bad-enum-value']);
    expect(validateElement(el('sem-note', [attr('variant', 'warning')]))).toEqual([]);
    // bare attribute on an enum attr is also off-enum
    expect(codes(validateElement(el('sem-note', [attr('variant')])))).toEqual(['bad-enum-value']);
  });

  it('hints the alias when only the data mirror is authored', () => {
    const issues = validateElement(el('sem-note', [attr('data-variant', 'tip')]));
    expect(codes(issues)).toEqual(['alias-attr']);
    expect(issues[0]?.hint).toContain('author the canonical spelling');
  });

  it('passes when the canonical attribute stands beside its mirror', () => {
    expect(validateElement(el('sem-note', [attr('variant', 'tip'), attr('data-variant', 'tip')]))).toEqual([]);
  });

  it('never warns on author data-* hooks', () => {
    expect(validateElement(el('sem-note', [attr('data-track', 'view-1')]))).toEqual([]);
  });

  it('warns when a companion sits outside its container, passes inside', () => {
    const stray = doc(el('sem-note', [], [el('sem-fact')]));
    expect(codes(validateTree(stray))).toContain('stray-companion');
    const nested = doc(el('sem-facts', [attr('id', 'f')], [el('sem-fact')]));
    expect(validateTree(nested)).toEqual([]);
  });

  it('resolves the class alias to the element spec', () => {
    const aliased = el('div', [attr('class', 'sem-note'), attr('variant', 'bogus')]);
    expect(codes(validateElement(aliased))).toEqual(['bad-enum-value']);
  });

  it('finds issues deep in the tree and names their node', () => {
    const inner = el('sem-note', [attr('variant', 'nope')]);
    const issues = validateTree(doc(el('section', [], [el('div', [], [inner])]))).filter(
      (i) => i.code === 'bad-enum-value',
    );
    expect(issues.length).toBe(1);
    expect(issues[0]?.nodeId).toBe(inner.id);
  });
});
