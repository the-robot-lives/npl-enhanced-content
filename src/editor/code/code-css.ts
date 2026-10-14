/**
 * Code-view paint — component-local CSS for `<sem-editor-code>` (EDITOR.md
 * §6, §9.3 channel: TS string, injected once, no `themes/` edits, no shared
 * stylesheet blocks).
 *
 * Alignment is the load-bearing property: the transparent textarea and the
 * highlight `<pre>` must render identical metrics (same font chain,
 * line-height, padding, tab-size) or the caret drifts off the tokens. Both
 * inherit from the scroller so a host override moves them together.
 *
 * `ensureCodeCss` is idempotent per document and marks its sheet with
 * `data-sem-editor-css="code-view"` — a distinct marker from the bundle-wide
 * `chrome-css.ts` sheet so the two channels never swallow each other
 * (integrate folds them at Phase 3 if it wants one tag).
 */

export const CODE_CSS = /* css */ `
sem-editor-code {
  color-scheme: light dark;
  display: block;
  min-height: 10em;
}
sem-editor-code .sem-ed-code-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: inherit;
  font-family: var(--sem-ed-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
sem-editor-code .sem-ed-code-scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 8em;
  display: flex;
  align-items: flex-start;
  overflow: auto;
  background: var(--sem-ed-code-bg, Canvas);
  color: var(--sem-ed-code-fg, CanvasText);
  font-size: var(--sem-ed-code-size, 0.8125rem);
  line-height: var(--sem-ed-code-lh, 1.5);
  tab-size: 2;
}
sem-editor-code .sem-ed-code-scroll:focus-within {
  outline: 2px solid AccentColor;
  outline-offset: -2px;
}
sem-editor-code .sem-ed-code-gutter {
  position: sticky;
  left: 0;
  z-index: 1;
  flex: 0 0 auto;
  padding: var(--sem-ed-code-pad, 0.5rem) 0.45em;
  text-align: right;
  user-select: none;
  background: var(--sem-ed-code-bg, Canvas);
  border-right: 1px solid color-mix(in srgb, currentColor 15%, transparent);
}
sem-editor-code .sem-ed-code-ln {
  min-width: 2.4em;
  color: color-mix(in srgb, currentColor 45%, transparent);
  font-variant-numeric: tabular-nums;
}
sem-editor-code .sem-ed-code-ln-err {
  color: light-dark(#b4235a, #ff8b96);
  font-weight: 700;
}
sem-editor-code .sem-ed-code-ln-err::before {
  content: "●";
  font-size: 0.7em;
  margin-right: 0.3em;
}
sem-editor-code .sem-ed-code-stack {
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
}
sem-editor-code pre.sem-ed-code {
  margin: 0;
  padding: var(--sem-ed-code-pad, 0.5rem);
  font: inherit;
  line-height: inherit;
  white-space: pre;
}
sem-editor-code .sem-ed-code-input {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: var(--sem-ed-code-pad, 0.5rem);
  font: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  tab-size: inherit;
  background: transparent;
  border: 0;
  resize: none;
  outline: none;
  overflow: hidden;
  white-space: pre;
  color: transparent;
  caret-color: var(--sem-ed-code-caret, currentColor);
}
sem-editor-code .sem-ed-code-input::selection {
  background: color-mix(in srgb, AccentColor 35%, transparent);
}
sem-editor-code[wrap] .sem-ed-code-stack {
  flex: 1 1 auto;
}
sem-editor-code[wrap] pre.sem-ed-code {
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
sem-editor-code[wrap] .sem-ed-code-input {
  white-space: pre-wrap;
}
sem-editor-code .sem-ed-tok-tag {
  color: light-dark(#0550ae, #79c0ff);
}
sem-editor-code .sem-ed-tok-attr {
  color: light-dark(#116329, #7ee787);
}
sem-editor-code .sem-ed-tok-value {
  color: light-dark(#8a4d00, #ffa657);
}
sem-editor-code .sem-ed-tok-comment,
sem-editor-code .sem-ed-tok-doctype {
  color: color-mix(in srgb, currentColor 55%, transparent);
  font-style: italic;
}
sem-editor-code .sem-ed-tok-entity {
  color: light-dark(#8250df, #d2a8ff);
}
sem-editor-code .sem-ed-err {
  text-decoration: underline wavy light-dark(#c01c44, #ff8188);
  text-decoration-skip-ink: none;
  text-underline-offset: 0.2em;
  background: light-dark(rgb(192 28 68 / 0.07), rgb(255 129 136 / 0.1));
}
sem-editor-code .sem-ed-code-strip {
  flex: 0 0 auto;
  border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  padding: 0.35em 0.6em;
  font: var(--sem-ed-code-ui-size, 0.75rem) / 1.45 var(--sem-ed-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  max-height: 7.5em;
  overflow: auto;
}
sem-editor-code .sem-ed-code-strip[hidden] {
  display: none;
}
sem-editor-code .sem-ed-code-strip-head {
  display: block;
  font-weight: 600;
  margin-bottom: 0.15em;
}
sem-editor-code .sem-ed-code-jump {
  all: unset;
  display: block;
  width: 100%;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 0.15em;
  padding: 0.05em 0;
}
sem-editor-code .sem-ed-code-jump:hover {
  text-decoration-thickness: 2px;
}
sem-editor-code .sem-ed-code-jump:focus-visible {
  outline: 2px solid AccentColor;
  outline-offset: 0;
}
sem-editor-code .sem-ed-code-strip-more {
  display: block;
  opacity: 0.75;
}
@media (prefers-reduced-motion: reduce) {
  /* No motion is authored here; this guard documents the intent and kills
   * any inherited transition the host theme might cascade in. */
  sem-editor-code .sem-ed-code-scroll,
  sem-editor-code .sem-ed-code-input,
  sem-editor-code .sem-ed-err {
    transition: none;
  }
}
`;

/** Inject the sheet once per document (idempotent; keyed on the
 *  `code-view` marker so the bundle sheet never collides). */
export function ensureCodeCss(doc: Document): void {
  if (doc.querySelector('style[data-sem-editor-css="code-view"]')) return;
  const style = doc.createElement('style');
  style.setAttribute('data-sem-editor-css', 'code-view');
  style.textContent = CODE_CSS;
  doc.head.appendChild(style);
}
