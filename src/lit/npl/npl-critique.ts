import { SemElement } from '../base.js';
import { defineNpl } from './shared.js';

/**
 * Child parts of npl-critique, in both authoring forms (conventions
 * Appendix A, npl namespace): the bare part tag inside the element-form
 * block, or the `.npl-<part>` class alias. Scoped to the host so a nested
 * block's parts are never picked up. `sel`/`part` in shared/sel.ts are the
 * sem-* twins; the npl- class aliases stay local to the component so no
 * shared file is ever edited.
 */
const SUBJECT = ':scope > :is(subject, .npl-subject)';
const PERSPECTIVE = ':scope > :is(perspective, .npl-perspective)';
const STRENGTHS = ':scope > :is(strengths, .npl-strengths)';
const WEAKNESSES = ':scope > :is(weaknesses, .npl-weaknesses)';
const VERDICT = ':scope > :is(verdict, .npl-verdict)';
/** One bullet inside a strengths/weaknesses list: `<item>`, `.npl-item`, or an authored `<li>`. */
const ITEM = ':scope > :is(item, li, .npl-item)';
/** Any one of the five parts — the readiness signal. */
const PARTS =
  ':scope > :is(subject, perspective, strengths, weaknesses, verdict, ' +
  '.npl-subject, .npl-perspective, .npl-strengths, .npl-weaknesses, .npl-verdict)';

/**
 * npl-critique — structured critique (NPL critique blocks). Display-only:
 * no events, no interactive chrome; the vocabulary never hides authored
 * content (spec/schema/npl/npl-critique.md).
 *
 * Authored children are the content; the component only structures them
 * once they are ready (SemElement.whenChildrenReady covers the pre-parse
 * upgrade case):
 *
 *   - `subject`, `perspective`, `verdict` gain their `.npl-critique-*`
 *     part classes — theme hooks; the verdict is the highlighted line;
 *   - `strengths` and `weaknesses` are rendered as two lists: each authored
 *     item becomes an `.npl-critique-item` `<li>` inside a generated
 *     `<ul class="npl-critique-list">`, item content moved verbatim so it
 *     stays searchable and copyable (light DOM, no shadow root, no
 *     `static styles`);
 *   - a part with no items (plain prose bullets) is left exactly as
 *     authored — classed, never rewritten; the same holds when a part
 *     mixes its items with loose content, so authored nodes are never
 *     discarded.
 *
 * Parameters: none beyond the global catalog (`id` rides it as the native
 * attribute), so there is nothing to mirror to `data-*` — the reactivity
 * here is children, not attributes.
 */
export class NplCritique extends SemElement {
  #wired = false;
  #awaiting = false;

  updated(): void {
    if (this.#wired) return;
    // Fast path only for post-parse DOM (script-built or already-loaded
    // documents). During parsing an early `updated()` can see a partial
    // subtree, so defer to whenChildrenReady — it holds resolution until
    // DOMContentLoaded and the caller then sees the full part set.
    const parsed = typeof document === 'undefined' || document.readyState !== 'loading';
    if (parsed && this.querySelector(PARTS)) {
      this.#wired = true;
      this.structure();
      return;
    }
    // upgraded before its children were parsed (or they stream in later):
    // structure the moment any part exists, however late that is.
    if (this.#awaiting) return;
    this.#awaiting = true;
    void this.whenChildrenReady(PARTS).then(() => {
      if (this.#wired) return;
      this.#wired = true;
      this.structure();
    });
  }

  /** Editor rerender seam (EDITOR.md §4.4): idempotent re-labeling after a
   *  controller re-projection. */
  structure(): void {
    const label = (selector: string, cls: string): Element | null => {
      const part = this.querySelector(selector);
      if (part) part.classList.add(cls);
      return part;
    };
    label(SUBJECT, 'npl-critique-subject');
    label(PERSPECTIVE, 'npl-critique-perspective');
    // the highlighted line: the verdict keeps its authored block and gains
    // the theme hook.
    label(VERDICT, 'npl-critique-verdict');

    for (const [selector, cls] of [
      [STRENGTHS, 'npl-critique-strengths'],
      [WEAKNESSES, 'npl-critique-weaknesses'],
    ] as const) {
      const host = label(selector, cls);
      if (!host) continue;
      const items = Array.from(host.querySelectorAll(ITEM));
      if (items.length === 0) continue; // prose form — leave as authored
      // Never discard authored nodes: a part that mixes its items with
      // loose content (text or stray elements) is treated as the prose
      // form — the rewrite applies only when the content is exactly the
      // item set (whitespace between items is fine).
      const loose = Array.from(host.childNodes).some(
        (node) =>
          !items.includes(node as Element) &&
          !(node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()),
      );
      if (loose) continue;
      // A part authored as a native list (ul/ol — the class form on real
      // markup) upgrades in place: the host becomes the list, each item
      // becomes the <li>. Nesting a generated list inside it would render
      // a double-indented sublist.
      if (host.tagName === 'UL' || host.tagName === 'OL') {
        host.classList.add('npl-critique-list');
        for (const item of items) {
          const li = document.createElement('li');
          li.className = 'npl-critique-item';
          li.append(...Array.from(item.childNodes));
          item.replaceWith(li);
        }
        continue;
      }
      const list = document.createElement('ul');
      list.className = 'npl-critique-list';
      for (const item of items) {
        const li = document.createElement('li');
        li.className = 'npl-critique-item';
        li.append(...Array.from(item.childNodes));
        list.append(li);
      }
      host.replaceChildren(list);
    }
  }
}

defineNpl('npl-critique', NplCritique);

/** Editor seam — see NplCritique.structure. */
export function enhanceCritiqueElement(el: Element): void {
  if (el instanceof NplCritique) el.structure();
}
