/**
 * shell-css — the `<sem-editor>` frame's own paint (EDITOR.md §9.3).
 *
 * All editor chrome classes are `sem-ed-*` (§0 reserved prefixes); the frame
 * itself reuses the `sem-window` vocabulary classes so the host's theme paints
 * it. Injected once per document as `<style data-sem-editor-css>`; the guard
 * marker (`data-sem-ed-block="shell"`) keeps parallel lanes from double-
 * injecting — integrate folds the lane strings into one `chrome-css.ts`
 * module in Phase 3 and retires the per-lane guards.
 */

export const SHELL_CSS_ID = 'sem-ed-shell-css';

export const SHELL_CSS = `
sem-editor { display: block; }

.sem-ed-frame { container: sem-editor / inline-size; }
.sem-ed-frame:focus-within { outline: 2px solid var(--sem-focus, currentColor); outline-offset: 1px; }

/* ── toolbar (one tab stop, roving arrows) ─────────────────────────────── */
.sem-ed-toolbar {
  display: flex; align-items: center; gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
}
.sem-ed-btn {
  font: inherit; color: inherit; background: transparent;
  border: 1px solid transparent; border-radius: 4px;
  padding: 0.15rem 0.5rem; cursor: pointer;
}
.sem-ed-btn:disabled { opacity: 0.45; cursor: default; }
.sem-ed-btn:focus-visible { outline: 2px solid var(--sem-focus, currentColor); outline-offset: 1px; }
.sem-ed-sep { width: 1px; align-self: stretch; margin: 0 0.35rem;
  background: color-mix(in srgb, currentColor 18%, transparent); }

.sem-ed-mode-group { display: inline-flex;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 6px; overflow: hidden; }
.sem-ed-mode { border-radius: 0;
  border-inline: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.sem-ed-mode[aria-checked="true"] {
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-weight: 600;
}

/* ── breadcrumb ────────────────────────────────────────────────────────── */
.sem-ed-crumbs {
  display: flex; flex-wrap: wrap; gap: 0.15rem; align-items: baseline;
  padding: 0.2rem 0.6rem; font-size: 0.85em;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.sem-ed-crumb {
  font: inherit; color: inherit; background: none; border: 0;
  padding: 0.05rem 0.25rem; border-radius: 4px; cursor: pointer;
}
.sem-ed-crumb[aria-current] { font-weight: 600; cursor: default; }
.sem-ed-crumb:focus-visible { outline: 2px solid var(--sem-focus, currentColor); }

/* ── body: outline rail + panes ────────────────────────────────────────── */
.sem-ed-body { display: flex; min-height: 0; flex: 1; }
.sem-ed-outline-host { display: contents; }

.sem-ed-outline {
  width: 14rem; min-width: 10rem; overflow: auto;
  border-inline-end: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  padding: 0.25rem 0;
}
.sem-ed-outline-label {
  font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em;
  margin: 0 0.5rem 0.25rem; opacity: 0.7;
}
.sem-ed-outline-item {
  display: flex; align-items: baseline; gap: 0.4rem;
  padding: 0.12rem 0.5rem;
  padding-inline-start: calc(0.5rem + var(--sem-ed-depth, 0) * 0.9rem);
  cursor: pointer; border-radius: 4px; margin-inline: 0.15rem;
}
.sem-ed-outline-item:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.sem-ed-outline-item[aria-selected="true"] {
  background: color-mix(in srgb, currentColor 14%, transparent);
  font-weight: 600;
}
.sem-ed-outline-item:focus-visible { outline: 2px solid var(--sem-focus, currentColor); }
.sem-ed-outline-tag { font-size: 0.8em; opacity: 0.65; margin-inline-start: auto; }

.sem-ed-panes { display: grid; grid-template-columns: 1fr; min-width: 0; flex: 1; }
.sem-ed-pane { min-width: 0; min-height: 6rem; overflow: auto; }
.sem-ed-pane-code {
  border-block-start: 1px solid color-mix(in srgb, currentColor 15%, transparent);
}

/* split ≥ 900 px container width; stacked below (container, not viewport) */
@container sem-editor (min-width: 900px) {
  sem-editor[data-mode="split"] .sem-ed-panes { grid-template-columns: 1fr 1fr; }
  sem-editor[data-mode="split"] .sem-ed-pane-code {
    border-block-start: 0;
    border-inline-start: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  }
}
/* mode visibility */
sem-editor[data-mode="code"] .sem-ed-pane-wysiwyg { display: none; }
sem-editor[data-mode="wysiwyg"] .sem-ed-pane-code { display: none; }

.sem-ed-empty { padding: 1.5rem; opacity: 0.75; font-style: italic; }

/* ── property modal ────────────────────────────────────────────────────── */
.sem-ed-modal {
  min-width: min(30rem, 92vw); max-width: 92vw; max-height: 85vh;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 8px; padding: 0;
  color: inherit; background: var(--sem-surface, canvas);
}
.sem-ed-modal::backdrop { background: rgb(0 0 0 / 0.35); }
.sem-ed-modal h2 {
  font-size: 1em; margin: 0; padding: 0.6rem 0.9rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
}
.sem-ed-modal-body { padding: 0.5rem 0.9rem; overflow: auto; max-height: 60vh; }
.sem-ed-fieldset { border: 0; padding: 0; margin: 0 0 0.75rem; }
.sem-ed-fieldset legend { font-weight: 600; padding: 0.25rem 0; }
.sem-ed-field {
  display: grid; grid-template-columns: 10rem 1fr; gap: 0.25rem 0.5rem;
  align-items: center; padding: 0.2rem 0;
}
.sem-ed-field > .sem-ed-field-hint,
.sem-ed-field > .sem-ed-field-warn { grid-column: 2; }
.sem-ed-field-advanced { grid-template-columns: 8rem 1fr auto; }
.sem-ed-field-label { font-size: 0.9em; text-align: end; padding-inline-end: 0.25rem; }
.sem-ed-input {
  font: inherit; color: inherit; padding: 0.15rem 0.35rem;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 4px; background: transparent; max-width: 100%;
}
.sem-ed-input:focus-visible { outline: 2px solid var(--sem-focus, currentColor); outline-offset: 0; }
.sem-ed-field-warn { margin: 0; font-size: 0.85em; color: var(--sem-warn, #b35900); }
.sem-ed-field-hint { margin: 0; font-size: 0.8em; opacity: 0.7; }
.sem-ed-advanced { margin-block: 0.5rem; }
.sem-ed-advanced summary { cursor: pointer; font-weight: 600; }

.sem-ed-items { display: grid; gap: 0.2rem; }
.sem-ed-item-row { display: flex; gap: 0.3rem; align-items: center; }
.sem-ed-item-label {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sem-ed-btn-danger { color: var(--sem-danger, #a61b1b); }
.sem-ed-btn-add { justify-self: start; }

.sem-ed-modal-summary {
  margin: 0; padding: 0.35rem 0.9rem 0; font-size: 0.85em;
  color: var(--sem-warn, #b35900);
}
.sem-ed-modal-actions {
  display: flex; justify-content: flex-end; gap: 0.4rem;
  padding: 0.5rem 0.9rem 0.75rem;
}
.sem-ed-btn-primary { font-weight: 600; }

.sem-ed-json { width: 100%; font-family: ui-monospace, monospace; font-size: 0.9em; }

/* ── live region (visually hidden, announced) ──────────────────────────── */
.sem-ed-live {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  clip-path: inset(50%); overflow: hidden; white-space: nowrap;
}
`;
