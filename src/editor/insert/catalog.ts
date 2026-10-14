/**
 * insert/catalog — the block inserter's tiles (EDITOR.md §5.5 road 3).
 *
 * One entry per schema tag (+ sem-chat), built from the descriptor registry
 * (hand descriptor where a Phase-2 lane registered one, attributes-only
 * fallback otherwise — every tag has an entry by construction). Grouping
 * follows `descriptor.bucket`, in EditBucket declaration order.
 */

import { getDescriptor, getTag, loadSchema } from '../schema/index.js';
import type { EditBucket, SchemaTagSpec, TemplateSnippet } from '../schema/types.js';
import type { EditorDocument } from '../model/types.js';
import type { InsertEntry, InsertGroup, InsertTarget } from './types.js';
import { allowedTagsAt } from './placement.js';

/** Display order + labels for the bucket groups. */
export const BUCKET_ORDER: readonly EditBucket[] = [
  'document',
  'prose',
  'disclosure',
  'views',
  'data',
  'code',
  'npl-a',
  'npl-b',
];

export const BUCKET_LABELS: Record<EditBucket, string> = {
  document: 'Document & structure',
  prose: 'Prose & code',
  disclosure: 'Disclosure & reveal',
  views: 'Views & perspectives',
  data: 'Data & tables',
  sequence: 'Sequences & timelines',
  definitions: 'Properties & references',
  recall: 'Facts & quizzes',
  code: 'Code & machines',
  'npl-a': 'NPL reasoning (a–m)',
  'npl-b': 'NPL reasoning (n–z)',
};

/** sem-chat rides the data bucket until the data lane registers its real
 *  descriptor (the fallback guesses `prose`; the brief assigns it to data). */
const BUCKET_OVERRIDES: ReadonlyMap<string, EditBucket> = new Map([['sem-chat', 'data']]);

/** Minimal authoring form for a tag with no descriptor template: required
 *  attributes that carry a schema default are pre-filled; everything else
 *  is completed through the property modal (validator warns, never blocks). */
export function minimalTemplate(spec: SchemaTagSpec): TemplateSnippet {
  const fills = spec.attributes
    .filter((a) => a.required && a.default !== null && a.default !== '')
    .map((a) => `${a.name}="${a.default}"`);
  const attrs = fills.length > 0 ? ' ' + fills.join(' ') : '';
  return {
    id: `${spec.name}:minimal`,
    label: spec.name,
    xml: `<${spec.name}${attrs}></${spec.name}>`,
  };
}

let cachedCatalog: InsertEntry[] | null = null;

/** Every insertable tag, schema order (stable tile order within groups). */
export function insertCatalog(): readonly InsertEntry[] {
  if (cachedCatalog !== null) return cachedCatalog;
  const entries: InsertEntry[] = [];
  const push = (spec: SchemaTagSpec): void => {
    const descriptor = getDescriptor(spec.name);
    if (descriptor === null) return;
    const template = descriptor.templates?.[0] ?? minimalTemplate(spec);
    entries.push({
      tag: spec.name.toLowerCase(),
      title: descriptor.title,
      summary: descriptor.summary ?? spec.summary,
      bucket: BUCKET_OVERRIDES.get(spec.name.toLowerCase()) ?? descriptor.bucket,
      template,
      wizard: descriptor.wizard ?? null,
    });
  };
  for (const spec of loadSchema().tags) push(spec);
  const chat = getTag('sem-chat');
  if (chat !== undefined) push(chat);
  cachedCatalog = entries;
  return entries;
}

/** Group entries by bucket in display order; empty buckets are dropped. */
export function groupEntries(entries: readonly InsertEntry[]): InsertGroup[] {
  const groups: InsertGroup[] = [];
  for (const bucket of BUCKET_ORDER) {
    const inBucket = entries.filter((e) => e.bucket === bucket);
    if (inBucket.length > 0) groups.push({ bucket, label: BUCKET_LABELS[bucket], entries: inBucket });
  }
  return groups;
}

/** The entries placement permits at `target`, catalog order. */
export function entriesForTarget(doc: EditorDocument, target: InsertTarget): InsertEntry[] {
  const allowed = allowedTagsAt(doc, target.parentId);
  return insertCatalog().filter((e) => allowed.has(e.tag));
}

/** Case-insensitive substring filter over title/tag/summary. */
export function filterEntries(entries: readonly InsertEntry[], query: string): InsertEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...entries];
  return entries.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.tag.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q),
  );
}
