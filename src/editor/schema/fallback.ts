/**
 * Editor schema service — the attributes-only fallback descriptor.
 *
 * Every tag is editable even with zero authored descriptor (EDITOR.md §3.2):
 * descriptors ENRICH, they do not enable. The fallback grants the property
 * modal (from the schema attribute form), the full context menu minus
 * descriptor-only verbs, and one minimal insert template — and no text
 * slots, item lists, or wizards.
 */

import type { EditDescriptor, SchemaTagSpec } from './types.js';

/** Humanize a tag name for the fallback title: `sem-note` → `Note`,
 *  `npl-mood` → `Mood`. */
export function humanizeTag(name: string): string {
  const stem = name.replace(/^(sem|npl)-/i, '');
  return stem
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build the attributes-only descriptor for a schema tag. `bucket` is a
 * documented GUESS from the family (npl → npl-a, else prose): bucket only
 * steers inserter grouping, and Phase 2's per-bucket lanes replace the
 * fallback with hand descriptors carrying the real bucket.
 */
export function attributesOnlyDescriptor(spec: SchemaTagSpec): EditDescriptor {
  const title = humanizeTag(spec.name);
  return {
    tag: spec.name,
    title,
    bucket: spec.family === 'npl' ? 'npl-a' : 'prose',
    summary: spec.summary || undefined,
    templates: [
      {
        id: spec.name,
        label: title,
        xml: `<${spec.name}>\n  \${1:}\n</${spec.name}>`,
      },
    ],
  };
}
