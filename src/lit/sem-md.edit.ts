/**
 * sem-md — edit descriptor (prose bucket, Phase 2).
 *
 * sem-md's authored content is ONE Markdown text node, but the DOM the
 * controller sees is the element's own enhancement: chrome, the rendered
 * `.sem-md-body`, and the `.sem-md-raw` fence whose `<code>` carries the
 * source byte-identically (src/md/element.ts consumes the text). The slot
 * therefore targets the fence's `<code>`, and `regions()` re-anchors every
 * node inside the fence to the host's model id — the mapping the controller
 * resolves at runtime (EDITOR.md §3.3); positional indexing cannot cross
 * the rendered wrappers.
 *
 * No `rerender`: the element rebuilds its own chrome from a presence guard
 * (`.sem-md-chrome`), so the §4.4 re-render's requestUpdate path re-runs
 * `enhanceMdElement` on the re-projected text without a descriptor seam.
 * There is no item list — the content is one text block, not repeatable
 * children.
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { bindingFor } from '../editor/controller/attach.js';
import type { RegionMap } from '../editor/schema/types.js';

/** Model id of every node inside the raw fence (the host's own subtree). */
function fenceRegions(el: HTMLElement): RegionMap | null {
  const root = bindingFor(el)?.rootId;
  if (root === undefined) return null;
  return [{ selector: '.sem-md-raw, .sem-md-raw *', nodeId: root }];
}

registerDescriptor({
  tag: 'sem-md',
  title: 'Markdown',
  bucket: 'prose',
  summary: 'A block authored as Markdown and rendered to HTML in the browser.',
  textSlots: [
    {
      // the enhanced form: the raw fence's code holds the source verbatim
      selector: ':scope > .sem-md-raw code',
      label: 'Markdown source',
      multiline: true,
      placeholder: 'Markdown…',
      escape: 'entities',
    },
  ],
  regions: fenceRegions,
  templates: [
    {
      id: 'sem-md',
      label: 'Markdown block',
      group: 'Prose',
      xml: '<sem-md label="${1:Caption}">${2:Markdown **text**}</sem-md>',
    },
    {
      id: 'sem-md-table',
      label: 'Markdown table',
      group: 'Prose',
      xml:
        '<sem-md label="${1:Caption}">\n' +
        '  ${2:| Column | Column |\n' +
        '  | ------ | ------ |\n' +
        '  | cell   | cell   |}\n' +
        '</sem-md>',
    },
    {
      id: 'sem-md-raw',
      label: 'Markdown (raw view)',
      group: 'Prose',
      xml: '<sem-md view-as="raw" label="${1:Caption}">${2:Markdown **text**}</sem-md>',
    },
  ],
});
