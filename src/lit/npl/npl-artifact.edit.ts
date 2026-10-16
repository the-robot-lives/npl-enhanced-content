/**
 * npl-artifact — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * Authored children carry the data: `title` and `content`, in the bare-tag
 * form or the `.npl-title` / `.npl-content` class aliases (both spellings
 * are declared, per EDITOR.md §3.3). Both parts are singletons — no item
 * list; the wizard guides the type/title/content insert.
 *
 * No `rerender` yet: the element enhances once (`#enhanced` guard) and its
 * conversion (title→h3, content→pre|sandboxed iframe) has no exported
 * idempotent seam to re-run. Cross-lane request filed for an exported
 * `enhanceArtifactElement(el)`; until it lands the protocol's
 * `requestUpdate()` restores the authored form after edits, which stays
 * correct (chrome is presentation, the model is truth).
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

const TITLE = ':scope > :is(title, .npl-title)';
const CONTENT = ':scope > :is(content, .npl-content)';

registerDescriptor({
  tag: 'npl-artifact',
  title: 'Artifact',
  bucket: 'npl-a',
  summary: 'A structured output block with metadata — generated code, a report, a figure.',
  textSlots: [
    { selector: TITLE, label: 'Title', placeholder: 'Artifact title…', escape: 'entities' },
    {
      selector: CONTENT,
      label: 'Content',
      multiline: true,
      placeholder: 'Artifact content…',
      escape: 'entities',
    },
  ],
  templates: [
    {
      id: 'npl-artifact',
      label: 'Artifact',
      group: 'NPL',
      xml:
        '<npl-artifact type="${1|code,text,svg|}">\n' +
        '  <title>${2:Title}</title>\n' +
        '  <content>${3:Content}</content>\n' +
        '</npl-artifact>',
    },
    {
      id: 'npl-artifact-svg',
      label: 'SVG figure',
      group: 'NPL',
      xml:
        '<npl-artifact type="svg">\n' +
        '  <title>${1:Title}</title>\n' +
        '  <content><svg width="${2:320}" height="${3:120}"></svg></content>\n' +
        '</npl-artifact>',
    },
    {
      // class-alias authoring form (conventions Appendix A, npl namespace)
      id: 'npl-artifact-class',
      label: 'Artifact (class form)',
      group: 'NPL',
      xml:
        '<npl-artifact class="npl-artifact" data-type="${1:text}">\n' +
        '  <span class="npl-title">${2:Title}</span>\n' +
        '  <span class="npl-content">${3:Content}</span>\n' +
        '</npl-artifact>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Artifact',
        fields: [
          { name: 'type', label: 'Type', type: 'select', options: ['code', 'text', 'svg'] },
          { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Q3 revenue breakdown' },
          {
            name: 'content',
            label: 'Content',
            type: 'textarea',
            required: true,
            placeholder: 'The artifact body — code, prose or SVG markup',
          },
        ],
        template: {
          id: 'npl-artifact-wizard',
          label: 'Artifact',
          group: 'NPL',
          xml:
            '<npl-artifact type="${1:code}">\n' +
            '  <title>${2:Title}</title>\n' +
            '  <content>${3:Content}</content>\n' +
            '</npl-artifact>',
        },
      },
    ],
  },
});
