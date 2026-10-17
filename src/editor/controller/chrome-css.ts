/**
 * controller/chrome-css — the CONTROLLER's editor chrome paint (§9.3).
 *
 * Component-local TS string, injected once per document as
 * `<style data-sem-editor-css>`. `sem-ed-*` classes only — the vocabulary
 * `.sem-*` namespace is never reused. The shell lane may append its own
 * block to the same sheet; integrate consolidates in Phase 3.
 */

export const CONTROLLER_CSS = `
/* ── editor-controller (LANE=controller) ── */
.sem-ed-host { position: relative; }
.sem-ed-outline {
  position: absolute; pointer-events: none;
  outline: 2px solid var(--sem-ed-accent, #4c8bf5);
  outline-offset: 2px; border-radius: 3px;
  transition: outline-color .15s ease;
}
.sem-ed-chip {
  position: absolute; top: -1.4em; left: 0; z-index: 30;
  display: inline-flex; gap: .35em; align-items: center;
  border: 1px solid var(--sem-ed-accent, #4c8bf5); border-radius: 3px;
  background: var(--sem-ed-chip-bg, #eef4ff); color: var(--sem-ed-chip-fg, #1a3c7e);
  font: 600 11px/1.4 system-ui, sans-serif; padding: 1px 6px; cursor: pointer;
}
.sem-ed-chip .sem-ed-chip-tag { font-weight: 400; opacity: .75; }
.sem-ed-chip:focus-visible { outline: 2px solid var(--sem-ed-accent, #4c8bf5); outline-offset: 1px; }
.sem-ed-item { position: relative; }
.sem-ed-glyph {
  position: absolute; top: 0; z-index: 25;
  width: 1.4em; height: 1.4em; line-height: 1.3;
  border: 1px solid var(--sem-ed-glyph-border, #b9c6dd); border-radius: 3px;
  background: var(--sem-ed-glyph-bg, #fff); color: var(--sem-ed-glyph-fg, #33507e);
  font: 700 12px/1.3 system-ui, sans-serif; cursor: pointer;
  opacity: 0; transition: opacity .15s ease;
}
.sem-ed-glyph[data-glyph="minus"] { right: 0; }
.sem-ed-glyph[data-glyph="plus"] {
  position: static; display: block; margin: 2px 0;
  width: auto; height: 1.5em;
}
.sem-ed-item:hover > .sem-ed-glyph[data-glyph="minus"],
.sem-ed-item:focus-within > .sem-ed-glyph[data-glyph="minus"],
.sem-ed-glyph:focus { opacity: 1; }
.sem-ed-host:hover > .sem-ed-glyph[data-glyph="plus"],
.sem-ed-glyph[data-glyph="plus"]:focus { opacity: 1; }
.sem-ed-slot-editing { outline: 2px dashed var(--sem-ed-accent, #4c8bf5); outline-offset: 2px; cursor: text; }
.sem-ed-popover {
  position: absolute; z-index: 40; display: flex; gap: .4em; align-items: center;
  border: 1px solid var(--sem-ed-glyph-border, #b9c6dd); border-radius: 4px;
  background: var(--sem-ed-glyph-bg, #fff); padding: 6px 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,.12); font: 12px/1.4 system-ui, sans-serif;
}
.sem-ed-popover input {
  width: 16em; font: inherit; padding: 2px 6px;
  border: 1px solid var(--sem-ed-glyph-border, #b9c6dd); border-radius: 3px;
}
.sem-ed-popover input[aria-invalid="true"] { border-color: #c0392b; }
.sem-ed-popover .sem-ed-popover-err { color: #c0392b; max-width: 14em; }
.sem-ed-live {
  position: fixed; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .sem-ed-outline, .sem-ed-glyph { transition: none; }
}
`;
