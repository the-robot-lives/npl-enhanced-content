/**
 * npl-directive — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * The authored content is the element's own unwrapped body: the
 * instruction text, optionally `instruction | elaboration` (the elaboration
 * rides the chip's title tooltip; the element's `#chip()` re-wrap is
 * presence-guarded, so the protocol's `requestUpdate()` re-establishes the
 * glyph/body/qualifier chrome — no `rerender` seam needed). Single-line
 * slot: a directive chip is one line by contract.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-directive',
  title: 'Directive',
  bucket: 'npl-a',
  summary: 'Inline directive chip: glyph, instruction and optional elaboration.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Instruction',
      placeholder: 'instruction | elaboration',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-directive',
      label: 'Directive chip',
      group: 'NPL',
      xml:
        '<npl-directive glyph="${1:🔮}" kind="${2|directive,prefix|}" qualifier="${3:style}">' +
        '${4:be terse | because the reader is skimming}</npl-directive>',
    },
    {
      id: 'npl-directive-bare',
      label: 'Directive chip (bare)',
      group: 'NPL',
      xml: '<npl-directive glyph="${1:✅}">${2:instruction}</npl-directive>',
    },
  ],
});
