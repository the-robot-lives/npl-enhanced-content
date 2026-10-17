/**
 * insert-css — the insert lane's own paint (EDITOR.md §9.3).
 *
 * `sem-ed-*` classes only; injected once per document with the lane guard
 * marker (`data-sem-ed-block="insert"`) so parallel lanes never double-
 * inject. Motion gates on `prefers-reduced-motion` (§7).
 */

export const INSERT_CSS_ID = 'sem-ed-insert-css';

export const INSERT_CSS = `
/* ── block-inserter panel (dialog) ─────────────────────────────────────── */
.sem-ed-ins-search { margin: 0.4rem 0.9rem 0.2rem; }
.sem-ed-ins-search .sem-ed-input { width: 100%; box-sizing: border-box; }
.sem-ed-ins-body { padding: 0.4rem 0.9rem 0.9rem; overflow: auto; max-height: 55vh; }
.sem-ed-ins-group { margin-block: 0.5rem; }
.sem-ed-ins-group-label {
  font-size: 0.8em; font-weight: 600; letter-spacing: 0.02em;
  opacity: 0.75; margin: 0.35rem 0 0.25rem;
}
.sem-ed-ins-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.35rem; }
.sem-ed-ins-tile {
  font: inherit; color: inherit; text-align: start; cursor: pointer;
  background: transparent; border-radius: 6px; padding: 0.4rem 0.55rem;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}
.sem-ed-ins-tile:hover { border-color: color-mix(in srgb, currentColor 45%, transparent); }
.sem-ed-ins-tile:focus-visible { outline: 2px solid var(--sem-focus, currentColor); outline-offset: 1px; }
.sem-ed-ins-tile-title { display: block; font-weight: 600; }
.sem-ed-ins-tile-tag { display: block; font-family: ui-monospace, monospace; font-size: 0.78em; opacity: 0.7; }
.sem-ed-ins-tile-summary {
  display: block; font-size: 0.8em; opacity: 0.8; margin-top: 0.15rem;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.sem-ed-ins-empty { padding: 0.8rem 0.2rem; opacity: 0.75; font-style: italic; }
.sem-ed-ins-hint { margin: 0 0.9rem 0.4rem; font-size: 0.82em; opacity: 0.7; }

/* ── `+` between blocks (canvas chrome; hover/focus reveal) ────────────── */
.sem-ed-ins-plus {
  font: inherit; cursor: pointer; line-height: 1;
  width: 1.5rem; height: 1.5rem; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: inherit; background: var(--sem-surface, canvas);
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  border-radius: 999px; opacity: 0.55; margin: 0.1rem auto;
}
.sem-ed-ins-plus:hover,
.sem-ed-ins-plus:focus-visible { opacity: 1; outline: 2px solid var(--sem-focus, currentColor); outline-offset: 1px; }
.sem-ed-ins-plus-zone { display: flex; justify-content: center; }
@media (hover: hover) {
  /* pointer devices reveal the affordance only near the gap */
  .sem-ed-ins-plus-zone .sem-ed-ins-plus { opacity: 0; }
  .sem-ed-ins-plus-zone:hover .sem-ed-ins-plus,
  .sem-ed-ins-plus-zone:focus-within .sem-ed-ins-plus { opacity: 0.85; }
}
.sem-ed-ins-plus-zone { transition: opacity 120ms ease; }

/* ── slash menu (small popover list) ───────────────────────────────────── */
.sem-ed-ins-menu {
  position: absolute; z-index: 40; min-width: 15rem; max-width: 22rem;
  max-height: 18rem; overflow: auto; padding: 0.25rem;
  color: inherit; background: var(--sem-surface, canvas);
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 8px; box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
}
.sem-ed-ins-menu .sem-ed-input { width: 100%; box-sizing: border-box; margin-bottom: 0.25rem; }
.sem-ed-ins-menu-item {
  display: flex; gap: 0.5rem; align-items: baseline; width: 100%;
  font: inherit; color: inherit; text-align: start; cursor: pointer;
  background: transparent; border: 0; border-radius: 4px; padding: 0.25rem 0.45rem;
}
.sem-ed-ins-menu-item[aria-selected="true"] { background: color-mix(in srgb, currentColor 12%, transparent); }
.sem-ed-ins-menu-item:focus-visible { outline: 2px solid var(--sem-focus, currentColor); outline-offset: -2px; }
.sem-ed-ins-menu-item .sem-ed-ins-tile-tag { flex: 1; text-align: end; }

/* ── wizard ────────────────────────────────────────────────────────────── */
.sem-ed-ins-steps { font-size: 0.85em; opacity: 0.75; padding: 0.35rem 0.9rem 0; }
.sem-ed-ins-preview {
  margin: 0.4rem 0.9rem; padding: 0.5rem; max-height: 9rem; overflow: auto;
  font-family: ui-monospace, monospace; font-size: 0.8em; white-space: pre-wrap;
  border: 1px dashed color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 6px; background: color-mix(in srgb, currentColor 4%, transparent);
}
.sem-ed-ins-preview-label { margin: 0.4rem 0.9rem 0; font-size: 0.8em; opacity: 0.7; }

@media (prefers-reduced-motion: reduce) {
  .sem-ed-ins-plus-zone { transition: none; }
}
`;
