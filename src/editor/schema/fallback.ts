/**
 * Editor schema service — the attributes-only fallback descriptor.
 *
 * Every tag is editable even with zero authored descriptor (EDITOR.md §3.2):
 * descriptors ENRICH, they do not enable. The fallback grants the property
 * modal (from the schema attribute form), the full context menu minus
 * descriptor-only verbs, and one minimal insert template — and no text
 * slots, item lists, or wizards.
 */

import type { EditBucket, EditDescriptor, SchemaTagSpec } from './types.js';

/** Humanize a tag name for the fallback title: `sem-note` → `Note`,
 *  `npl-mood` → `Mood`, `agent-kit-issue` → `Issue`. */
export function humanizeTag(name: string): string {
  const stem = name.replace(/^(sem|npl|semext|agent-kit)-/i, '');
  return stem
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Family → fallback bucket. Bucket only steers inserter grouping, and
 *  Phase 2's per-bucket lanes replace the fallback with hand descriptors
 *  carrying the real bucket; a family with no better guess lands prose. */
const FAMILY_BUCKET: Record<string, EditBucket> = {
  sem: 'prose',
  npl: 'npl-a',
  semext: 'semext',
  'agent-kit': 'agent-kit',
};

/**
 * Build the attributes-only descriptor for a schema tag. `bucket` is a
 * documented GUESS from the family (npl → npl-a, semext → semext,
 * agent-kit → agent-kit, else prose): so schema-driven entries for the new
 * namespaces never masquerade as prose, and hand descriptors later carry
 * the real bucket.
 */
export function attributesOnlyDescriptor(spec: SchemaTagSpec): EditDescriptor {
  const title = humanizeTag(spec.name);
  return {
    tag: spec.name,
    title,
    bucket: FAMILY_BUCKET[spec.family] ?? 'prose',
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
