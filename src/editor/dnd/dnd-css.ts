/**
 * dnd/dnd-css — the lane's stylesheet slice (component-local TS per the
 * brief; no themes/ edits). Injected once per document under
 * `style[data-sem-editor-css][data-sem-ed-block="dnd"]` (the insert lane's
 * block-marker pattern — per-lane guards, integrate aggregates).
 *
 * Motion: the indicator and the dragged source are opacity/border only;
 * under prefers-reduced-motion every transition/animation is dropped (§7).
 */

export const DND_CSS = /* css */ `
/* ── editor-dragdrop ── */
.sem-ed-dropline {
  position: fixed;
  z-index: 2147483000;
  pointer-events: none;
  background: var(--sem-ed-drop-color, currentColor);
  opacity: 0.85;
  border-radius: 1px;
  box-shadow: 0 0 0 1px var(--sem-ed-drop-halo, Canvas);
  transition: opacity 120ms ease;
}
.sem-ed-dropline::before {
  content: "";
  position: absolute;
  inset: -3px;
}
.sem-ed-dragging {
  opacity: 0.45;
}
@media (prefers-reduced-motion: reduce) {
  .sem-ed-dropline,
  .sem-ed-dragging {
    transition: none;
    animation: none;
  }
}
`;
