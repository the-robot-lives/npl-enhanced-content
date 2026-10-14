/**
 * sem-enhanced-document — edit descriptor (document bucket, Phase 2).
 *
 * The required root wrapper (conventions §1): every SemText document wraps
 * its vocabulary in one; handlers scope to it, Lit components register
 * against it, and `role="main"` states the landmark. It carries no prose
 * of its own — the content IS its children — so there are no text slots
 * and no item list; the descriptor exists for the outline label, the
 * property modal and the document-skeleton insert template.
 *
 * OUT-OF-SCHEMA note: the tag is not in elements.json (like sem-chat).
 * getDescriptor() resolves it only once load-schema.ts seeds a
 * SchemaTagSpec under 'sem-enhanced-document' — requested from the schema
 * lane with an exact patch (reports/desc-document.md).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-enhanced-document',
  title: 'Document',
  bucket: 'document',
  summary: 'The required root wrapper — every SemText document wraps its vocabulary in one.',
  templates: [
    {
      id: 'sem-enhanced-document',
      label: 'Document skeleton',
      group: 'Document',
      xml:
        '<sem-enhanced-document role="main">\n' +
        '  <sem-reader controls="outline,progress"></sem-reader>\n' +
        '  <h1 data-kind="title">${1:Document title}</h1>\n' +
        '  <sem-note variant="info">${2:First block}</sem-note>\n' +
        '</sem-enhanced-document>',
    },
  ],
});
