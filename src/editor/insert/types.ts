/**
 * insert — types (EDITOR.md §5.5, lane brief LANE=insert).
 *
 * This module pins the insert-request payload shape that answers the shell
 * lane's open question (`sem-edit-insert-request`, report shell.md): the
 * detail is `{parent, index}` — nothing more. The insert lane resolves
 * descriptors, schema placement and the catalog from the bundle-time
 * registry itself, so carrying a descriptor (or the resolved target) in the
 * event would be redundant payload; normalization (null → selection/append,
 * a text-node parent → its element) is THIS lane's job, not the emitter's.
 *
 * `sem-editor` already emits exactly this shape (`{parent, index: null}`) —
 * no shell change is required. integrate wires the consumer (wire.ts).
 */

import type { NodeId } from '../model/types.js';
import type { EditBucket, TemplateSnippet, WizardSpec } from '../schema/types.js';

/** Payload of the shell's `sem-edit-insert-request` CustomEvent (§5.1).
 *  - `parent`: container node id; `null` = the document root; a TEXT node id
 *    is normalized to its parent element by `resolveInsertTarget`.
 *  - `index`: child index in the container; `null` = derive from the current
 *    selection (insert after it) or append at the end. */
export interface InsertRequestDetail {
  parent: NodeId | null;
  index: number | null;
}

/** A fully resolved insertion point: an element-or-root container and a
 *  clamped child index (model `children` coordinates, PRE-insertion). */
export interface InsertTarget {
  parentId: NodeId;
  index: number;
}

/** One tile of the block inserter: a schema tag (+ sem-chat) with its
 *  descriptor-provided or synthesized insert surface. */
export interface InsertEntry {
  /** Canonical tag spelling (`sem-note`). */
  tag: string;
  title: string;
  summary: string;
  bucket: EditBucket;
  /** First descriptor template, or the synthesized minimal form. */
  template: TemplateSnippet;
  /** Descriptor wizard; non-null ⇒ the panel runs the stepper (§5.5). */
  wizard: WizardSpec | null;
}

export interface InsertGroup {
  bucket: EditBucket;
  label: string;
  entries: InsertEntry[];
}

/** Options for the block-inserter panel / wizard openers. */
export interface InsertOpenOptions {
  /** Called after a pick inserted something (panel and wizard paths). */
  onInsert?: (entry: InsertEntry, target: InsertTarget) => void;
  /** Called when the panel/wizard closed without inserting. */
  onCancel?: () => void;
}
