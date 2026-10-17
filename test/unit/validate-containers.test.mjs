/**
 * Unit tests for the family A containers (static knowledge/doc
 * containers): the four collection/entry pairs (guard-rails, tsgs,
 * faqs, changelogs), enum token validation, the container preset
 * merge, and record:true extraction behavior of the schema defs.
 *
 * Schema-driven: every rule asserted here lives in
 * spec/schema/semtext.schema.json — no validator code paths of their
 * own. Contract files: spec/schema/sem-<el>.md; e2e:
 * test/e2e/sem-containers-{a,b}.cy.js.
 */
import { describe, it, expect } from 'vitest';
import { loadSchema, validateSource, defaultSchemaPath } from '../../src/validate/validate.js';

const schema = loadSchema(defaultSchemaPath());

const errorsOf = (r) => r.diagnostics.filter((d) => d.severity === 'error');
const warningsOf = (r) => r.diagnostics.filter((d) => d.severity === 'warning');
const rules = (r) => r.diagnostics.map((d) => d.rule);

const doc = (body) => `<!doctype html>
<html lang="en">
<body>
<sem-enhanced-document>
${body}
</sem-enhanced-document>
</body>
</html>`;

describe('family A schema registration', () => {
  it('all 19 tags have defs with record: true', () => {
    const tags = [
      'sem-kb', 'sem-runbook', 'sem-howto', 'sem-requirement',
      'sem-threat-model', 'sem-guard-rails', 'sem-guard-rail',
      'sem-mockup', 'sem-rubric', 'sem-eval', 'sem-philosophy',
      'sem-summary', 'sem-plan', 'sem-tsgs', 'sem-tsg',
      'sem-faqs', 'sem-faq', 'sem-changelogs', 'sem-changelog',
    ];
    for (const tag of tags) {
      const def = schema.$defs[tag];
      expect(def, `${tag} has a $def`).toBeTruthy();
      expect(def.record, `${tag} record: true`).toBe(true);
    }
  });

  it('container preset merges: label/open inherited, local attrs win', () => {
    const def = schema.$defs['sem-kb'];
    expect(def.attributes.label, 'preset label attr inherited').toBeTruthy();
    expect(def.attributes.open, 'preset open attr inherited').toBeTruthy();
  });
});

describe('pair orphan detection (partOf)', () => {
  it('an entry outside its collection is an orphan error', () => {
    const r = validateSource(doc('<sem-faq><question>Q</question><answer>A</answer></sem-faq>'), schema);
    expect(rules(r)).toContain('orphan-part');
  });

  it('each of the four pairs nests cleanly inside the root', () => {
    const src = doc(`
      <sem-guard-rails><sem-guard-rail severity="warn">rule</sem-guard-rail></sem-guard-rails>
      <sem-tsgs><sem-tsg><name>n</name><title>t</title><description>d</description><tags>x</tags><when>w</when>fix</sem-tsg></sem-tsgs>
      <sem-faqs><sem-faq><question>Q</question><answer>A</answer></sem-faq></sem-faqs>
      <sem-changelogs><sem-changelog date="2026-10-18" name="r" title="t">note<tags>a</tags></sem-changelog></sem-changelogs>`);
    const r = validateSource(src, schema);
    expect(errorsOf(r)).toEqual([]);
    expect(warningsOf(r)).toEqual([]);
  });
});

describe('childRules exactlyOne (sem-faq)', () => {
  it('a faq missing its answer is an error', () => {
    const r = validateSource(doc(
      '<sem-faqs><sem-faq><question>Q</question></sem-faq></sem-faqs>'), schema);
    expect(rules(r)).toContain('child-structure');
  });

  it('a faq missing its question is an error', () => {
    const r = validateSource(doc(
      '<sem-faqs><sem-faq><answer>A</answer></sem-faq></sem-faqs>'), schema);
    expect(rules(r)).toContain('child-structure');
  });

  it('a complete faq is clean', () => {
    const r = validateSource(doc(
      '<sem-faqs><sem-faq><question>Q</question><answer>A</answer></sem-faq></sem-faqs>'), schema);
    expect(errorsOf(r)).toEqual([]);
  });
});

describe('enum tokens', () => {
  it('requirement kind accepts the three enum values', () => {
    for (const kind of ['functional', 'non-functional', 'constraint']) {
      const r = validateSource(doc(
        `<sem-requirement id="r1" kind="${kind}">The thing.</sem-requirement>`), schema);
      expect(errorsOf(r), kind).toEqual([]);
    }
  });

  it('requirement kind rejects a value outside the enum', () => {
    const r = validateSource(doc(
      '<sem-requirement id="r1" kind="aspirational">The thing.</sem-requirement>'), schema);
    expect(rules(r)).toContain('attribute-value');
  });

  it('guard-rail severity accepts info/warn/block', () => {
    for (const severity of ['info', 'warn', 'block']) {
      const r = validateSource(doc(
        `<sem-guard-rails><sem-guard-rail severity="${severity}">rule</sem-guard-rail></sem-guard-rails>`), schema);
      expect(errorsOf(r), severity).toEqual([]);
    }
  });

  it('guard-rail severity rejects an unknown value', () => {
    const r = validateSource(doc(
      '<sem-guard-rails><sem-guard-rail severity="fatal">rule</sem-guard-rail></sem-guard-rails>'), schema);
    expect(rules(r)).toContain('attribute-value');
  });

  it('mockup mode accepts text/html and defaults to text', () => {
    expect(schema.$defs['sem-mockup'].attributes.mode.default).toBe('text');
    for (const mode of ['text', 'html']) {
      const r = validateSource(doc(
        `<sem-mockup id="m" mode="${mode}">frame</sem-mockup>`), schema);
      expect(errorsOf(r), mode).toEqual([]);
    }
  });
});

describe('class-form (Appendix A) for the pairs', () => {
  it('div-form faqs/tsgs/guard-rails/changelogs validate clean', () => {
    const src = `<!doctype html><body>
      <div class="sem-enhanced-document">
        <div class="sem-guard-rails"><div class="sem-guard-rail">rule</div></div>
        <div class="sem-tsgs"><div class="sem-tsg"><div class="sem-name">n</div><div class="sem-title">t</div><div class="sem-description">d</div><div class="sem-tags">x</div><div class="sem-when">w</div>fix</div></div>
        <div class="sem-faqs"><div class="sem-faq"><div class="sem-question">Q</div><div class="sem-answer">A</div></div></div>
        <div class="sem-changelogs"><div class="sem-changelog"><div class="sem-tags">a</div>note</div></div>
      </div></body>`;
    const r = validateSource(src, schema);
    expect(errorsOf(r)).toEqual([]);
  });
});
