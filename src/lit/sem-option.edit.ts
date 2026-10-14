/**
 * sem-option — edit descriptor (recall bucket, Phase 2).
 *
 * Tier-1 quiz candidate (spec/conventions.md) — out-of-schema like
 * `sem-question` (see that file's header): hand-authored descriptor,
 * reachable via `handDescriptors()` until the schema grows the tag.
 *
 * The option text is the element's own content — the `:scope`
 * unwrapped-content slot form. `correct` is a bare boolean attribute; the
 * property modal renders it as a checkbox once the schema knows the tag.
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-option',
  title: 'Quiz option',
  bucket: 'data', // recall family — EditBucket lacks 'recall' yet (see report)
  summary: 'One candidate answer; `correct` marks the right one (Tier 1).',
  textSlots: [
    {
      selector: ':scope',
      label: 'Option text',
      placeholder: 'Candidate answer…',
      escape: 'entities',
    },
  ],
  containerOf: 'sem-question',
  templates: [
    {
      id: 'sem-option',
      label: 'Option',
      group: 'Recall',
      xml: '<sem-option>${1:Option text}</sem-option>',
    },
    {
      id: 'sem-option-correct',
      label: 'Correct option',
      group: 'Recall',
      xml: '<sem-option correct>${1:Correct answer}</sem-option>',
    },
  ],
});
