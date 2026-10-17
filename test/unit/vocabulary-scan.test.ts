// @vitest-environment happy-dom
// Unit spec — the vocabulary tag scan (src/lazy/scan.ts)
//
// Feature: the scan recognizes every namespace family, and only those
//   Scenario: sem-*, npl-*, semext-* and agent-kit-* tags all match
//   Scenario: multi-token tags in every family match (hyphen-anchored)
//   Scenario: `semext-*` never mis-splits into `sem` + `ext-*`
//   Scenario: junk stays out — bare prefixes, uppercase, double hyphens,
//             non-vocabulary names

import { describe, it, expect } from 'vitest';
import { VOCABULARY_TAG, isVocabularyTag, collectTags } from '../../src/lazy/scan.js';

describe('VOCABULARY_TAG — four families', () => {
  it('matches every family prefix', () => {
    for (const tag of ['sem-note', 'npl-example', 'semext-canvas', 'agent-kit-transcript']) {
      expect(VOCABULARY_TAG.test(tag), tag).toBe(true);
    }
  });

  it('matches multi-token tags in every family', () => {
    for (const tag of ['sem-data-source', 'npl-mindread', 'semext-tldr-block', 'agent-kit-issue-tracker']) {
      expect(VOCABULARY_TAG.test(tag), tag).toBe(true);
    }
  });

  it('never splits semext across the sem branch', () => {
    // the alternation lists semext before sem, and the trailing hyphen
    // anchors the prefix — `semext-note` is one semext tag, not `sem` +
    // `ext-note` (the pattern is anchored, so test() is a full match)
    expect(VOCABULARY_TAG.test('semext-note')).toBe(true);
    expect('semext-note'.replace(VOCABULARY_TAG, '')).toBe('');
  });

  it('rejects junk: bare prefixes, casing, malformed tokens, foreign names', () => {
    for (const tag of [
      'sem', 'npl', 'semext', 'agent-kit', // bare prefixes
      'sem-', 'semext-', 'agent-kit-', // no token after the prefix
      'Sem-Note', 'semTLDR', 'agent-kit-transcriptX', // uppercase sneaks
      'sem--note', 'agent-kit--x', // double hyphen
      'sem _note', 'note', 'div', 'mysem-note', // not vocabulary-shaped
      'pre-sem-note', // prefix must START the name
    ]) {
      expect(isVocabularyTag(tag), tag).toBe(false);
    }
  });

  it('collectTags sweeps all four families from a subtree', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<sem-note>a</sem-note><npl-flag>b</npl-flag>' +
      '<semext-card>c</semext-card><agent-kit-issue>d</agent-kit-issue>' +
      '<div>e</div>';
    const tags = [...collectTags(host)].sort();
    expect(tags).toEqual(['agent-kit-issue', 'npl-flag', 'sem-note', 'semext-card']);
  });
});
