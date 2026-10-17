/**
 * npl-mood — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * `mood` (required) names the chip; the three detail children are the item
 * list with the EDITOR.md §3.3-pinned selector. The element regroups the
 * parts into a generated `.npl-mood-detail` panel once upgraded, after
 * which `:scope > .npl-mood-*` no longer matches: `+` then appends the new
 * part at the end of the element's model children — the correct position,
 * which the next re-render regroups — while `−` is a no-op (no items
 * resolved). The panel is generated runtime chrome the mapping cannot see
 * past; regions()-based anchoring is the cross-lane request in the lane
 * report. No text slots: the details ARE the items, and the chip renders
 * from the `mood` attribute.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-mood',
  title: 'Mood',
  bucket: 'npl-b',
  summary: 'An affective-state chip with optional tone, context and approach details.',
  itemList: {
    childSelector:
      ':scope > .npl-mood-tone, :scope > .npl-mood-context, :scope > .npl-mood-approach',
    label: 'mood detail',
    template: {
      id: 'npl-mood-detail',
      label: 'Mood detail',
      xml: '<div class="npl-mood-tone">${1:Tone}</div>',
    },
  },
  templates: [
    {
      id: 'npl-mood',
      label: 'Mood chip',
      group: 'NPL',
      xml: '<npl-mood mood="${1:🙂 wistful}"/>',
    },
    {
      id: 'npl-mood-details',
      label: 'Mood chip with details',
      group: 'NPL',
      xml:
        '<npl-mood mood="${1:🙂 wistful}">\n' +
        '  <div class="npl-mood-tone">${2:Tone}</div>\n' +
        '  <div class="npl-mood-context">${3:Context}</div>\n' +
        '  <div class="npl-mood-approach">${4:Approach}</div>\n' +
        '</npl-mood>',
    },
  ],
});
