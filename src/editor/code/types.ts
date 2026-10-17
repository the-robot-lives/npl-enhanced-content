/**
 * Code view lane contract — the seam between `<sem-editor-code>` and the
 * shell's EditorContext (EDITOR.md §6, §2.5, §2.6).
 *
 * The code view is an input device, not state: it holds the raw source of the
 * current tree plus in-flight keystrokes, and hands every debounced parse to
 * the host. The element never touches the model's internals — `doc` values
 * are opaque tokens passed from `tryParse` back to `adopt`.
 *
 * The model implementations land via `src/editor/model/index.ts`; until then
 * the shell injects a host whose `tryParse`/`adopt` bind the model's module
 * functions. This file imports only types from the model.
 */

import type { DocPos, EditorDocument, ParseIssue, ParseResult } from '../model/types.js';

export type { DocPos, EditorDocument, ParseIssue, ParseResult };

/** Token kinds emitted by the highlighter (EDITOR.md §6). Markup
 *  declarations (`<!doctype …>`, PIs, CDATA) share the `doctype` kind — the
 *  dim family, as in the terminal scanner. */
export type CodeTokenKind = 'tag' | 'attr' | 'value' | 'comment' | 'doctype' | 'entity' | 'text';

/** One token of one line. `start`/`end` are absolute offsets into the full
 *  source (UTF-16 units, `slice` coordinates); `err` is set by
 *  `markErrors` when a parse issue's range overlaps the token. Newline
 *  characters are structural (rendered as line separators), not tokens. */
export interface CodeToken {
  kind: CodeTokenKind;
  start: number;
  end: number;
  err: boolean;
}

export interface CodeLine {
  /** 0-based line index. */
  index: number;
  tokens: CodeToken[];
}

export interface HighlightResult {
  lines: CodeLine[];
  /** Absolute offset of each line's first character (`lines.length` long). */
  lineStarts: number[];
  /** Exclusive end of each line's content (before its `\n`; last is
   *  `source.length`). Same length as `lines`. */
  lineEnds: number[];
  length: number;
}

/** Selection moved in the code view, forwarded to the shell for WYSIWYG
 *  arbitration (§2.6: one-way-on-typing; the shell decides who drives). */
export interface CodeSelection {
  anchorOffset: number;
  focusOffset: number;
  anchor: DocPos | null;
  focus: DocPos | null;
  source: 'code';
}

/** The shell-provided adapter the code pane drives. Bind `tryParse` to the
 *  model's module function and `adopt` to the context's document swap. */
export interface CodeViewHost {
  /** Parse `source`. Never throws (model contract: best-effort tree plus
   *  structured issues). */
  tryParse(source: string): ParseResult;
  /** Install a clean parse's document as the live tree and re-project the
   *  WYSIWYG view. Called ONLY on `ok: true` — the last good tree is the
   *  host's to keep otherwise (§2.2). */
  adopt(doc: EditorDocument): void;
  /** Map a source offset to a model position for selection sync (§2.6). */
  offsetToPos(offset: number): DocPos | null;
  /** Caret/selection moved in the code view (rAF-throttled). */
  onCodeSelection?(selection: CodeSelection): void;
  /** Editor-wide polite announcement (§7 `sem-ed-live`). */
  announce?(message: string): void;
}
