/**
 * ansi — streaming ANSI/VT tokeniser (stage 1, CORE-V2 contract).
 *
 * `AnsiStateMachine` is the renderer-neutral producer: text runs, frozen
 * SGR snapshots, cursor/erase/CSI/OSC tokens. Consumers:
 *  - dom.ts `ansiSpans` — the temporary transcript adapter (a11y/find
 *    mirror once the canvas driver lands);
 *  - the CORE-V2 cell-grid screen model (docs/terminal/CORE-V2.md) —
 *    folds runs + snapshots into cells, applies cursor/erase ops, OSC 0/2
 *    to titles.
 */

export { AnsiStateMachine } from './parser.js';
export { applySgr, splitCsiParams, type SgrParam } from './sgr.js';
export {
  ansiSpans,
  ansiSpanClasses,
  ansiSpanStyle,
  ansiIndexedRgb,
  ANSI_DOM_CSS,
  type AnsiSpan,
} from './dom.js';
export {
  DEFAULT_SGR,
  type AnsiColor,
  type AnsiToken,
  type SgrAttrs,
} from './types.js';
