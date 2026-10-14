/**
 * sem-fact — edit descriptor (recall bucket, Phase 2).
 *
 * The atomic assertable unit of `sem-facts` (spec/schema/sem-facts.md). Its
 * authored parts — `statement`, `conclusion`, the optional
 * `incorrect-statement` — are THIS descriptor's text slots (EDITOR.md §3.3
 * names them: `part('statement')`…); the parts are slots of the fact, never
 * standalone elements, so they ship no descriptors of their own.
 *
 * Slot order is load-bearing (first match wins, §3.3): the three part slots
 * precede the compact-form slot. The `statement :: conclusion` compact form
 * makes the element's own text the slot — `:scope` is the contract's
 * unwrapped-content form (controller/map.ts resolveSlotEl). On an
 * element-form fact the compact slot still matches the host, but element
 * children then block the inline edit and the controller announces the
 * refusal instead of flattening authored markup (§4.5).
 *
 * The class-alias spellings are uneven (conventions Appendix A):
 * `.sem-statement`, `.sem-conclusion`, but `.incorrect-statement` — the
 * incorrect-part selector lists all three spellings; `part()` alone would
 * miss the documented `.incorrect-statement` form.
 *
 * No itemList: a fact IS the item — `sem-facts` (the pilot) owns the
 * collection's +/−. No regions/rerender: bare light-DOM markup, nothing
 * regrouped, no runtime chrome to re-establish.
 *
 * Bucket: the recall family (web/data/reference-buckets.ts in
 * semtext.dev); `EditBucket` does not carry `'recall'` yet — `'data'` is
 * the pilot-consistent stand-in (see the desc-recall lane report for the
 * exact union patch).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { part } from '../shared/sel.js';

const INCORRECT_PART = ':is(incorrect-statement, .incorrect-statement, .sem-incorrect-statement)';

registerDescriptor({
  tag: 'sem-fact',
  title: 'Fact',
  bucket: 'data', // recall family — see header note
  textSlots: [
    {
      selector: ':scope > ' + part('statement'),
      label: 'Statement',
      multiline: true,
      placeholder: 'The claim…',
      escape: 'entities',
    },
    {
      selector: ':scope > ' + part('conclusion'),
      label: 'Conclusion',
      multiline: true,
      placeholder: 'What the claim resolves to…',
      escape: 'entities',
    },
    {
      selector: ':scope > ' + INCORRECT_PART,
      label: 'Incorrect statement',
      multiline: true,
      placeholder: 'Deliberately wrong candidate…',
      escape: 'entities',
    },
    {
      // compact form: the whole fact is one `statement :: conclusion` text
      selector: ':scope',
      label: 'Compact fact',
      placeholder: 'Statement :: conclusion',
      escape: 'entities',
    },
  ],
  containerOf: 'sem-facts',
  templates: [
    {
      id: 'sem-fact',
      label: 'Fact',
      group: 'Recall',
      xml:
        '<sem-fact id="${1:fact-id}">\n' +
        '  <statement>${2:The claim}</statement>\n' +
        '  <conclusion>${3:What the claim resolves to}</conclusion>\n' +
        '</sem-fact>',
    },
    {
      id: 'sem-fact-incorrect',
      label: 'Fact with wrong candidate',
      group: 'Recall',
      xml:
        '<sem-fact id="${1:fact-id}">\n' +
        '  <statement>${2:The claim}</statement>\n' +
        '  <conclusion>${3:What the claim resolves to}</conclusion>\n' +
        '  <incorrect-statement>${4:Deliberately wrong candidate}</incorrect-statement>\n' +
        '</sem-fact>',
    },
    {
      id: 'sem-fact-compact',
      label: 'Compact fact (:: form)',
      group: 'Recall',
      xml: '<sem-fact>${1:Statement :: conclusion}</sem-fact>',
    },
  ],
});
