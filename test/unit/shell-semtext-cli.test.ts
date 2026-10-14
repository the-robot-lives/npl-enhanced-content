// @vitest-environment happy-dom
// Unit spec — the SemText document operations (src/shell/semtext-cli.ts)
//
// Feature: formatDoc matches the package's own normative extraction contract
//   Scenario: text is the annotated plain-text reference recipe (extractText)
//   Scenario: json is the canonical SemRecord[] (extractRecords)
//   Scenario: an unknown format throws
// Feature: filterDoc selects by element type and/or text
//   Scenario: by type, every match in document order, as outerHTML
//   Scenario: by text, only MINIMAL matches (no ancestor noise)
//   Scenario: type + text intersect; no matches is the empty string
//   Scenario: no criteria throws
// Feature: outlineDoc is the document skeleton
//   Scenario: headings at their own depth, blocks one under the last heading
//   Scenario: a structural block swallows nested structural blocks

import { describe, it, expect } from 'vitest';
import { filterDoc, formatDoc, outlineDoc } from '../../src/shell/semtext-cli.js';
import quiz from '../../src/terminal/plugins/demo/files/quiz.html?raw';
import tokenRotation from '../../src/terminal/plugins/demo/files/token-rotation.html?raw';

const NOTE_DOC = `
<sem-enhanced-document>
  <h1>Doc</h1>
  <sem-note variant="tip">Rotation in five lines.</sem-note>
  <sem-note variant="warning">Rotate the signing key too.</sem-note>
</sem-enhanced-document>`;

describe('formatDoc', () => {
  it('text is the annotated plain-text reference recipe', () => {
    const text = formatDoc(quiz, 'text');
    expect(text).toContain('sem-progress: coverage :: 70%');
    expect(text).toContain('Tokens rotate on every exchange :: Reuse retires the presented token');
    expect(text).toContain('incorrectStatements: Static tokens are safer');
  });

  it('json is the canonical SemRecord[]', () => {
    const records = JSON.parse(formatDoc(quiz, 'json'));
    expect(Array.isArray(records)).toBe(true);
    const fact = records.find((r) => r.type === 'sem-fact');
    expect(fact.fields.statement).toBe('Tokens rotate on every exchange');
    expect(fact.fields.conclusion).toBe('Reuse retires the presented token');
    expect(records.some((r) => r.type === 'sem-table' || r.type === 'sem-progress')).toBe(true);
  });

  it('an unknown format throws', () => {
    expect(() => formatDoc(NOTE_DOC, 'html' as 'text')).toThrow(/unknown format/);
  });
});

describe('filterDoc', () => {
  it('by type: every match, in document order, as outerHTML', () => {
    const result = filterDoc(NOTE_DOC, { type: 'sem-note' });
    expect(result).toContain('<sem-note variant="tip">');
    expect(result).toContain('<sem-note variant="warning">');
    expect(result.indexOf('tip')).toBeLessThan(result.indexOf('warning'));
  });

  it('by text: only minimal matches — the carrier, not its ancestors', () => {
    const result = filterDoc(tokenRotation, { text: 'Proof Key for Code Exchange' });
    expect(result).toContain('key="PKCE"');
    expect(result).not.toContain('<sem-properties');
    expect(result).not.toContain('<sem-enhanced-document');
  });

  it('type + text intersect', () => {
    const result = filterDoc(tokenRotation, { type: 'sem-property', text: 'Proof Key' });
    expect(result).toContain('key="PKCE"');
    expect(result).not.toContain('key="JWT"');
  });

  it('no matches is the empty string; no criteria throws', () => {
    expect(filterDoc(NOTE_DOC, { type: 'sem-table' })).toBe('');
    expect(() => filterDoc(NOTE_DOC, {})).toThrow(/--type/);
    expect(() => filterDoc(NOTE_DOC, { type: 'not a tag!' })).toThrow(/invalid element type/);
  });
});

describe('outlineDoc', () => {
  it('headings at their own depth, blocks one under the last heading', () => {
    const entries = outlineDoc(tokenRotation);
    expect(entries[0]).toEqual({ tag: 'h1', label: 'Token Rotation', depth: 1 });
    expect(entries.some((e) => e.tag === 'sem-properties' && e.label === 'glossary' && e.depth === 2)).toBe(true);
    expect(entries.some((e) => e.tag === 'h2' && e.label === 'Rotation' && e.depth === 2)).toBe(true);
    expect(entries.some((e) => e.tag === 'sem-code' && e.label === 'src/rotate.ts' && e.depth === 3)).toBe(true);
    expect(entries.some((e) => e.tag === 'sem-table' && e.label === 'lifetimes' && e.depth === 3)).toBe(true);
  });

  it('a structural block swallows nested structural blocks', () => {
    const entries = outlineDoc(quiz);
    expect(entries.filter((e) => e.tag === 'sem-facts')).toHaveLength(1);
    expect(entries.some((e) => e.tag === 'sem-fact')).toBe(false);
    expect(entries.some((e) => e.tag === 'sem-progress' && e.label === 'coverage')).toBe(true);
  });
});
