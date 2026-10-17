/**
 * sem-data-join — edit descriptor (data bucket, Phase 2).
 *
 * A declaration, not a rendered dataset: the element IS its attribute list
 * (data-name/data-left/data-right/data-on, aliases name/left/right/on) and
 * has no text body — no slots, no item list, no link fields. Four required
 * fields ⇒ the brief's wizard bar (>2); the wizard authors the canonical
 * data-* spelling (the elements.json example shows the aliases, but
 * canonical attrs keep the validator quiet — alias-attr is a warning).
 *
 * Templates mirror the example's authoring form (open tag, blank body,
 * close on its own line).
 */

import { registerDescriptor } from '../editor/schema/registry.js';

registerDescriptor({
  tag: 'sem-data-join',
  title: 'Data join',
  bucket: 'data',
  summary: 'A declared inner join of two named buckets, addressable as a bucket itself.',
  templates: [
    {
      id: 'sem-data-join',
      label: 'Data join',
      group: 'Data',
      xml:
        '<sem-data-join data-name="${1:data-name}" data-left="${2:data-left}" data-right="${3:data-right}"' +
        ' data-on="${4:data-on}">\n' +
        '</sem-data-join>',
    },
  ],
  wizard: {
    steps: [
      {
        title: 'Data join',
        fields: [
          { name: 'data-name', label: 'Join result name', type: 'text', required: true, placeholder: 'user-orders' },
          { name: 'data-left', label: 'Left bucket', type: 'text', required: true, placeholder: 'Users' },
          { name: 'data-right', label: 'Right bucket', type: 'text', required: true, placeholder: 'Orders' },
          { name: 'data-on', label: 'Key column', type: 'text', required: true, placeholder: 'user-id' },
        ],
        template: {
          id: 'sem-data-join-wizard',
          label: 'Data join',
          xml:
            '<sem-data-join data-name="${1:data-name}" data-left="${2:data-left}" data-right="${3:data-right}"' +
            ' data-on="${4:data-on}">\n' +
            '</sem-data-join>',
        },
      },
    ],
  },
});
