// Unit tests for scripts/build-elements-index.mjs — schema-bullet parsing.
//
// The generator derives elements.json from the normative schema markdown.
// These tests pin the extraction rules reviewers found broken: `data-*`
// alias mirrors leaking into `allowedValues`, orphan "; "/"—" separators
// and unstripped backticked type words left in attribute descriptions,
// the short "… global." catalog line falling through to a mangled
// `id` record, and rendered-chrome tokens (CSS classes, warning channels)
// mined as children from sentences that follow a child-grammar
// declaration.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSchemaFile } from '../../scripts/build-elements-index.mjs';

function parse(body) {
  const dir = mkdtempSync(join(tmpdir(), 'semtext-schema-'));
  const file = join(dir, 'fixture.md');
  writeFileSync(file, `# Schema — \`fixture\`\n\n${body}\n`);
  try {
    return parseSchemaFile(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function attr(parsed, name) {
  return parsed.attributes.find((a) => a.name === name);
}

describe('allowedValues extraction', () => {
  it('drops data-* alias mirrors and bare type words from "one of" enumerations', () => {
    const parsed = parse(
      [
        '## Authoring form',
        '',
        '```html',
        '<fixture kind="directive">text</fixture>',
        '```',
        '',
        '- `kind`: string — default `directive`; one of `directive` | `prefix`. A `prefix` chip renders the arrow between glyph and instruction. Mirrored to `data-kind` (resolved value).',
        '- `direction`: `string` — default `lr`. One of `lr` | `td`; declares the intended flow and mirrors to `data-direction` (dual-form contract, `data-` wins).'
      ].join('\n')
    );
    expect(attr(parsed, 'kind').allowedValues).toEqual(['directive', 'prefix']);
    expect(attr(parsed, 'direction').allowedValues).toEqual(['lr', 'td']);
  });

  it('keeps the stated single mode and filters the value-enumeration branch', () => {
    const parsed = parse(
      [
        '## Authoring form',
        '',
        '```html',
        '<fixture view-as="timeline">text</fixture>',
        '```',
        '',
        '- `view-as`: `timeline` (default) | `list`. Unknown values render as `timeline`.',
        '- `mode`: `timeline` (default) — the mirror rides `data-mode`.'
      ].join('\n')
    );
    expect(attr(parsed, 'view-as').allowedValues).toEqual(['timeline', 'list']);
    expect(attr(parsed, 'mode').allowedValues).toEqual(['timeline']);
  });
});

describe('attribute descriptions', () => {
  it('strips a backticked type-word lead', () => {
    const parsed = parse(
      [
        '## Authoring form',
        '',
        '```html',
        '<fixture name="a"></fixture>',
        '```',
        '',
        '- `name`: `string` — required. The agent identifier, the `<name>` field of the source form.'
      ].join('\n')
    );
    expect(attr(parsed, 'name').description).toBe('required. The agent identifier, the `<name>` field of the source form.');
  });

  it('leaves no "; " residue or dash lead-in after the default clause', () => {
    const parsed = parse(
      [
        '## Authoring form',
        '',
        '```html',
        '<fixture type="definition">rules</fixture>',
        '```',
        '',
        '- `type`: string — default `definition`; one of `definition` | `extension`. Any other value falls back to `definition`.',
        '- `confidence`: `number` — optional, default `<absent>` — a reading is a guess until corrected.'
      ].join('\n')
    );
    expect(attr(parsed, 'type').description).toBe(
      'one of `definition` | `extension`. Any other value falls back to `definition`.'
    );
    expect(attr(parsed, 'confidence').description).toBe('optional, a reading is a guess until corrected.');
  });
});

describe('global attribute catalog lines', () => {
  it('accepts both the long catalog form and the short "… global." form', () => {
    const parsed = parse(
      [
        '## Authoring form',
        '',
        '```html',
        '<fixture>text</fixture>',
        '```',
        '',
        '- `id`, `kind`, `tags` global.'
      ].join('\n')
    );
    expect(parsed.attributes.map((a) => a.name)).toEqual(['id', 'kind', 'tags']);
    expect(attr(parsed, 'id').description).toBe('per the global attribute catalog (conventions.md §2)');
  });
});

describe('children from prose', () => {
  it('mines the child-grammar sentence but not later chrome sentences', () => {
    const parsed = parse(
      [
        '## Authoring form',
        '',
        '```html',
        '<fixture><subject>who</subject></fixture>',
        '```',
        '',
        'Child grammar (all optional; rendered only when authored): `subject`, `signals` (containing `signal` elements), `adaptation`. A `signal` whose `type` is unknown renders with its chip marked `fixture-signal-unknown` (plus `data-unknown-signal-type` and an author-facing `warn`).'
      ].join('\n')
    );
    expect(parsed.children.map((c) => c.name)).toEqual(['subject', 'signals', 'signal', 'adaptation']);
  });
});
