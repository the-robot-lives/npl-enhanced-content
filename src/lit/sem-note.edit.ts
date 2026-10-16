/**
 * sem-note — edit descriptor (pilot, schema lane).
 *
 * sem-note's authored body appears in the DOM two ways: wrapped in
 * `.sem-note-body` when the element creates the wrapper (collapsed form),
 * or as the element's own unwrapped content. Both are declared here; the
 * controller resolves at runtime (EDITOR.md §3.3) and skips runtime chrome
 * (the `.sem-note-summary` teaser is the element's own, never authored).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-note',
  title: 'Note',
  bucket: 'prose',
  summary: 'A callout — prose set beside the main flow.',
  textSlots: [
    {
      selector: ':scope > .sem-note-body',
      label: 'Body',
      multiline: true,
      placeholder: 'Note body…',
      escape: 'entities',
    },
    {
      // unwrapped form: the body is the element's own content — every
      // authored child is the slot; chrome skip + resolution are the
      // controller's job
      selector: ':scope > *',
      label: 'Body',
      multiline: true,
      placeholder: 'Note body…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-note',
      label: 'Note',
      group: 'Callouts',
      xml: '<sem-note variant="${1|info,warning,tip,danger|}">${2:Note body}</sem-note>',
    },
    {
      id: 'sem-note-collapsed',
      label: 'Collapsed note',
      group: 'Callouts',
      xml: '<sem-note variant="${1|info,warning,tip,danger|}" collapsed>${2:Note body}</sem-note>',
    },
    {
      id: 'sem-note-margin',
      label: 'Margin note',
      group: 'Callouts',
      xml: '<sem-note view-as="margin">${1:Margin note body}</sem-note>',
    },
  ],
});
