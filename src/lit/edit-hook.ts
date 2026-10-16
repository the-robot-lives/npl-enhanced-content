/**
 * edit-hook — the ONLY editor code the core bundle carries (EDITOR.md §4.1).
 *
 * A queue plus one dynamic import: a SemElement that is itself `edit-mode`
 * (or sits under a `<sem-editor edit-mode>`) lands in `pending` and the
 * editor bundle is requested exactly once. When the bundle is already
 * loaded (`SemTextEditor.claim` exists) the element is handed over directly
 * — no import, no queue. Pages that host the bundle elsewhere point
 * `window.semtextEditorUrl` (or a `data-sem-editor-src` script attribute)
 * at it.
 *
 * Failure is silent by contract: editing is opt-in and a failed import
 * leaves every element rendering normally — no console throw, no retry.
 * The editor entry drains the queue via `drainPending()` (EDITOR.md §9.2).
 */

const pending = new Set<import('./base.js').SemElement>();
let loading = false;

export function queueEdit(el: import('./base.js').SemElement): void {
  const api = (globalThis as { SemTextEditor?: { claim?: (el: unknown) => void } }).SemTextEditor;
  if (api?.claim) {
    api.claim(el);
    return;
  }
  pending.add(el);
  if (loading) return;
  loading = true;
  const url =
    (globalThis as { semtextEditorUrl?: string }).semtextEditorUrl ??
    document.querySelector('script[data-sem-editor-src]')?.getAttribute('data-sem-editor-src') ??
    new URL('./semtext-editor.js', import.meta.url).href; // Vite rewrites; IIFE keeps fallbacks
  try {
    import(/* @vite-ignore */ url).catch(() => {
      loading = false; // silent: editing is opt-in
    });
  } catch {
    loading = false; // non-module context (IIFE): the page loads the bundle itself
  }
}

/** The editor entry's handoff: every element queued before the bundle loaded. */
export function drainPending(): Set<import('./base.js').SemElement> {
  const p = pending;
  pending.clear();
  return p;
}
