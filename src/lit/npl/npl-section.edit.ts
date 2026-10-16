/**
 * npl-section — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * `type` is the enum the property modal renders (unknown types degrade to
 * a warning class in the element, so the enum is worth enforcing at the
 * modal). The body is arbitrary markup (usually a code fence) — no text
 * slot: the generated header lands as the element's first child, and a
 * body slot would be refused (element children) anyway; body edits belong
 * to the code view. Templates cover the generic form and the two most
 * common bodies.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-section',
  title: 'Section',
  bucket: 'npl-b',
  summary: 'A typed NPL prompt-section block with a labelled header.',
  templates: [
    {
      id: 'npl-section',
      label: 'Typed section',
      group: 'NPL',
      xml:
        '<npl-section type="${1:syntax}">\n' +
        '  ${2:Section body}\n' +
        '</npl-section>',
    },
    {
      id: 'npl-section-syntax',
      label: 'Syntax section',
      group: 'NPL',
      xml:
        '<npl-section type="syntax">\n' +
        '  <pre><code>${1:section := "&lt;npl-section&gt;" body "&lt;/npl-section&gt;"}</code></pre>\n' +
        '</npl-section>',
    },
    {
      id: 'npl-section-example',
      label: 'Example section',
      group: 'NPL',
      xml:
        '<npl-section type="example">\n' +
        '  <pre><code>${1:example}</code></pre>\n' +
        '</npl-section>',
    },
  ],
});
