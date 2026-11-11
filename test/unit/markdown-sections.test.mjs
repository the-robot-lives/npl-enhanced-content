// Unit spec — src/agent/markdown-sections · ".sem.md" (semtext markdown v1)
//
// Feature: plain Markdown gets the same addressing contract as XHTML
//   Scenario: ATX headings open sections owning content until a same-or-higher heading
//   Scenario: headings inside fenced code never structure the document
//   Scenario: nested sections nest; flatten is document order
//   Scenario: a <sem-section> marker binds authored id/kind/tags; ids mint as x-sec-*
//   Scenario: an authored <sem-tldr> is carried verbatim and never auto
//   Scenario: kind="hard-rule" / data-pin pins a section
//   Scenario: outline mirrors the OutlineNode contract (+ blocks counting)
//   Scenario: expand returns the annotated body; xhtml returns the raw slice
//   Scenario: filter selects by id/kind/tag/text; records are sections only

import { describe, it, expect } from 'vitest';
import {
  isMarkdownSource,
  parseMarkdownSections,
  flattenSections,
  mdOutline,
  mdExpand,
  mdFilter,
  slugify
} from '../../src/agent/markdown-sections.ts';

const DOC = `<!-- semtext:md v1 -->
Preamble prose is not addressable.

## Deployment
<sem-section id="deploy" kind="howto" tags="ops,ship"></sem-section>
<sem-tldr>Ship through CI only.</sem-tldr>
Body of deployment.

### Rollback
Steps to roll back.

## Fenced
\`\`\`md
### Not a heading
\`\`\`
After the fence.

## Pinned rule
<sem-section kind="hard-rule"></sem-section>
Never collapsed.

## Simple
Tail content.
`;

describe('isMarkdownSource', () => {
  it('detects by extension and by the line-1 version comment', () => {
    expect(isMarkdownSource('whatever', 'doc.md')).toBe(true);
    expect(isMarkdownSource('whatever', 'doc.SEM.MD')).toBe(true);
    expect(isMarkdownSource('whatever', 'doc.markdown')).toBe(true);
    expect(isMarkdownSource('<!-- semtext:md v1 -->\nrest')).toBe(true);
    expect(isMarkdownSource('<html></html>', 'doc.html')).toBe(false);
    expect(isMarkdownSource('<h1>x</h1>', null)).toBe(false);
  });
});

describe('parseMarkdownSections', () => {
  const { sections, preamble } = parseMarkdownSections(DOC);

  it('preamble stays out; sections start at headings', () => {
    expect(preamble).toContain('Preamble prose');
    expect(sections.map((s) => s.heading)).toEqual(['Deployment', 'Fenced', 'Pinned rule', 'Simple']);
  });

  it('nests subsections and flattens in document order', () => {
    expect(sections[0].children.map((c) => c.heading)).toEqual(['Rollback']);
    const flat = flattenSections(sections);
    expect(flat.map((s) => s.heading)).toEqual(['Deployment', 'Rollback', 'Fenced', 'Pinned rule', 'Simple']);
  });

  it('binds authored ids/kinds/tags from the marker', () => {
    expect(sections[0].id).toBe('deploy');
    expect(sections[0].idSource).toBe('authored');
    expect(sections[0].kind).toBe('howto');
    expect(sections[0].tags).toEqual(['ops', 'ship']);
  });

  it('mints x-sec-* ids with the authored namespace reserved', () => {
    expect(sections[1].id).toBe('x-sec-fenced');
    expect(sections[1].idSource).toBe('minted');
    expect(sections[3].id).toBe('x-sec-simple');
  });

  it('carries the authored tldr verbatim, never flagged auto', () => {
    expect(sections[0].tldr).toBe('Ship through CI only.');
    expect(sections[1].tldr).toBeUndefined();
  });

  it('ownText is the owned body without heading or nested sections', () => {
    expect(sections[0].ownText).toContain('Body of deployment.');
    expect(sections[0].ownText).toContain('Ship through CI only.');
    expect(sections[0].ownText).not.toContain('### Rollback');
    expect(sections[0].ownText).not.toContain('## Deployment');
  });

  it('pins kind="hard-rule" sections', () => {
    expect(sections[2].pinned).toBe(true);
    expect(sections[0].pinned).toBe(false);
  });

  it('keeps fenced-code headings out of the structure but in the content', () => {
    expect(sections[1].children).toEqual([]);
    expect(sections[1].text).toContain('### Not a heading');
    expect(sections[1].text).toContain('After the fence.');
  });

  it('section text drops marker lines but keeps authored tldr markup', () => {
    expect(sections[0].text).toContain('## Deployment');
    expect(sections[0].text).toContain('Ship through CI only.');
    expect(sections[0].text).not.toContain('<sem-section');
    // authored tldr markup survives (only data-auto tldrs are stripped)
    expect(sections[0].text).toContain('<sem-tldr>');
  });
});

describe('data-pin + auto tldr', () => {
  it('data-pin pins and a data-auto tldr is excluded from authored tldr', () => {
    const src = [
      '## A',
      '<sem-section data-pin></sem-section>',
      '<sem-tldr data-auto data-digest="abc">stale</sem-tldr>',
      'body',
      '## B',
      'other'
    ].join('\n');
    const { sections } = parseMarkdownSections(src);
    expect(sections[0].pinned).toBe(true);
    expect(sections[0].tldr).toBeUndefined();
    expect(sections[0].autoTldrLine).toBe(3);
    expect(sections[0].text).not.toContain('stale');
  });
});

describe('mdOutline', () => {
  it('mirrors the OutlineNode contract with qualifiers', () => {
    const nodes = mdOutline(DOC);
    expect(nodes.map((n) => n.id)).toEqual(['deploy', 'x-sec-fenced', 'x-sec-pinned-rule', 'x-sec-simple']);
    expect(nodes[0].type).toBe('section');
    expect(nodes[0].tldr).toBe('Ship through CI only.');
    expect(nodes[0].pinned).toBeUndefined();
    expect(nodes[2].pinned).toBe(true);
    expect(nodes[0].children.map((c) => c.id)).toEqual(['x-sec-rollback']);
  });

  it('blocks counts the subtree (self excluded)', () => {
    const nodes = mdOutline(DOC);
    expect(nodes[0].blocks).toBe(1); // Rollback
    expect(nodes[1].blocks).toBe(0);
  });

  it('honours --depth', () => {
    const nodes = mdOutline(DOC, 1);
    expect(nodes[0].children).toEqual([]);
  });
});

describe('mdExpand', () => {
  it('returns the annotated section body', () => {
    const text = mdExpand(DOC, 'deploy');
    expect(text).toContain('[deploy] section');
    expect(text).toContain('## Deployment');
    expect(text).toContain('Ship through CI only.');
    expect(text).toContain('### Rollback');
    expect(text).toContain('Steps to roll back.');
    expect(text).not.toContain('Tail content');
  });

  it('xhtml format returns the raw source slice', () => {
    const raw = mdExpand(DOC, 'deploy', 'xhtml');
    expect(raw.startsWith('## Deployment')).toBe(true);
    expect(raw).toContain('<sem-section id="deploy"');
  });

  it('refuses unknown ids', () => {
    expect(() => mdExpand(DOC, 'nope')).toThrow(/no block with id/);
  });
});

describe('mdFilter', () => {
  it('selects by id, kind, tag and text', () => {
    expect(mdFilter(DOC, { id: 'deploy' }).map((h) => h.id)).toEqual(['deploy']);
    expect(mdFilter(DOC, { kind: 'howto' }).map((h) => h.id)).toEqual(['deploy']);
    expect(mdFilter(DOC, { tag: 'ship' }).map((h) => h.id)).toEqual(['deploy']);
    // deploy's text span includes nested Rollback content, so both match
    expect(mdFilter(DOC, { text: 'roll back' }).map((h) => h.id)).toEqual(['deploy', 'x-sec-rollback']);
    expect(mdFilter(DOC, { type: 'section' }).length).toBe(5);
  });

  it('carries the qualifier fields', () => {
    const hit = mdFilter(DOC, { id: 'deploy' })[0];
    expect(hit.kind).toBe('howto');
    expect(hit.tldr).toBe('Ship through CI only.');
    expect(hit.record).toBeNull();
  });

  it('rejects record types markdown does not have', () => {
    expect(() => mdFilter(DOC, { type: 'sem-fact' })).toThrow(/sections only/);
  });
});

describe('slugify', () => {
  it('matches the toolkit slug rule', () => {
    expect(slugify('Rollback — the early years!')).toBe('rollback-the-early-years');
    expect(slugify('   ')).toBe('block');
  });
});
