/**
 * shell-css — the `<sem-editor>` frame's own paint (EDITOR.md §9.3,
 * Instrument shell).
 *
 * All editor chrome classes are `sem-ed-*` (§0 reserved prefixes). Colors
 * read the SITE tokens (`--bg`, `--ink`, `--accent`, `--code-bg`, …) with
 * literal Nocturne fallbacks, so semtext.dev's palette drives the editor and
 * standalone hosts still get the intended dark-chrome IDE look without any
 * theme file. The code pane is pinned DARK (site `--code-bg`) in every mode,
 * with `--sem-ed-code-*` overrides so `<sem-editor-code>`'s own channel
 * inherits it. Injected once per document as
 * `<style data-sem-editor-css data-sem-ed-block="shell">`.
 */

export const SHELL_CSS = `
sem-editor {
  display: block;
  /* Nocturne/site token fallbacks — the site's own values win when present */
  --sem-ed-bg: var(--bg, #0f172a);
  --sem-ed-bg-lift: var(--bg-lift, #1e293b);
  --sem-ed-panel: var(--bg-panel, #1e293b);
  --sem-ed-ink: var(--ink, #e2e8f0);
  --sem-ed-mute: var(--mute, #94a3b8);
  --sem-ed-accent: var(--accent, #7c3aed);
  --sem-ed-accent-soft: var(--accent-soft, #a78bfa);
  --sem-ed-border: var(--code-border, #334155);
  --sem-ed-code-bg: var(--code-bg, #0b1220);
  --sem-ed-warn: var(--warn, #f59e0b);
  --sem-ed-ok: var(--ok, #34d399);
  color: var(--sem-ed-ink);
  background: var(--sem-ed-bg);
  color-scheme: dark;
  font-family: inherit;
}

.sem-ed-frame {
  container: sem-editor / inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 12rem;
  border: 1px solid var(--sem-ed-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--sem-ed-bg);
}
.sem-ed-frame:focus-within { outline: 2px solid var(--sem-ed-accent); outline-offset: 1px; }

/* ── top bar ─────────────────────────────────────────────────────────────── */
.sem-ed-topbar {
  display: flex; align-items: center; gap: 0.35rem;
  flex: 0 0 auto;
  min-height: 2.75rem;
  padding: 0.3rem 0.6rem;
  background: var(--sem-ed-panel);
  border-bottom: 1px solid var(--sem-ed-border);
  flex-wrap: wrap;
}
.sem-ed-doc { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
.sem-ed-dot {
  width: 0.55rem; height: 0.55rem; border-radius: 50%;
  background: var(--sem-ed-border);
  flex: 0 0 auto;
  transition: background-color 160ms ease;
}
.sem-ed-dot[data-on] { background: var(--sem-ed-warn); }
.sem-ed-doc-name {
  font: inherit; font-size: 0.9rem; font-weight: 600;
  color: var(--sem-ed-ink);
  background: transparent;
  border: 1px solid transparent; border-radius: 6px;
  padding: 0.15rem 0.4rem;
  min-width: 6rem; max-width: 16rem; width: 12rem;
  text-overflow: ellipsis;
}
.sem-ed-doc-name:hover { border-color: var(--sem-ed-border); }
.sem-ed-doc-name:focus { outline: none; border-color: var(--sem-ed-accent); background: var(--sem-ed-bg); }

.sem-ed-btn {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font: inherit; font-size: 0.85rem;
  color: var(--sem-ed-ink);
  background: transparent;
  border: 1px solid transparent; border-radius: 6px;
  padding: 0.22rem 0.5rem;
  cursor: pointer;
  white-space: nowrap;
}
.sem-ed-btn:hover:not(:disabled) { background: var(--sem-ed-bg-lift); }
.sem-ed-btn:disabled { opacity: 0.4; cursor: default; }
.sem-ed-btn:focus-visible { outline: 2px solid var(--sem-ed-accent); outline-offset: 1px; }
.sem-ed-btn[aria-expanded="true"] { color: var(--sem-ed-accent-soft); }
.sem-ed-ico { display: inline-flex; width: 1em; height: 1em; flex: 0 0 auto; }
.sem-ed-ico svg { width: 100%; height: 100%; display: block; }
.sem-ed-sep {
  width: 1px; align-self: stretch; margin: 0.15rem 0.25rem;
  background: var(--sem-ed-border);
}

/* mode segmented control — centered between doc name and actions */
.sem-ed-mode-group {
  display: inline-flex;
  border: 1px solid var(--sem-ed-border);
  border-radius: 7px;
  overflow: hidden;
  background: var(--sem-ed-bg);
  margin-inline: auto;
}
.sem-ed-mode {
  border-radius: 0;
  border-inline: 1px solid var(--sem-ed-border);
  color: var(--sem-ed-mute);
}
.sem-ed-mode:first-child { border-inline-start: 0; }
.sem-ed-mode:last-child { border-inline-end: 0; }
.sem-ed-mode:hover { color: var(--sem-ed-ink); background: var(--sem-ed-bg-lift); }
.sem-ed-mode[aria-checked="true"] {
  background: var(--sem-ed-accent);
  color: #ffffff;
  font-weight: 600;
}
.sem-ed-mode[aria-checked="true"]:focus-visible { outline-color: #ffffff; }

/* ── breadcrumbs ─────────────────────────────────────────────────────────── */
.sem-ed-crumbs {
  display: flex; flex-wrap: wrap; gap: 0.15rem; align-items: baseline;
  padding: 0.2rem 0.7rem; font-size: 0.8rem;
  border-bottom: 1px solid var(--sem-ed-border);
  background: var(--sem-ed-bg);
  color: var(--sem-ed-mute);
}
.sem-ed-crumb {
  font: inherit; color: inherit; background: none; border: 0;
  padding: 0.05rem 0.25rem; border-radius: 4px; cursor: pointer;
}
.sem-ed-crumb:hover { color: var(--sem-ed-ink); background: var(--sem-ed-bg-lift); }
.sem-ed-crumb[aria-current] { font-weight: 600; color: var(--sem-ed-ink); cursor: default; }
.sem-ed-crumb:focus-visible { outline: 2px solid var(--sem-ed-accent); }

/* ── main: outline rail + panes + inspector ─────────────────────────────── */
.sem-ed-main { display: flex; min-height: 0; flex: 1; }

.sem-ed-outline-host {
  flex: 0 0 auto;
  width: 14.5rem; min-width: 11rem; max-width: 25rem;
  overflow: auto;
  border-inline-end: 1px solid var(--sem-ed-border);
  background: var(--sem-ed-panel);
  padding: 0.25rem 0;
}
.sem-ed-frame[data-outline-open="false"] .sem-ed-outline-host,
.sem-ed-frame[data-outline-open="false"] .sem-ed-outline-resizer { display: none; }

.sem-ed-outline-resizer {
  flex: 0 0 auto;
  width: 5px;
  margin-inline-start: -3px;
  cursor: col-resize;
  z-index: 2;
  background: transparent;
}
.sem-ed-outline-resizer:hover, .sem-ed-outline-resizer:focus-visible {
  background: color-mix(in srgb, var(--sem-ed-accent) 45%, transparent);
  outline: none;
}

.sem-ed-outline { padding: 0 0.15rem; }
.sem-ed-outline-label {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
  margin: 0.2rem 0.5rem 0.35rem;
  color: var(--sem-ed-mute);
}
.sem-ed-outline-empty { margin: 0.25rem 0.6rem; font-size: 0.82rem; color: var(--sem-ed-mute); }
.sem-ed-outline-item {
  display: flex; align-items: baseline; gap: 0.35rem;
  padding: 0.14rem 0.5rem;
  padding-inline-start: calc(0.5rem + var(--sem-ed-depth, 0) * 0.85rem);
  cursor: pointer; border-radius: 5px; margin-inline: 0.15rem;
  font-size: 0.85rem;
  color: var(--sem-ed-ink);
}
.sem-ed-outline-item:hover { background: var(--sem-ed-bg-lift); }
.sem-ed-outline-item[aria-selected="true"] {
  background: color-mix(in srgb, var(--sem-ed-accent) 30%, transparent);
  font-weight: 600;
}
.sem-ed-outline-item:focus-visible { outline: 2px solid var(--sem-ed-accent); outline-offset: -2px; }
.sem-ed-outline-twisty {
  flex: 0 0 auto; width: 1em;
  background: none; border: 0; padding: 0;
  color: var(--sem-ed-mute);
  font-size: 0.8em;
  cursor: pointer;
}
.sem-ed-outline-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sem-ed-outline-tag {
  font-size: 0.68rem; color: var(--sem-ed-mute); margin-inline-start: auto;
  font-family: var(--sem-ed-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

/* ── panes ────────────────────────────────────────────────────────────────── */
.sem-ed-panes {
  display: grid; grid-template-columns: 1fr;
  min-width: 0; flex: 1;
  background: var(--sem-ed-bg);
}
.sem-ed-pane { min-width: 0; min-height: 6rem; overflow: auto; }
.sem-ed-pane-wysiwyg { padding: 1rem 1.25rem; }

/* code pane — pinned dark, matching the site's code tokens. The --sem-ed-*
 * custom properties set on the sem-editor host inherit down into
 * sem-editor-code's own channel here. */
.sem-ed-pane-code {
  border-block-start: 1px solid var(--sem-ed-border);
  background: var(--sem-ed-code-bg);
  color-scheme: dark;
  --sem-ed-code-fg: var(--sem-ed-ink);
  --sem-ed-code-caret: var(--sem-ed-accent-soft);
}
.sem-ed-pane-code .sem-ed-tok-tag { color: var(--tok-kw, #c4b5fd); }
.sem-ed-pane-code .sem-ed-tok-attr { color: var(--tok-fn, #7dd3fc); }
.sem-ed-pane-code .sem-ed-tok-value { color: var(--tok-str, #86efac); }
.sem-ed-pane-code .sem-ed-tok-comment,
.sem-ed-pane-code .sem-ed-tok-doctype { color: var(--tok-cmt, #64748b); }
.sem-ed-pane-code .sem-ed-tok-entity { color: var(--tok-num, #fcd34d); }

/* split ≥ 900 px container width; stacked below (container, not viewport) */
@container sem-editor (min-width: 900px) {
  sem-editor[data-mode="split"] .sem-ed-panes { grid-template-columns: 1fr 1fr; }
  sem-editor[data-mode="split"] .sem-ed-pane-code {
    border-block-start: 0;
    border-inline-start: 1px solid var(--sem-ed-border);
  }
}
/* mode visibility */
sem-editor[data-mode="code"] .sem-ed-pane-wysiwyg { display: none; }
sem-editor[data-mode="wysiwyg"] .sem-ed-pane-code { display: none; }

.sem-ed-empty { padding: 1.25rem; color: var(--sem-ed-mute); font-style: italic; }
.sem-ed-empty-hint { font-size: 0.85rem; margin-top: 0.35rem; }

/* ── inspector ───────────────────────────────────────────────────────────── */
.sem-ed-inspector-host {
  flex: 0 0 auto;
  width: 17.5rem;
  overflow: auto;
  border-inline-start: 1px solid var(--sem-ed-border);
  background: var(--sem-ed-panel);
}
.sem-ed-frame[data-inspector-open="false"] .sem-ed-inspector-host { display: none; }
.sem-ed-inspector { padding: 0.5rem 0.75rem 0.9rem; font-size: 0.85rem; }
.sem-ed-inspector-title {
  font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em;
  margin: 0.2rem 0 0.4rem;
  color: var(--sem-ed-mute);
}
.sem-ed-inspector-target {
  display: flex; align-items: baseline; gap: 0.4rem;
  margin: 0 0 0.6rem; font-size: 0.95rem;
}
.sem-ed-inspector-target code {
  font-size: 0.7rem; color: var(--sem-ed-mute);
  font-family: var(--sem-ed-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.sem-ed-inspector-empty { color: var(--sem-ed-mute); margin: 0.35rem 0; }

/* ── fields (shared by inspector + modal) ────────────────────────────────── */
.sem-ed-field {
  display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.2rem 0.5rem;
  align-items: center; padding: 0.22rem 0;
}
.sem-ed-field > .sem-ed-field-hint,
.sem-ed-field > .sem-ed-field-warn { grid-column: 2; }
.sem-ed-field-advanced { grid-template-columns: 7rem 1fr auto; }
.sem-ed-field-label { font-size: 0.85em; text-align: end; padding-inline-end: 0.25rem; overflow-wrap: anywhere; }
.sem-ed-input {
  font: inherit; color: var(--sem-ed-ink);
  padding: 0.18rem 0.35rem;
  border: 1px solid var(--sem-ed-border);
  border-radius: 5px;
  background: var(--sem-ed-bg);
  max-width: 100%;
}
.sem-ed-input:focus-visible { outline: 2px solid var(--sem-ed-accent); outline-offset: 0; }
.sem-ed-field-warn { margin: 0; font-size: 0.8em; color: var(--sem-ed-warn); }
.sem-ed-field-hint { margin: 0; font-size: 0.78em; color: var(--sem-ed-mute); }
.sem-ed-advanced { margin-block: 0.5rem; }
.sem-ed-advanced summary { cursor: pointer; font-weight: 600; color: var(--sem-ed-mute); }
.sem-ed-btn-danger { color: var(--sem-ed-warn); }
.sem-ed-btn-add { justify-self: start; margin-top: 0.4rem; border-color: var(--sem-ed-border); }

/* ── property modal ──────────────────────────────────────────────────────── */
.sem-ed-modal {
  min-width: min(30rem, 92vw); max-width: 92vw; max-height: 85vh;
  border: 1px solid var(--sem-ed-border);
  border-radius: 10px; padding: 0;
  color: var(--sem-ed-ink);
  background: var(--sem-ed-panel);
}
.sem-ed-modal::backdrop { background: rgb(0 0 0 / 0.45); }
.sem-ed-modal h2 {
  font-size: 1em; margin: 0; padding: 0.6rem 0.9rem;
  border-bottom: 1px solid var(--sem-ed-border);
}
.sem-ed-modal-body { padding: 0.5rem 0.9rem; overflow: auto; max-height: 60vh; }
.sem-ed-fieldset { border: 0; padding: 0; margin: 0 0 0.75rem; }
.sem-ed-fieldset legend { font-weight: 600; padding: 0.25rem 0; }
.sem-ed-items { display: grid; gap: 0.2rem; }
.sem-ed-item-row { display: flex; gap: 0.3rem; align-items: center; }
.sem-ed-item-label {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sem-ed-modal-summary {
  margin: 0; padding: 0.35rem 0.9rem 0; font-size: 0.85em;
  color: var(--sem-ed-warn);
}
.sem-ed-modal-actions {
  display: flex; justify-content: flex-end; gap: 0.4rem;
  padding: 0.5rem 0.9rem 0.75rem;
}
.sem-ed-btn-primary { font-weight: 600; background: var(--sem-ed-accent); color: #fff; }
.sem-ed-btn-primary:hover:not(:disabled) { background: var(--sem-ed-accent-soft); }
.sem-ed-json { width: 100%; font-family: var(--sem-ed-mono, ui-monospace, monospace); font-size: 0.9em; }

/* ── problems ────────────────────────────────────────────────────────────── */
.sem-ed-problems {
  flex: 0 0 auto;
  max-height: 30%;
  overflow: auto;
  border-block-start: 1px solid var(--sem-ed-border);
  background: var(--sem-ed-panel);
  padding: 0.35rem 0.75rem;
  font-size: 0.82rem;
}
.sem-ed-problems[hidden] { display: none; }
.sem-ed-problems-head {
  margin: 0 0 0.2rem; font-weight: 600; color: var(--sem-ed-warn);
  text-transform: uppercase; font-size: 0.68rem; letter-spacing: 0.08em;
}
.sem-ed-problems ul { margin: 0; padding: 0; list-style: none; }
.sem-ed-problem-jump {
  all: unset; display: block; width: 100%; cursor: pointer;
  padding: 0.12rem 0.2rem; border-radius: 4px;
  text-decoration: underline; text-underline-offset: 0.15em;
}
.sem-ed-problem-jump:hover { background: var(--sem-ed-bg-lift); }
.sem-ed-problem-jump:focus-visible { outline: 2px solid var(--sem-ed-accent); }

/* ── status bar ──────────────────────────────────────────────────────────── */
.sem-ed-statusbar {
  display: flex; align-items: center; gap: 0.6rem;
  flex: 0 0 auto;
  min-height: 1.6rem;
  padding: 0.1rem 0.7rem;
  border-block-start: 1px solid var(--sem-ed-border);
  background: var(--sem-ed-panel);
  color: var(--sem-ed-mute);
  font-size: 0.74rem;
}
.sem-ed-status-problems {
  all: unset; cursor: pointer; font: inherit;
  color: var(--sem-ed-ok);
  padding: 0 0.25rem; border-radius: 4px;
}
.sem-ed-status-problems:disabled { cursor: default; color: var(--sem-ed-mute); }
.sem-ed-status-problems.has-problems { color: var(--sem-ed-warn); font-weight: 700; }
.sem-ed-status-problems:not(:disabled):hover { background: var(--sem-ed-bg-lift); }
.sem-ed-status-problems:focus-visible { outline: 2px solid var(--sem-ed-accent); }
.sem-ed-status-spacer { flex: 1; }
.sem-ed-status-ro { color: var(--sem-ed-accent-soft); font-weight: 600; }
.sem-ed-status-ro[hidden] { display: none; }

/* ── narrow container: panels become sheets ──────────────────────────────── */
@container sem-editor (max-width: 699px) {
  .sem-ed-btn-label { display: none; }
  .sem-ed-btn { padding: 0.22rem 0.4rem; }
  .sem-ed-doc-name { width: 7rem; max-width: 9rem; }
  .sem-ed-sep { display: none; }
  .sem-ed-outline-host,
  .sem-ed-inspector-host {
    position: absolute;
    inset-inline: 0.4rem;
    bottom: 2.6rem;
    max-height: 62%;
    border: 1px solid var(--sem-ed-border);
    border-radius: 10px 10px 0 0;
    box-shadow: 0 -8px 24px rgb(0 0 0 / 0.45);
    z-index: 5;
  }
  .sem-ed-frame { position: relative; }
}

/* ── live region (visually hidden, announced) ────────────────────────────── */
.sem-ed-live {
  position: absolute; width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  clip-path: inset(50%); overflow: hidden; white-space: nowrap;
}

/* motion gate: nothing transitions when the user asked for less */
@media (prefers-reduced-motion: reduce) {
  .sem-ed-dot, .sem-ed-btn, .sem-ed-mode { transition: none; }
}

/* forced-colors: currentColor discipline keeps chrome legible */
@media (forced-colors: active) {
  .sem-ed-frame, .sem-ed-topbar, .sem-ed-statusbar, .sem-ed-inspector-host, .sem-ed-outline-host {
    border-color: CanvasText;
  }
}
`;
