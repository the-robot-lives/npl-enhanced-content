/**
 * sem-reader — edit descriptor (document bucket, Phase 2).
 *
 * Reading chrome (spec/schema/sem-reader.md): outline, progress bar and
 * the reader controls — one per document, first child of the root wrapper.
 * The only authored child is an optional contents `<nav>`, used verbatim —
 * structured markup, not a text slot. `controls` / `outline-depth` are
 * plain schema attributes (the modal edits them; the comma-flag string is
 * authored verbatim, no flags widget in v1).
 *
 * rerender: SemReader is a one-shot wrapper (`#wired` guard) over
 * src/reading/reader.ts — after the model replaces the element's children
 * the enhance must re-run so the reading chrome comes back (EDITOR.md
 * §3.3 one-shot-wrapper seam). enhanceReaderElement is idempotent on the
 * chrome's presence, so this is safe to call after every re-render.
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { enhanceReaderElement } from '../reading/reader.js';

registerDescriptor({
  tag: 'sem-reader',
  title: 'Reader',
  bucket: 'document',
  summary:
    'Reading chrome — outline, progress and reader controls. One per document, first child of the root wrapper.',
  rerender(el) {
    enhanceReaderElement(el);
  },
  templates: [
    {
      id: 'sem-reader',
      label: 'Reader (outline + progress)',
      group: 'Document',
      xml: '<sem-reader controls="${1:outline,progress}"></sem-reader>',
    },
    {
      id: 'sem-reader-full',
      label: 'Reader (all controls)',
      group: 'Document',
      xml:
        '<sem-reader controls="outline,progress,focus,type,color,print,audience" outline-depth="${1:3}"></sem-reader>',
    },
  ],
});
