/**
 * insert/plus — the `+` between blocks (EDITOR.md §5.5 road 1).
 *
 * Hovering the gap between element-level children reveals a `+` button
 * (`data-sem-chrome` chrome — never serialized); clicking opens the block
 * inserter scoped to that boundary. v1 stamps zones between the projected
 * top-level children of a container (the `<sem-editor>` canvas), which is
 * where block-level insertion lives; nested containers get their item `+`
 * from the controller's glyph stamping (§4.6) and descriptors.
 *
 * Re-stamp triggers: document changes (the projection is redrawn per
 * commit) and foreign DOM mutations. The observer ignores mutations that
 * only touch `data-sem-chrome` nodes — the zones' own insertions never
 * re-trigger. Placement gate: a boundary with no schema-allowed entries
 * renders no zone.
 */

import type { EditorContext } from '../controller/types.js';
import type { InsertTarget } from './types.js';
import { allowedTagsAt } from './placement.js';

export interface PlusZoneOptions {
  /** The projected canvas whose top-level children get the gaps. */
  container: HTMLElement;
  ctx: EditorContext;
  /** Open the inserter UI for a boundary (panel, popover — caller's pick). */
  openPanel: (target: InsertTarget, anchor: HTMLElement) => void;
}

/** Stamp the `+` zones; returns the detach fn (listeners + chrome removal). */
export function attachPlusZones(opts: PlusZoneOptions): () => void {
  const { container, ctx, openPanel } = opts;
  const rootId = ctx.doc.root.id;

  const zones = (): HTMLElement[] =>
    Array.from(container.querySelectorAll(':scope > .sem-ed-ins-plus-zone'));

  const restamp = (): void => {
    for (const zone of zones()) zone.remove();
    if (allowedTagsAt(ctx.doc, rootId).size === 0) return;
    const authored = Array.from(container.children).filter(
      (el) => !el.hasAttribute('data-sem-chrome'),
    );
    const document = container.ownerDocument;
    const boundaries = authored.length + 1;
    for (let i = 0; i < boundaries; i++) {
      const zone = document.createElement('span');
      zone.className = 'sem-ed-ins-plus-zone';
      zone.setAttribute('data-sem-chrome', '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sem-ed-ins-plus';
      button.textContent = '+';
      button.tabIndex = 0; // keyboard parity: the zones are tab stops (§7)
      button.setAttribute(
        'aria-label',
        i === 0
          ? 'Insert block at the beginning'
          : i === authored.length
            ? 'Insert block at the end'
            : `Insert block between position ${i} and ${i + 1}`,
      );
      button.addEventListener('click', () => {
        openPanel({ parentId: rootId, index: i }, button);
      });
      zone.appendChild(button);
      if (i < authored.length) container.insertBefore(zone, authored[i]);
      else container.appendChild(zone);
    }
  };

  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (container.isConnected) restamp();
    });
  };

  const unsubscribe = ctx.doc.on('change', schedule);
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      const touched = [...m.addedNodes, ...m.removedNodes];
      // chrome-only churn (these zones, controller glyphs) never re-triggers
      if (
        touched.some(
          (n) => n.nodeType === Node.ELEMENT_NODE && !(n as Element).hasAttribute('data-sem-chrome'),
        )
      ) {
        schedule();
        return;
      }
    }
  });
  observer.observe(container, { childList: true });
  restamp();

  return () => {
    unsubscribe();
    observer.disconnect();
    for (const zone of zones()) zone.remove();
  };
}
