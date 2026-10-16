/**
 * npl-ref — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * All five sections are inline slots. The element labels each section
 * (generated headings INSIDE it) and appends its generated index list at
 * the END of the element — neither shifts the sections' authored indexes,
 * so mapping and commits hold after upgrade. `variant` rides the property
 * modal.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

const SECTION = (name: string): string => `:scope > :is(${name}, .npl-${name})`;

const slot = (name: string, label: string) => ({
  selector: SECTION(name),
  label,
  multiline: true,
  escape: 'entities' as const,
});

registerDescriptor({
  tag: 'npl-ref',
  title: 'Reflection',
  bucket: 'npl-b',
  summary: 'A post-hoc NPL reflection: assessment, improvements, validation, eval, fine-tune.',
  textSlots: [
    slot('assessment', 'Assessment'),
    slot('improvements', 'Improvements'),
    slot('validation', 'Validation'),
    slot('eval', 'Eval'),
    slot('fine-tune', 'Fine-tune'),
  ],
  templates: [
    {
      id: 'npl-ref',
      label: 'Reflection',
      group: 'NPL',
      xml:
        '<npl-ref variant="${1:full}">\n' +
        '  <assessment>${2:Assessment}</assessment>\n' +
        '  <improvements>${3:Improvements}</improvements>\n' +
        '  <validation>${4:Validation}</validation>\n' +
        '  <eval>${5:Eval}</eval>\n' +
        '  <fine-tune>${6:Fine-tune}</fine-tune>\n' +
        '</npl-ref>',
    },
    {
      id: 'npl-ref-brief',
      label: 'Brief reflection',
      group: 'NPL',
      xml: '<npl-ref variant="brief">\n  <assessment>${1:Assessment}</assessment>\n</npl-ref>',
    },
  ],
});
