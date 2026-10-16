/**
 * sem-reveal — edit descriptor (disclosure bucket, Phase 2).
 *
 * Q→A disclosure backed by native `<details>` at read time. The `summary`
 * attribute (optional — first body line derives it) and the `collapsed`
 * bare boolean are schema attributes, edited through the property modal;
 * the body is the host-is-slot form. Templates cover the three authoring
 * shapes: derived summary, explicit summary, starts-collapsed.
 *
 * No `regions`/`rerender`: the `<details>`/`<summary>` wrapper is built by
 * the page's reading pass (fallback/reveal enhanceReveal), which MOVES the
 * authored children into `details > .sem-reveal-body`. Inside the editor
 * canvas the authored form is canonical (documents load via IO, the inert
 * projection never runs enhancers), so the wrapper never exists here; a
 * regions map re-anchoring `.sem-reveal-body` would need the binding's
 * root id, which descriptors do not have (report note).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-reveal',
  title: 'Reveal',
  bucket: 'disclosure',
  summary: 'A Q→A disclosure — exposition, not an assertion.',
  textSlots: [
    {
      selector: ':scope',
      label: 'Reveal body',
      multiline: true,
      placeholder: 'Answer body…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'sem-reveal',
      label: 'Reveal',
      group: 'Disclosure',
      xml: '<sem-reveal>\n  ${1:Answer body}\n</sem-reveal>',
    },
    {
      id: 'sem-reveal-summary',
      label: 'Reveal (labeled)',
      group: 'Disclosure',
      xml: '<sem-reveal summary="${1:Question}">\n  ${2:Answer body}\n</sem-reveal>',
    },
    {
      id: 'sem-reveal-collapsed',
      label: 'Reveal (starts closed)',
      group: 'Disclosure',
      xml: '<sem-reveal summary="${1:Question}" collapsed>\n  ${2:Answer body}\n</sem-reveal>',
    },
  ],
});
