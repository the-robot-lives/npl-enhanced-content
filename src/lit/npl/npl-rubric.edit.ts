/**
 * npl-rubric — edit descriptor (Phase 2, desc-npl-b lane).
 *
 * The `npl-criterion` children survive upgrade in authored position (the
 * weighted table is render output appended after them), so the criteria
 * are a working item list: +/− verbs resolve, and per-criterion fields
 * (name/weight/score) ride the property modal. `npl-overall-score` is
 * schema-surfaced as a number attribute; `title` mirrors to `data-title`
 * by the element (never authored by the editor).
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-rubric',
  title: 'Rubric',
  bucket: 'npl-b',
  summary: 'A weighted scoring rubric with an overall figure.',
  itemList: {
    childSelector: ':scope > :is(npl-criterion, .npl-criterion)',
    label: 'criterion',
    template: {
      id: 'npl-criterion',
      label: 'Criterion',
      xml: '<npl-criterion name="${1:Criterion}" weight="1" score="1"></npl-criterion>',
    },
  },
  templates: [
    {
      id: 'npl-rubric',
      label: 'Rubric',
      group: 'NPL',
      xml:
        '<npl-rubric title="${1:Title}">\n' +
        '  <npl-criterion name="${2:Criterion}" weight="3" score="4"></npl-criterion>\n' +
        '  <npl-criterion name="${3:Criterion}" weight="1" score="5"></npl-criterion>\n' +
        '  <npl-overall-score value="4.2"></npl-overall-score>\n' +
        '</npl-rubric>',
    },
  ],
});
