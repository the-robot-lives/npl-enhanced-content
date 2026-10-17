/**
 * sem-source — edit descriptor (disclosure bucket, Phase 2).
 *
 * Transparent wrapper letting a reader flip between the rendered section
 * and its pre-enhancement markup. The authored children ARE the content —
 * arbitrary SemText, so there is NO text slot (a host slot would refuse
 * rich bodies; children edit through their own bindings or the code view).
 *
 * `rerender` is the contract's named seam (EDITOR.md §2.5, §3.3): the
 * element snapshots its authored markup into `template.sem-source-raw` at
 * upgrade; the §4.4 re-render removes that generated template (it is not
 * `data-sem-chrome`), so after any edit touching this subtree the snapshot
 * must be re-taken or the fence shows stale source. The class's empty-
 * comment strip is private, so the descriptor mirrors it (Lit `<!---->`
 * markers are runtime artefacts, never authored content).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { snapshotSourceElement } from '../vanilla/source.js';

function refreshSnapshot(el: HTMLElement): void {
  snapshotSourceElement(el);
  const tpl = el.querySelector<HTMLTemplateElement>(':scope > template.sem-source-raw');
  if (tpl === null) return;
  const strip = (parent: Node): void => {
    for (const n of [...parent.childNodes]) {
      if (n.nodeType === Node.COMMENT_NODE) {
        if (!(n.textContent || '').trim()) n.remove();
        continue;
      }
      strip(n);
    }
  };
  strip(tpl.content);
}

registerDescriptor({
  tag: 'sem-source',
  title: 'Source flip',
  bucket: 'disclosure',
  summary: 'Rendered section with a reader-facing markup fence.',
  rerender(el) {
    refreshSnapshot(el);
  },
  templates: [
    {
      id: 'sem-source',
      label: 'Source flip',
      group: 'Disclosure',
      xml:
        '<sem-source id="${1:source-id}" label="${2:Caption}">\n' +
        '  ${3:Content}\n' +
        '</sem-source>',
    },
    {
      id: 'sem-source-initial-source',
      label: 'Source flip (opens as source)',
      group: 'Disclosure',
      xml:
        '<sem-source id="${1:source-id}" label="${2:Caption}" view-as="source">\n' +
        '  ${3:Content}\n' +
        '</sem-source>',
    },
  ],
});
