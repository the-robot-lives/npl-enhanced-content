/**
 * npl-critique — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * Five child parts in two authoring forms each (bare part tag inside the
 * element-form block, or the `.npl-<part>` class alias — the component's
 * own constants). Subject, perspective and verdict are single text blocks
 * → slots; strengths/weaknesses each hold a REPEATED item list, and the
 * single-descriptor `itemList` cannot express two sibling lists — item
 * add/remove there goes through the property modal's sub-item editor and
 * the model ops (test covers one via insertNode/removeNode), not +/− glyphs.
 *
 * No `rerender` yet: the element structures parts once (`#wired` guard,
 * part classes + list rewrite) with no exported idempotent seam. Cross-lane
 * request filed for an exported `enhanceCritiqueElement(el)`.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

const SUBJECT = ':scope > :is(subject, .npl-subject)';
const PERSPECTIVE = ':scope > :is(perspective, .npl-perspective)';
const VERDICT = ':scope > :is(verdict, .npl-verdict)';

registerDescriptor({
  tag: 'npl-critique',
  title: 'Critique',
  bucket: 'npl-a',
  summary: 'Structured critique of one subject from one perspective, with a verdict.',
  textSlots: [
    { selector: SUBJECT, label: 'Subject', placeholder: 'The thing under critique…', escape: 'entities' },
    { selector: PERSPECTIVE, label: 'Perspective', placeholder: 'The lens — e.g. security reviewer', escape: 'entities' },
    {
      selector: VERDICT,
      label: 'Verdict',
      multiline: true,
      placeholder: 'The closing judgement…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-critique',
      label: 'Critique',
      group: 'NPL',
      xml:
        '<npl-critique id="${1:c1}">\n' +
        '  <subject>${2:Subject}</subject>\n' +
        '  <perspective>${3:Perspective}</perspective>\n' +
        '  <strengths><item>${4:Strength}</item></strengths>\n' +
        '  <weaknesses><item>${5:Weakness}</item></weaknesses>\n' +
        '  <verdict>${6:Verdict}</verdict>\n' +
        '</npl-critique>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Critique',
        fields: [
          { name: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'The launch prompt' },
          { name: 'perspective', label: 'Perspective', type: 'text', required: true, placeholder: 'security reviewer' },
          { name: 'strength', label: 'One strength', type: 'text', placeholder: 'explicit failure modes' },
          { name: 'weakness', label: 'One weakness', type: 'text', placeholder: 'no examples' },
          { name: 'verdict', label: 'Verdict', type: 'textarea', required: true, placeholder: 'ship after one revision' },
        ],
        template: {
          id: 'npl-critique-wizard',
          label: 'Critique',
          group: 'NPL',
          xml:
            '<npl-critique>\n' +
            '  <subject>${1:Subject}</subject>\n' +
            '  <perspective>${2:Perspective}</perspective>\n' +
            '  <strengths><item>${3:Strength}</item></strengths>\n' +
            '  <weaknesses><item>${4:Weakness}</item></weaknesses>\n' +
            '  <verdict>${5:Verdict}</verdict>\n' +
            '</npl-critique>',
        },
      },
    ],
  },
});
