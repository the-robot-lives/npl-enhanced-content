/**
 * reading/data-load — the fetch layer for sem-data-source (phase 4).
 *
 * Spec: spec/data-visualizer.md §9. Policy decisions live in
 * src/data/load.ts (pure, unit-tested); this module executes them: one
 * in-flight fetch per URL per page load (the in-memory cache), and the
 * credentials contract. DOM sequencing (pending placeholder → table/error)
 * stays in src/reading/data.ts.
 */

export const sourceCache = new Map<string, Promise<string>>();

/**
 * Fetch a source body. Cached by URL (one fetch per URL per page load);
 * `data-cache="no"` bypasses both the read and the write. A failed fetch is
 * NOT cached — a transient network error must not poison the page.
 */
export function fetchSource(url: string, noCache = false): Promise<string> {
  if (!noCache && sourceCache.has(url)) return sourceCache.get(url) as Promise<string>;
  const p = fetch(url, { credentials: 'same-origin' }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  });
  if (!noCache) {
    sourceCache.set(url, p);
    p.catch(() => {
      if (sourceCache.get(url) === p) sourceCache.delete(url);
    });
  }
  return p;
}
