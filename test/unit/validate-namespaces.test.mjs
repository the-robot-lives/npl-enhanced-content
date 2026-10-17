/**
 * Unit tests — validator across the four namespace families
 * (src/validate/validate.js) + $def `extends` preset resolution.
 *
 * The four-family allowlist and the hyphen-safe defName derivation are
 * schema-driven: the family prefixes live in FAMILY_PREFIXES, the presets
 * in x-semtext.defPresets, and loadSchema merges them into $defs before
 * any rule runs.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSchema, validateSource, defaultSchemaPath } from '../../src/validate/validate.js';

const schema = loadSchema(defaultSchemaPath());
const errorsOf = (r) => r.diagnostics.filter((d) => d.severity === 'error');
const ruleSet = (r) => new Set(r.diagnostics.map((d) => d.rule));

const ROOT_OPEN = `<!doctype html><html lang="en"><body><sem-enhanced-document>`;
const ROOT_CLOSE = `</sem-enhanced-document></body></html>`;

describe('four families — unknown elements and vocabulary detection', () => {
  it('flags unknown tags in every family, and only there', () => {
    for (const tag of ['sem-widget', 'npl-widget', 'semext-widget', 'agent-kit-widget']) {
      const r = validateSource(`${ROOT_OPEN}<${tag}>x</${tag}>${ROOT_CLOSE}`, schema);
      expect(ruleSet(r).has('unknown-element'), tag).toBe(true);
      expect(errorsOf(r).some((d) => d.rule === 'unknown-element'), tag).toBe(true);
    }
    // ordinary HTML is never an unknown element
    const plain = validateSource(`${ROOT_OPEN}<div>x</div>${ROOT_CLOSE}`, schema);
    expect(ruleSet(plain).has('unknown-element')).toBe(false);
  });

  it('semext/agent-kit presence triggers the missing-root rule like sem-* does', () => {
    const r = validateSource(`<!doctype html><body><semext-note>x</semext-note></body>`, schema);
    expect(ruleSet(r).has('missing-root')).toBe(true);
    const r2 = validateSource(`<!doctype html><body><agent-kit-issue>x</agent-kit-issue></body>`, schema);
    expect(ruleSet(r2).has('missing-root')).toBe(true);
  });

  it('knows sem-tldr (the walking skeleton def) — no unknown-element', () => {
    const r = validateSource(
      `${ROOT_OPEN}<sem-tldr id="t1">short version</sem-tldr>${ROOT_CLOSE}`,
      schema,
    );
    expect(ruleSet(r).has('unknown-element')).toBe(false);
    expect(errorsOf(r)).toEqual([]);
  });
});

describe('class-form aliases — hyphen-safe defName derivation', () => {
  it('still resolves the sem-* class alias to its def', () => {
    const r = validateSource(
      `${ROOT_OPEN}<div class="sem-note" variant="tip">hi</div>${ROOT_CLOSE}`,
      schema,
    );
    expect(ruleSet(r).has('unknown-element')).toBe(false);
    expect(ruleSet(r).has('attribute-value')).toBe(false);
  });

  it('slices hyphenated prefixes on the full prefix — no broken identifiers', () => {
    // `.agent-kit-note` → token `note` → defs['note'] / defs['agent-kit-note']
    // both absent: the class is an unknown ALIAS, not a crash or a
    // mangled def name; an alias div is ordinary content, so no diagnostics.
    const r = validateSource(
      `${ROOT_OPEN}<div class="agent-kit-note">x</div>${ROOT_CLOSE}`,
      schema,
    );
    expect(r.diagnostics).toEqual([]);
    // same for semext
    const r2 = validateSource(
      `${ROOT_OPEN}<div class="semext-note">x</div>${ROOT_CLOSE}`,
      schema,
    );
    expect(r2.diagnostics).toEqual([]);
  });

  it('rejects value violations through a class alias in any family shape', () => {
    // sem-note's variant is a token; the alias spelling must hit the same contract
    const r = validateSource(
      `${ROOT_OPEN}<div class="sem-note" variant="bogus">hi</div>${ROOT_CLOSE}`,
      schema,
    );
    expect(ruleSet(r).has('attribute-value')).toBe(true);
  });
});

describe('$def extends presets (x-semtext.defPresets)', () => {
  const withSchema = (defs, presets) => {
    const dir = mkdtempSync(join(tmpdir(), 'semtext-schema-'));
    const file = join(dir, 'schema.json');
    writeFileSync(
      file,
      JSON.stringify({
        // minimal-but-valid x-semtext: everything validateSource reads
        'x-semtext': {
          specVersion: '0',
          document: {
            root: { tag: 'sem-enhanced-document', classAliases: ['div.sem-enhanced-document'], requiredWhenVocabularyPresent: true },
            tierMarkers: { attributes: [], severity: 'warning' },
            generatedChrome: { elements: [], severity: 'warning' },
            childRules: [],
          },
          standardAttributes: [],
          globalAttributes: { id: {}, kind: {}, tags: {}, audience: {} },
          spelling: { dualSpellingSeverity: 'error' },
          unknownAttributeSeverity: 'warning',
          unknownElementSeverity: 'error',
          defPresets: presets,
        },
        $defs: defs,
      }),
    );
    return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };

  it('merges preset attributes under local ones', () => {
    const { file, cleanup } = withSchema(
      {
        'agent-kit-card': {
          extends: 'reference',
          attributes: { kind: { type: 'token' } },
        },
      },
      {
        reference: {
          attributes: { org: { type: 'token', required: true }, project: { type: 'token', required: true } },
        },
      },
    );
    try {
      const s = loadSchema(file);
      // preset landed under the local def without mutating the file's raw shape
      expect(s.$defs['agent-kit-card'].attributes.org.required).toBe(true);
      expect(s.$defs['agent-kit-card'].attributes.kind).toBeTruthy();

      const missing = validateSource(`${ROOT_OPEN}<agent-kit-card kind="a">x</agent-kit-card>${ROOT_CLOSE}`, s);
      expect(errorsOf(missing).some((d) => d.rule === 'missing-attribute' && d.message.includes('org'))).toBe(true);

      const ok = validateSource(
        `${ROOT_OPEN}<agent-kit-card org="o" project="p" kind="a">x</agent-kit-card>${ROOT_CLOSE}`,
        s,
      );
      expect(errorsOf(ok)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('accepts an extends array and throws on an unknown preset name', () => {
    const a = withSchema({ 'semext-x': { extends: ['reference', 'container'], attributes: {} } }, {
      reference: { attributes: { org: { type: 'token' } } },
      container: { attributes: { label: { type: 'token' } } },
    });
    try {
      const s = loadSchema(a.file);
      expect(Object.keys(s.$defs['semext-x'].attributes).sort()).toEqual(['label', 'org']);
    } finally {
      a.cleanup();
    }

    const b = withSchema({ 'semext-y': { extends: 'nope', attributes: {} } }, {});
    try {
      expect(() => loadSchema(b.file)).toThrow(/unknown defPresets entry "nope"/);
    } finally {
      b.cleanup();
    }
  });

  it('the shipped schema carries the three documented presets, resolvable', () => {
    const presets = schema['x-semtext'].defPresets;
    for (const name of ['container', 'reference', 'cachedEmbed']) {
      expect(presets[name], name).toBeTruthy();
      expect(presets[name].attributes, name).toBeTruthy();
    }
    // cachedEmbed is the reference quartet plus the cache block
    for (const attr of ['org', 'project', 'key', 'id', 'endpoint', 'fixtures', 'last-refreshed', 'status']) {
      expect(presets.cachedEmbed.attributes[attr], attr).toBeTruthy();
    }
  });
});
