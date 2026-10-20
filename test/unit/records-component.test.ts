// @vitest-environment happy-dom
// Unit spec — extraction records for the component-inventory pair
// (spec/schema/sem-component.md, spec/schema/sem-see-also.md; src/extract/
// records.ts RECORD_TYPES entries, 0.9.5).
//
// Feature: sem-component extracts as a component record
//   Scenario: the manifest vocabulary rides fields; labels split; text = authored description
// Feature: sem-see-also extracts as a see-also record
//   Scenario: target metadata rides fields; text = authored label

import { describe, it, expect } from 'vitest';
import { extractRecords } from '../../src/extract/records.js';

describe('extraction — component-inventory pair', () => {
  it('sem-component: fields carry the manifest vocabulary, labels split', () => {
    document.body.innerHTML = `
      <sem-component id="c1" tag="noizu-waitlist" name="Waitlist"
        source="src/waitlist.ts" type="web-component" status="live"
        labels="form telemetry">
        Lightweight waitlist form.
      </sem-component>`;
    const rec = extractRecords(document).find((r) => r.type === 'sem-component');
    expect(rec).toBeTruthy();
    expect(rec!.fields).toMatchObject({
      tag: 'noizu-waitlist',
      name: 'Waitlist',
      source: 'src/waitlist.ts',
      type: 'web-component',
      status: 'live',
    });
    expect(rec!.fields.labels).toEqual(['form', 'telemetry']);
    expect(rec!.text).toContain('Lightweight waitlist form.');
  });

  it('sem-see-also: target metadata rides fields, authored label is the text', () => {
    document.body.innerHTML = `
      <sem-see-also id="s1" reference="component" target="noizu-waitlist"
        preview="tldr" insert-as="link">waitlist intake</sem-see-also>`;
    const rec = extractRecords(document).find((r) => r.type === 'sem-see-also');
    expect(rec).toBeTruthy();
    expect(rec!.fields).toMatchObject({
      reference: 'component',
      target: 'noizu-waitlist',
      preview: 'tldr',
      insertAs: 'link',
    });
    expect(rec!.text).toContain('waitlist intake');
  });
});
