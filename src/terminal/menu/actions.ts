/**
 * menu/actions — the one action list (CORE-V2 §8.5 items, in spec order).
 *
 * Every item is a plain object (id + label + availability + activate), so
 * the terminal's context menu and any future window-chrome actions-registry
 * renderer (§8.5 Chrome reuse) consume the same list and cannot drift.
 * Labels are data, never HTML — the menu renders them via textContent.
 */

import type { MenuHost, MenuItemSpec } from './types.js';
import type { RendererChoice } from './view.js';

/** The §8.5 items in spec order: Copy · Select all · Paste · Find… · view switch · transcript · browser menu. */
export function buildMenuItems(host: MenuHost): MenuItemSpec[] {
  const view: RendererChoice = host.currentView();
  const to: RendererChoice = view === 'dom' ? 'canvas' : 'dom';
  const canPaste = host.clipboardReadAvailable();
  const canFind = host.findAvailable();
  const canvasRefused = !host.canvasAvailable();
  return [
    {
      id: 'copy',
      label: 'Copy',
      disabled: false,
      activate: (h) => void h.copySelection(), // fire-and-forget: false = nothing selected
    },
    {
      id: 'select-all',
      label: 'Select all',
      disabled: false,
      activate: (h) => h.selectAll(),
    },
    {
      id: 'paste',
      label: 'Paste',
      disabled: !canPaste,
      hint: canPaste ? undefined : 'clipboard unavailable',
      activate: (h) => h.pasteFromClipboard(),
    },
    {
      id: 'find',
      label: 'Find…',
      disabled: !canFind,
      hint: canFind ? undefined : 'no find here',
      activate: (h) => h.activateFind(),
    },
    {
      id: 'switch-view',
      label: to === 'canvas' ? 'Switch to canvas view' : 'Switch to text view',
      disabled: to === 'canvas' && canvasRefused,
      hint: to === 'canvas' && canvasRefused ? 'canvas unavailable' : undefined,
      activate: (h) => h.switchView(to),
    },
    {
      id: 'clear',
      label: 'Clear',
      disabled: false,
      activate: (h) => h.clearTerminal(),
    },
    {
      id: 'transcript',
      label: 'Open plain transcript',
      disabled: false,
      activate: (h) => h.openTranscript(),
    },
    {
      id: 'browser-menu',
      label: 'Browser menu…',
      disabled: false,
      activate: (h) => h.armBrowserPassthrough(),
    },
  ];
}
