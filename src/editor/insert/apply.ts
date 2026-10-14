/**
 * insert/apply — the one-op insertion verb (EDITOR.md §3.4 "Insert
 * before/after (menu, `+` zone, slash) | insertNode").
 *
 * Every road into the inserter (panel tile, wizard Finish, slash pick,
 * context-menu Insert before/after) lands here: compile the snippet through
 * the model, check placement + `canApply`, apply ONE op (one transaction,
 * one undo entry), announce the result (§7). UI never edits the DOM.
 */

import type { EditorContext } from '../controller/types.js';
import type { Transaction } from '../model/types.js';
import type { InsertEntry, InsertTarget } from './types.js';
import { compileSnippet } from './compile.js';
import { canInsertTagAt } from './placement.js';

export interface ApplyInsertOptions {
  /** Extra announce detail (e.g. "via wizard"). */
  via?: string;
  onInsert?: (entry: InsertEntry, target: InsertTarget) => void;
}

/** Insert `entry`'s template at `target`. Returns the transaction, or null
 *  when placement/build/model guards refused (announced, not thrown). */
export function insertEntryAt(
  ctx: EditorContext,
  entry: InsertEntry,
  target: InsertTarget,
  opts: ApplyInsertOptions = {},
): Transaction | null {
  if (!canInsertTagAt(ctx.doc, target, entry.tag)) {
    ctx.announce(`A ${entry.title} cannot go there (schema placement).`);
    return null;
  }
  const node = compileSnippet(entry.template.xml, ctx.doc);
  if (node === null) {
    ctx.announce(`Could not build ${entry.title} from its template.`);
    return null;
  }
  const index = Math.max(0, Math.min(target.index, ctx.doc.childrenOf(target.parentId).length));
  const op = { type: 'insertNode', parent: target.parentId, index, node } as const;
  if (!ctx.doc.canApply(op).ok) {
    ctx.announce(`Insert refused: ${entry.title} cannot go at that position.`);
    return null;
  }
  const tx = ctx.doc.apply(op);
  ctx.announce(`Inserted ${entry.title}${opts.via !== undefined ? ` (${opts.via})` : ''}.`);
  opts.onInsert?.(entry, target);
  return tx;
}

/** True when the document changed since `openedAtVersion` (modal guards,
 *  §5.4 pattern: review and retry rather than apply over a moved tree). */
export function documentMovedSince(ctx: EditorContext, openedAtVersion: number): boolean {
  return ctx.doc.version !== openedAtVersion;
}
