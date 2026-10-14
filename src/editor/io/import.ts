/**
 * editor/io/import — documents and pasted content in (EDITOR.md §12, §8).
 *
 * Two doors, different guarantees:
 *  - `importSource` (file open): full-fidelity `tryParse`. A `.sem.html`
 *    document is byte-precious — round-tripping it must not mutate a byte,
 *    so it is NEVER sanitized; the model never executes it and the inert
 *    projection (safety/inert) protects the preview.
 *  - `importSanitized` (paste/drop): the controller lane's
 *    `sanitizeHtml` filter, rebuilt through the TARGET document's factories
 *    (`rebuildSubtree`) so ids come from the target counter (adoption rule,
 *    §2.3) — the caller inserts the nodes wherever the paste landed.
 *
 * Failures never throw away the last good tree: `importSource` returns the
 * structured `ParseResult` and the session decides (§2.2).
 */

import type { EditorDocument, EditorNode, ParseResult } from '../model/types.js';
import { tryParse } from '../model/document.js';
import { rebuildSubtree, sanitizeHtml, type SanitizeCounts } from '../safety/sanitize.js';

/** Open a whole document (file/paste of authored source). Never sanitizes. */
export function importSource(source: string): ParseResult {
  return tryParse(source);
}

/** Read a picked file/blob as text (the `<input type="file">` door). */
export function readFileText(file: Blob): Promise<string> {
  return file.text();
}

export interface SanitizedImport extends SanitizeCounts {
  /** Fresh-id nodes owned by `into`, ready for an `insertNode` op. */
  nodes: EditorNode[];
}

/**
 * Paste/drop door: sanitize, then rebuild through `into`'s factories.
 * `knownTags` is the schema's tag-name set (class aliases resolve in the
 * sanitizer); omit it to allow formatting tags only.
 */
export function importSanitized(
  into: EditorDocument,
  html: string,
  opts?: { knownTags?: ReadonlySet<string> },
): SanitizedImport {
  const result = sanitizeHtml(html, { knownTags: opts?.knownTags });
  const nodes = result.nodes.map((node) => rebuildSubtree(into, node));
  const { droppedTags, droppedAttrs, droppedUrls } = result;
  return { nodes, droppedTags, droppedAttrs, droppedUrls };
}
