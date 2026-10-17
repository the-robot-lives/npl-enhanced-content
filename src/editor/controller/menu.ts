/**
 * controller/menu — editor context-menu items + host adapter (§4.7).
 *
 * The terminal's ContextMenuController is reused additively: the editor
 * supplies `items` (editor verbs, §11 ownership) and a MenuHost whose
 * terminal seams are no-op/false (the editor surface is not a terminal).
 * Shift+right-click passes through to the browser menu — the controller's
 * contextmenu handler checks the modifier before ever opening.
 */

import type { MenuItemSpec, MenuHost } from '../../terminal/menu/types.js';
import type { EditorContext, ElementBinding } from './types.js';
import { duplicateElement, deleteElement, moveElement } from './actions.js';
import { resolveSlotEl } from './map.js';

/** Editor verb ids, in menu order — stable e2e hooks (§4.7). */
export const EDITOR_MENU_IDS = [
  'properties', 'edit', 'duplicate', 'move-up', 'move-down',
  'wrap-in', 'convert-to', 'insert-before', 'insert-after', 'delete',
] as const;

export type EditorMenuId = (typeof EDITOR_MENU_IDS)[number];

export function buildEditorMenuItems(ctx: EditorContext, binding: ElementBinding): readonly MenuItemSpec[] {
  const firstSlot = binding.descriptor?.textSlots?.[0];
  const slotEl = firstSlot !== undefined ? resolveSlotEl(binding, firstSlot) : null;
  const shellReady = ctx.shell !== null;
  return [
    {
      id: 'properties',
      label: 'Properties…',
      disabled: false,
      activate: () => {
        if (ctx.shell?.openProperties) ctx.shell.openProperties(binding);
        else ctx.announce('Properties unavailable (no shell)');
      },
    },
    {
      id: 'edit',
      label: 'Edit',
      disabled: slotEl === null,
      activate: () => {
        if (slotEl !== null) binding.controller?.startSlotEditing(slotEl);
      },
    },
    { id: 'duplicate', label: 'Duplicate', disabled: false, activate: () => duplicateElement(ctx, binding) },
    { id: 'move-up', label: 'Move up', disabled: false, activate: () => moveElement(ctx, binding, -1) },
    { id: 'move-down', label: 'Move down', disabled: false, activate: () => moveElement(ctx, binding, 1) },
    {
      id: 'wrap-in',
      label: 'Wrap in…',
      disabled: !shellReady,
      hint: shellReady ? undefined : 'no shell',
      activate: () => {
        if (ctx.shell?.openWrapPicker) ctx.shell.openWrapPicker(binding);
      },
    },
    {
      id: 'convert-to',
      label: 'Convert to…',
      disabled: !shellReady,
      hint: shellReady ? undefined : 'no shell',
      activate: () => {
        if (ctx.shell?.openConvertPicker) ctx.shell.openConvertPicker(binding);
      },
    },
    {
      id: 'insert-before',
      label: 'Insert before…',
      disabled: !shellReady,
      hint: shellReady ? undefined : 'no shell',
      activate: () => {
        if (ctx.shell?.openInserter) ctx.shell.openInserter(binding, 'before');
      },
    },
    {
      id: 'insert-after',
      label: 'Insert after…',
      disabled: !shellReady,
      hint: shellReady ? undefined : 'no shell',
      activate: () => {
        if (ctx.shell?.openInserter) ctx.shell.openInserter(binding, 'after');
      },
    },
    { id: 'delete', label: 'Delete', disabled: false, activate: () => deleteElement(ctx, binding) },
  ];
}

/** A MenuHost for the editor surface: terminal verbs are no-op/false so the
 *  terminal rows render disabled; `armBrowserPassthrough` is honored by the
 *  controller's Shift+right-click rule (the custom menu never opens). */
export function createEditorMenuHost(el: HTMLElement): MenuHost {
  return {
    copySelection: () => false,
    selectAll: () => undefined,
    pasteFromClipboard: () => undefined,
    activateFind: () => undefined,
    clearTerminal: () => undefined,
    openTranscript: () => undefined,
    currentView: () => 'dom',
    switchView: () => undefined,
    canvasAvailable: () => false,
    clipboardReadAvailable: () => false,
    findAvailable: () => false,
    armBrowserPassthrough: () => undefined, // controller checks Shift before opening
    surface: () => el,
  };
}
