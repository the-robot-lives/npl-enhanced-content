/**
 * data/names — bucket-reference naming (spec/data-visualizer.md §5).
 * Shared by the source layer (bucket registration), the join element and the
 * query engine, so it lives in a leaf module (no import cycles).
 */

/** §5: lowercase; runs of non-alphanumerics collapse to one `-`; edge `-` trimmed. */
export function normalizeRef(ref: string): string {
  return ref.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
