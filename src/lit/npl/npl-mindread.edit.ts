/**
 * npl-mindread — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * `confidence` rides the property modal (schema number type); the template
 * carries the full section skeleton. Text slots and a signals item list
 * are deliberately withheld: `#layout()` reorders the authored sections
 * behind the generated `.npl-mindread-confidence` panel, which the
 * controller's authored-index mapping (EDITOR.md §3.3) counts as authored
 * content — slot commits would silently no-op. That lands with the
 * chrome-aware mapping fix requested in the lane report; the descriptors
 * then gain `textSlots` (subject / motive / mood / cognitive / unspoken /
 * adaptation) and `itemList` (`:scope > signals > signal`).
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-mindread',
  title: 'Mindread',
  bucket: 'npl-b',
  summary: 'A theory-of-mind reading of the other party.',
  templates: [
    {
      id: 'npl-mindread',
      label: 'Mindread',
      group: 'NPL',
      xml:
        '<npl-mindread confidence="${1:0.7}">\n' +
        '  <subject>${2:User}</subject>\n' +
        '  <signals><signal type="${3:tone}">${4:Signal}</signal></signals>\n' +
        '  <inferred>\n' +
        '    <motive>${5:Motive}</motive>\n' +
        '    <mood>${6:Mood}</mood>\n' +
        '    <cognitive>${7:Cognitive mode}</cognitive>\n' +
        '    <unspoken>${8:Unspoken}</unspoken>\n' +
        '  </inferred>\n' +
        '  <adaptation>${9:Adaptation}</adaptation>\n' +
        '</npl-mindread>',
    },
  ],
});
