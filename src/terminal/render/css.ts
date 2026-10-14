/**
 * render/css — the shell-v2-canvas CSS block.
 *
 * Own file (never `themes/_vocabulary.css`, never committed there): the
 * integrator appends this block to the terminal CSS the same way the ansi
 * lane's `ANSI_DOM_CSS` is inserted. Theme colors come from the vocabulary
 * tokens — nothing hard-coded here except the visually-hidden geometry.
 *
 * Listed in the lane report as the lane's CSS contribution.
 */

export const CANVAS_DOM_CSS = `
/* ── shell-v2-canvas ── */
sem-terminal .sem-term-canvas, sem-shell .sem-term-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
sem-terminal .sem-term-canvas-hidden, sem-shell .sem-term-canvas-hidden {
  display: none; /* the DOM view is promoted — canvas stands down (§8.5) */
}
sem-terminal .sem-term-mirror, sem-shell .sem-term-mirror {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre;
}
/* Hidden mode: the classic visually-hidden pattern — zero size, still in
   the a11y tree, still findable/selectable by platform services (§8.1). */
sem-terminal .sem-term-mirror[data-visible="false"], sem-shell .sem-term-mirror[data-visible="false"] {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  border: 0;
}
/* Promoted mode (§8.5b/c): the same paint as the visible text view. */
sem-terminal .sem-term-mirror[data-visible="true"], sem-shell .sem-term-mirror[data-visible="true"] {
  position: absolute;
  inset: 0;
  overflow: auto;
  cursor: text;
}
sem-terminal .sem-term-mirror-line, sem-shell .sem-term-mirror-line {
  white-space: pre;
  min-height: 1em;
}
sem-terminal .sem-term-mirror-live, sem-shell .sem-term-mirror-live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
@media (prefers-reduced-motion: reduce) {
  sem-terminal .sem-term-mirror, sem-shell .sem-term-mirror { scroll-behavior: auto; }
}
`;
