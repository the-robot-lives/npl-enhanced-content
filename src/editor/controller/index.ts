/**
 * controller/index — the lazy editor bundle's barrel (§4.1).
 * `SemTextEditor.claim` resolves to `attach.claim`; everything else is the
 * controller internals the shell integrates against.
 */

export { claim, attachEditor, detachEditor, createContext, watchEditMode, bindingFor } from './attach.js';
export { EditController } from './edit-controller.js';
export { buildEditorMenuItems, createEditorMenuHost, EDITOR_MENU_IDS } from './menu.js';
export { rerenderElement, scheduleRerender, affectsBinding, stampEditNodes } from './rerender.js';
export { caretFromDomPosition, domPositionFor } from './selection.js';
export * from './actions.js';
export type {
  EditorContext, EditorContextOptions, ElementBinding, ShellHooks, SemTextEditorApi,
  SemTextEditorController,
} from './types.js';
