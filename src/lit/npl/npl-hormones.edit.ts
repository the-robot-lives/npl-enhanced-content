/**
 * npl-hormones — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * The authored contract is the source pump's markup: `<h>` rows inside a
 * `<panel>`, plus `state` / `triggered` / `alert` blocks. The hormone rows
 * are the item list — nested one level inside `<panel>`, which the +/−
 * verbs still handle (the controller resolves the item's model id through
 * the authored chain and inserts after the last row INSIDE the panel).
 * Class aliases are not part of this tag's contract (the component reads
 * bare part tags only), so the selectors stay bare.
 *
 * No `rerender` yet: the element snapshots its rows once (`#wired` guard,
 * `#read()` renders from state, never re-reads) with no exported seam.
 * Cross-lane request filed for an exported `readHormonesElement(el)` (or an
 * idempotent re-read in `updated()`); until then a post-edit re-render
 * restores the authored form and the row display refreshes on the next
 * full element update.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

const HORMONE = ':scope > panel > h';
const STATE = ':scope > state';
const TRIGGERED = ':scope > triggered';
const ALERT = ':scope > alert';

registerDescriptor({
  tag: 'npl-hormones',
  title: 'Hormones',
  bucket: 'npl-a',
  summary: 'Synthetic-hormones pump render: hormone bars, state line and threshold alerts.',
  textSlots: [
    { selector: STATE, label: 'State', placeholder: 'Current state…', escape: 'entities' },
    { selector: TRIGGERED, label: 'Triggered', placeholder: 'What fired…', escape: 'entities' },
    {
      selector: ALERT,
      label: 'Alert',
      multiline: true,
      placeholder: 'Alert body…',
      escape: 'entities',
    },
  ],
  itemList: {
    childSelector: HORMONE,
    label: 'hormone',
    template: {
      id: 'npl-hormones-row',
      label: 'Hormone',
      group: 'NPL',
      xml:
        '<h name="${1:Momentum}" symbol="${2:MTM}" value="${3:6}" delta="${4:0}" trigger="${5:Cause}"></h>',
    },
  },
  templates: [
    {
      id: 'npl-hormones',
      label: 'Hormones',
      group: 'NPL',
      xml:
        '<npl-hormones variant="${1|panel,bars,alert|}">\n' +
        '  <panel>\n' +
        '    <h name="${2:Momentum}" symbol="${3:MTM}" value="${4:6}" delta="${5:+2}" trigger="${6:Tests passed first try}"></h>\n' +
        '  </panel>\n' +
        '  <state>${7:Productive tension}</state>\n' +
        '  <triggered>${8:MTM threshold crossed}</triggered>\n' +
        '</npl-hormones>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Hormones',
        fields: [
          { name: 'variant', label: 'Variant', type: 'select', options: ['panel', 'bars', 'alert'] },
          { name: 'name', label: 'Hormone name', type: 'text', required: true, placeholder: 'Momentum' },
          { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'MTM' },
          { name: 'value', label: 'Value (-10 to 10)', type: 'number', required: true, placeholder: '6' },
          { name: 'delta', label: 'Delta', type: 'text', placeholder: '+2' },
          { name: 'trigger', label: 'Trigger', type: 'text', placeholder: 'Tests passed first try' },
          { name: 'state', label: 'State line', type: 'text', placeholder: 'Productive tension' },
        ],
        template: {
          id: 'npl-hormones-wizard',
          label: 'Hormones',
          group: 'NPL',
          xml:
            '<npl-hormones variant="${1:panel}">\n' +
            '  <panel>\n' +
            '    <h name="${2:Momentum}" symbol="${3:MTM}" value="${4:6}" delta="${5:0}" trigger="${6:Cause}"></h>\n' +
            '  </panel>\n' +
            '  <state>${7:Productive tension}</state>\n' +
            '</npl-hormones>',
        },
      },
    ],
  },
});
