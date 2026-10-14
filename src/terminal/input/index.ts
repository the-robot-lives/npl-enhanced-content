/**
 * input — the terminal's single input path (CORE-V2 §7): key normalization
 * + chord grammar, sendKeys, the hidden IME/paste input, mouse → cell
 * mapping + selection, and the one paste/copy pipeline.
 */

export {
  InputSpecError,
  NAMED_KEYS,
  describeKey,
  normalizeKey,
  parseKeyToken,
  parseSendKeys,
} from './keys.js';
export {
  SelectionState,
  cellFromPoint,
  sgrButtonNumber,
  sgrSequence,
  sgrWheelButton,
} from './mouse.js';
export { PASTE_MARK, copyText, isMultiline, markPastedNewlines, pasteForCooked, type CopyTargets } from './paste.js';
export { createHiddenInput, type HiddenInputHandle, type HiddenInputHost } from './hidden-input.js';
export { InputModel, type InputHost } from './input-model.js';
export {
  NO_MODS,
  modsOf,
  type CellMetrics,
  type KeyEvent,
  type Mods,
  type MouseEventInfo,
  type RawKeyEvent,
  type SelectionPoint,
  type SelectionRange,
} from './types.js';
