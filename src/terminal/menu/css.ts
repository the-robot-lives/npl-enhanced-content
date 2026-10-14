/**
 * menu/css — the shell-v2-dom-menu CSS block.
 *
 * Own file (never `themes/_vocabulary.css`, never committed there): the
 * integrator appends this block to the terminal CSS the same way the
 * canvas lane's `CANVAS_DOM_CSS` is inserted. Colors ride the vocabulary
 * tokens with the terminal frame's own dark values as fallbacks, so the
 * menu matches the shell it opened from in both themes. Listed in the lane
 * report as the lane's CSS contribution.
 */

export const MENU_DOM_CSS = `
/* ── shell-v2-dom-menu ── */
sem-terminal .sem-term-menu, sem-shell .sem-term-menu {
  position: fixed;
  z-index: 1000;
  min-width: 210px;
  padding: 4px;
  margin: 0;
  background: var(--sem-bg, #161a20);
  color: var(--sem-fg, #d7dee7);
  border: 1px solid var(--sem-border, #2a313b);
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
sem-terminal .sem-term-menu-item, sem-shell .sem-term-menu-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 18px;
  width: 100%;
  box-sizing: border-box;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 6px 10px;
  border-radius: 5px;
  cursor: default;
}
sem-terminal .sem-term-menu-item:focus, sem-shell .sem-term-menu-item:focus {
  background: color-mix(in srgb, var(--sem-accent, #7ec8a2) 22%, transparent);
  outline: none;
}
sem-terminal .sem-term-menu-item[aria-disabled="true"], sem-shell .sem-term-menu-item[aria-disabled="true"] {
  opacity: 0.45;
}
sem-terminal .sem-term-menu-hint, sem-shell .sem-term-menu-hint {
  margin-left: auto;
  padding-left: 12px;
  font-size: 11px;
  opacity: 0.6;
  white-space: nowrap;
}
@media (prefers-reduced-motion: no-preference) {
  @keyframes sem-term-menu-in {
    from { opacity: 0; transform: translateY(-2px) scale(0.98); }
  }
  sem-terminal .sem-term-menu, sem-shell .sem-term-menu {
    animation: sem-term-menu-in 120ms ease-out;
  }
}
`;
