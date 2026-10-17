/**
 * npl-flag — edit descriptor (Phase 2, desc-npl-a lane).
 *
 * Attribute-driven row (name required, value optional) with no authored
 * text content: no text slots — the property modal owns name/value, and
 * the range validation (freq/factor/threshold) is the element's own
 * render-time warning. The hand descriptor exists for the insert template
 * (the fallback's empty-body snippet cannot author a valid flag) and the
 * outline title; as an item of `npl-flags` it is stamped from THAT tag's
 * item list.
 */

import { registerDescriptor } from '../../editor/schema/registry.js';

registerDescriptor({
  tag: 'npl-flag',
  title: 'Flag',
  bucket: 'npl-a',
  summary: 'One runtime flag row: a name/value pair the reader can click to apply.',
  templates: [
    {
      id: 'npl-flag',
      label: 'Flag',
      group: 'NPL',
      xml: '<npl-flag name="${1:calm_factor}" value="${2:0.5}"></npl-flag>',
    },
  ],
});
