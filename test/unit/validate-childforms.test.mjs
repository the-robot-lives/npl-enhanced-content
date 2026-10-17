/**
 * Unit tests for the child-form branch mechanism (spec/schema/
 * sem-workflow.md, sem-site-tree.md, sem-file-tree.md machine contracts).
 *
 * A parent def's `childForms[child]` attributes merge OVER the child
 * def's own attributes only when the parent resolves to that def — so
 * workflow steps gain action/gate/check/if-no/output, tree nodes gain a
 * required path, and the SAME elements elsewhere keep their plain
 * contracts.
 */
import { describe, it, expect } from 'vitest';
import { loadSchema, validateSource, defaultSchemaPath } from '../../src/validate/validate.js';

const schema = loadSchema(defaultSchemaPath());
const errorsOf = (r) => r.diagnostics.filter((d) => d.severity === 'error');
const warningsOf = (r) => r.diagnostics.filter((d) => d.severity === 'warning');
const ruleMessages = (r, rule) => r.diagnostics.filter((d) => d.rule === rule).map((d) => d.message);

const page = (body) => `<!doctype html>
<html lang="en"><body><sem-enhanced-document>${body}</sem-enhanced-document></body></html>`;

describe('workflow > step child form', () => {
  it('a workflow step with action and the operational parameters validates clean', () => {
    const r = validateSource(page(`
      <sem-workflow kind="release" duration="45m" label="Cut a release">
        <sem-step id="s1" action="Build images" description="sha-tagged via CI"
          gate="CI green" check="gh run view" if-no="fix CI, then re-run" output="dist/*.tar">push the tag</sem-step>
      </sem-workflow>`), schema);
    expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([]);
    expect(warningsOf(r)).toEqual([]);
  });

  it('a workflow step without action is a missing-attribute error (branch contract)', () => {
    const r = validateSource(page(`
      <sem-workflow><sem-step>do the thing</sem-step></sem-workflow>`), schema);
    expect(ruleMessages(r, 'missing-attribute').join(' ')).toContain('"action"');
    expect(errorsOf(r).length).toBeGreaterThan(0);
  });

  it('an unknown token value on a branch attribute is checked (branch merges value contracts)', () => {
    const r = validateSource(page(`
      <sem-workflow><sem-step action="go" status="sideways">x</sem-step></sem-workflow>`), schema);
    expect(ruleMessages(r, 'attribute-value').join(' ')).toContain('status');
  });

  it('a sem-procedure step is UNAFFECTED: no action required, action unknown there', () => {
    const clean = validateSource(page(`
      <sem-procedure kind="runbook"><sem-step status="done">provision Infisical path</sem-step></sem-procedure>`), schema);
    expect(errorsOf(clean), JSON.stringify(clean.diagnostics)).toEqual([]);
    expect(warningsOf(clean)).toEqual([]);

    const actionOutside = validateSource(page(`
      <sem-procedure><sem-step action="wrong context">x</sem-step></sem-procedure>`), schema);
    expect(ruleMessages(actionOutside, 'unknown-attribute').join(' ')).toContain('"action"');
  });

  it('the underscore spelling if_no is accepted in workflow context', () => {
    const r = validateSource(page(`
      <sem-workflow><sem-step action="promote" if_no="page the captain">x</sem-step></sem-workflow>`), schema);
    expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([]);
  });
});

describe('tree > node child form', () => {
  it('a structured site tree with nested nodes validates clean (node inside node)', () => {
    const r = validateSource(page(`
      <sem-site-tree label="Layout">
        <node path="src" label="Source" kind="dir">
          <node path="src/lit" kind="dir"><node path="src/lit/app.ts" kind="file"></node></node>
        </node>
      </sem-site-tree>`), schema);
    expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([]);
    expect(warningsOf(r)).toEqual([]);
  });

  it('a node without path inside a tree is a missing-attribute error', () => {
    const r = validateSource(page(`
      <sem-site-tree><node kind="dir"></node></sem-site-tree>`), schema);
    expect(ruleMessages(r, 'missing-attribute').join(' ')).toContain('"path"');
  });

  it('the class-alias form div.sem-node under div.sem-site-tree enforces the branch too', () => {
    const r = validateSource(page(`
      <div class="sem-site-tree"><div class="sem-node" data-path="src"></div></div>`), schema);
    expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([]);
  });

  it('file-tree text mode (mode="text" + a pre) validates clean with no node children', () => {
    const r = validateSource(page(`
      <sem-file-tree mode="text" label="Assets"><pre>assets/
  main.css
</pre></sem-file-tree>`), schema);
    expect(errorsOf(r), JSON.stringify(r.diagnostics)).toEqual([]);
    expect(warningsOf(r)).toEqual([]);
  });

  it('a node inside a file-tree enforces the same branch contract', () => {
    const r = validateSource(page(`
      <sem-file-tree><node></node></sem-file-tree>`), schema);
    expect(ruleMessages(r, 'missing-attribute').join(' ')).toContain('"path"');
  });

  it('an unknown kind value is flagged; nested orphan rules accept node parents', () => {
    const r = validateSource(page(`
      <sem-site-tree><node path="a" kind="blob"></node></sem-site-tree>`), schema);
    expect(ruleMessages(r, 'attribute-value').join(' ')).toContain('kind');
  });

  it('a node OUTSIDE any tree is an orphan-part warning and path is unknown there', () => {
    const r = validateSource(page(`<sem-note variant="tip" id="n1"><node path="stray"></node></sem-note>`), schema);
    expect(ruleMessages(r, 'orphan-part').join(' ')).toContain('node');
    expect(ruleMessages(r, 'unknown-attribute').join(' ')).toContain('"path"');
  });
});
