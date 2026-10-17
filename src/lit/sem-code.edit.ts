/**
 * sem-code — edit descriptor (prose bucket, Phase 2).
 *
 * The listing is the authored `<pre><code>` (one text node — whitespace is
 * content), so the slots target it directly and positional mapping works;
 * the `:scope > pre` fallback covers the no-`<code>` authoring form
 * (elements.json: "the `<pre>`'s when no `<code>` is authored").
 *
 * `rerender` is the one-shot-wrapper seam (EDITOR.md §3.3): SemCode latches
 * its enhance behind `#wired`, so the §4.4 re-render needs the descriptor
 * to re-run it. The re-added chrome is stamped `data-sem-chrome` so the
 * controller's authored-child indexing skips it — without the stamp the
 * chrome div at index 0 shifts every positional mapping and the second
 * edit after a re-render cannot resolve the `<pre>`.
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { enhanceCodeElement } from '../reading/code.js';

registerDescriptor({
  tag: 'sem-code',
  title: 'Code',
  bucket: 'prose',
  summary: 'A source listing with provenance.',
  textSlots: [
    {
      selector: ':scope > pre > code',
      label: 'Listing',
      multiline: true,
      placeholder: 'Source code…',
      escape: 'entities',
    },
    {
      // no <code> authored: the listing is the <pre>'s own text
      selector: ':scope > pre',
      label: 'Listing',
      multiline: true,
      placeholder: 'Source code…',
      escape: 'entities',
    },
  ],
  rerender(el) {
    enhanceCodeElement(el);
    // editor-side chrome marker: never authored content, never indexed,
    // kept in place by the re-render's cleanup (map.ts isChromeNode)
    el.querySelector(':scope > .sem-code-chrome')?.setAttribute('data-sem-chrome', '');
  },
  templates: [
    {
      id: 'sem-code',
      label: 'Code listing',
      group: 'Prose',
      xml:
        '<sem-code lang="${1:ts}" filename="${2:src/example.ts}">\n' +
        '<pre><code>${3:source}</code></pre>\n' +
        '</sem-code>',
    },
    {
      id: 'sem-code-marks',
      label: 'Listing with marked lines',
      group: 'Prose',
      xml:
        '<sem-code lang="${1:ts}" mark="${2:2,4-5}">\n' +
        '<pre><code>${3:source}</code></pre>\n' +
        '</sem-code>',
    },
    {
      id: 'sem-code-wrap',
      label: 'Soft-wrapped listing',
      group: 'Prose',
      xml:
        '<sem-code lang="${1:ts}" wrap controls="copy,wrap">\n' +
        '<pre><code>${2:source}</code></pre>\n' +
        '</sem-code>',
    },
  ],
});
