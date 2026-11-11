/**
 * reading/see-also — `sem-see-also` related-reference previews, modal and
 * the `#ref=` deep link (spec/schema/sem-see-also.md).
 *
 * A see-also names ONE related target — a section of this document, a
 * component card, or a file — and renders it as a link with three
 * affordances, all on the shared surfaces the other reading behaviours use:
 *
 *   - hover / focus: a preview in the one shared popover (shared/popover.ts,
 *     the glossary surface) — `preview="tldr"` clones the target's summary
 *     (its `sem-tldr`, else its heading + first paragraph; for a component
 *     target the card's head), `preview="file"` shows the authored text as
 *     the description of the named path.
 *   - click: the target opens in the shared modal shell (shared/modal.ts) —
 *     a CLONE (cloneContent: ids/roles stripped, interactive descendants
 *     inert), so the document never moves and a second open re-clones
 *     fresh. Esc/close returns to the page; focus goes back to the link.
 *   - "View all": a small affordance after the link that opens the target
 *     in a NEW TAB (target=_blank) — the escape hatch when the reader wants
 *     the real context, not the preview.
 *
 * `insert-as="inline"` skips link chrome and embeds the target's content
 * in place (authored children stay as the heading/label). Deep links:
 * `#ref=<id>` (the src/data/deeplink.ts grammar, alongside `#dv=`) opens
 * the named see-also's modal once per page load.
 *
 * JS-off, the authored children ARE the record — the target reference as
 * plain text. Everything here is idempotent per element (runtime class +
 * chrome markers), so the Lit component and the document scan may run in
 * either order.
 */

import { param } from '../shared/attr.js';
import { attachPreview, cloneContent } from '../shared/popover.js';
import { openModalShell } from '../shared/modal.js';
import { parseDataDeepLink } from '../data/deeplink.js';

export const SEE_ALSO = ':is(sem-see-also, .sem-see-also)';

const REF_FLAG = 'data-sem-ref-open';

interface ResolvedTarget {
  kind: 'section' | 'component' | 'file';
  /** The resolved in-document element, when the target is one. */
  el: Element | null;
  /** Link URL for the View-all affordance. */
  href: string;
  /** Dialog/preview title. */
  title: string;
}

/** The author-facing warning channel — same one the fallback core uses. */
function warn(el: Element, message: string): void {
  (el as { warn?: (m: string) => void }).warn?.(message);
  // Class-form authors have no SemElement.warn — console once, quietly.
  if (typeof console !== 'undefined') console.warn('[sem-see-also] ' + message);
}

/** Strip a leading '#' from a section target. */
const fragId = (t: string): string => (t.startsWith('#') ? t.slice(1) : t);

/** Resolve the `reference`/`target` pair against the document. */
function resolveTarget(el: Element): ResolvedTarget {
  const kind = (param(el, 'reference') ?? 'section') as ResolvedTarget['kind'];
  const target = (param(el, 'target') ?? '').trim();
  const explicit = (param(el, 'href') ?? '').trim();
  if (kind === 'file') {
    return { kind, el: null, href: explicit || target, title: target || 'Related file' };
  }
  if (kind === 'component') {
    // A component card by tag, else any element carrying the id.
    const q = target.replace(/"/g, '\\"');
    const card = target
      ? document.querySelector(`sem-component[tag="${q}"], .sem-component[data-sem-component-tag="${q}"]`)
      : null;
    const byId = target ? document.getElementById(fragId(target)) : null;
    const found = card ?? byId;
    const id = found?.id || byId?.id || fragId(target);
    return {
      kind,
      el: found,
      href: explicit || (id ? '#' + id : target),
      title: (card?.getAttribute('name') || byId?.getAttribute('name') || target) || 'Related component',
    };
  }
  // section
  const found = target ? document.getElementById(fragId(target)) : null;
  // The human title: the target's own heading text when the target is one
  // or carries one, else the authored address.
  const heading = (el: Element | null): string | null => {
    if (!el) return null;
    if (/^H[1-6]$/.test(el.tagName)) return (el.textContent || '').trim() || null;
    const h = el.querySelector('h1,h2,h3,h4,h5,h6');
    return h ? (h.textContent || '').trim() || null : null;
  };
  return {
    kind: 'section',
    el: found,
    href: explicit || (target ? '#' + fragId(target) : ''),
    title: heading(found) || target || 'Related section',
  };
}

/** The target's summary: sem-tldr, else heading + first paragraph. */
function summaryOf(target: Element): DocumentFragment | null {
  const tldr = target.querySelector(':scope > .sem-tldr, :scope > sem-tldr');
  if (tldr) return cloneContent(tldr, '.sem-popover');
  const frag = document.createDocumentFragment();
  const head = target.querySelector(':scope > :is(h1,h2,h3,h4,h5,h6,.sem-component-head)');
  if (head) frag.appendChild(cloneContent(head, '.sem-popover'));
  const p = target.querySelector(':scope > p, :scope > .sem-component-body');
  if (p) frag.appendChild(cloneContent(p, '.sem-popover'));
  return frag.childNodes.length > 0 ? frag : null;
}

/** Preview render for the shared popover. */
function previewFor(el: Element, target: ResolvedTarget): () => Node | null {
  const mode = param(el, 'preview') ?? 'tldr';
  return (): Node | null => {
    const term = document.createElement('strong');
    term.className = 'sem-popover-term';
    term.textContent = target.title;
    const frag = document.createDocumentFragment();
    frag.appendChild(term);
    if (mode === 'tldr') {
      if (target.el) {
        const body = summaryOf(target.el);
        if (body) {
          frag.appendChild(body);
          return frag;
        }
      }
      // No live target (dangling id, or a file preview falling through):
      // the authored text is the preview body.
      frag.appendChild(cloneContent(el, '.sem-popover'));
      return frag;
    }
    // preview="file" — the authored text describes the referenced path.
    frag.appendChild(cloneContent(el, '.sem-popover'));
    if (target.kind === 'file') {
      const code = document.createElement('code');
      code.className = 'sem-see-also-path';
      code.textContent = target.href;
      frag.appendChild(code);
    }
    return frag;
  };
}

/** The modal body: a fresh clone of the target's content. */
function modalContent(el: Element, target: ResolvedTarget): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (target.el) {
    // The target itself is the content — minus its own popover-hostile
    // ids (cloneContent strips them) and any nested see-also chrome.
    frag.appendChild(cloneContent(target.el, '.sem-popover'));
  } else {
    frag.appendChild(cloneContent(el, '.sem-popover'));
    if (target.kind === 'file') {
      const p = document.createElement('p');
      p.className = 'sem-see-also-path-note';
      const code = document.createElement('code');
      code.textContent = target.href;
      p.appendChild(code);
      frag.appendChild(p);
    }
  }
  return frag;
}

/** Open the see-also modal over a detached holder carrying the clone. */
function openSeeAlsoModal(el: Element, target: ResolvedTarget): void {
  const holder = document.createElement('div');
  holder.appendChild(modalContent(el, target));
  openModalShell(holder, {
    label: target.title,
    backdropClass: 'sem-see-also-modal',
    panelClass: 'sem-see-also-modal-panel',
    closeClass: 'sem-see-also-modal-close',
    contentClass: 'sem-see-also-modal-content',
    flagAttr: REF_FLAG,
  });
  holder.remove(); // children came home to the detached holder — drop it
}

/** The View-all affordance: the target, in a new tab. */
function viewAllLink(target: ResolvedTarget): HTMLAnchorElement | null {
  if (!target.href) return null;
  const a = document.createElement('a');
  a.className = 'sem-see-also-view';
  a.setAttribute('data-sem-chrome', '');
  a.href = target.href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'View all';
  return a;
}

/** Wire one see-also element. Idempotent (chrome markers). */
export function enhanceSeeAlsoElement(el: Element): void {
  if (el.classList.contains('sem-see-also') && el.hasAttribute('data-sem-upgraded')) return;
  el.classList.add('sem-see-also');
  const mode = param(el, 'insert-as') ?? 'link';
  el.setAttribute('data-insert-as', mode);
  const target = resolveTarget(el);

  if (mode === 'inline') {
    // Embed the target in place: authored children stay as the label.
    const box = document.createElement('div');
    box.className = 'sem-see-also-inline';
    box.setAttribute('data-sem-chrome', '');
    if (target.el) {
      box.appendChild(cloneContent(target.el, '.sem-popover'));
    } else if (target.kind === 'file') {
      const code = document.createElement('code');
      code.className = 'sem-see-also-path';
      code.textContent = target.href;
      box.appendChild(code);
    }
    el.appendChild(box);
    el.setAttribute('data-sem-upgraded', '');
    return;
  }

  // Link mode: anchor + View-all chrome; authored children become the
  // label clone (and stay in the DOM as the JS-off record, hidden by the
  // upgraded hide-rule).
  if (el.querySelector(':scope > .sem-see-also-link')) return; // already wired
  const label = document.createElement('span');
  label.className = 'sem-see-also-label';
  label.appendChild(cloneContent(el, '.sem-popover'));
  const a = document.createElement('a');
  a.className = 'sem-see-also-link';
  a.setAttribute('data-sem-chrome', '');
  a.href = target.href || '#';
  a.setAttribute('aria-haspopup', 'dialog');
  a.appendChild(label);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    openSeeAlsoModal(el, target);
  });
  el.appendChild(a);
  attachPreview(a, previewFor(el, target));
  const view = viewAllLink(target);
  if (view) el.appendChild(view);
  if (!target.el && target.kind !== 'file') {
    warn(el, `target "${param(el, 'target')}" resolves to nothing in this document`);
  }
  el.setAttribute('data-sem-upgraded', '');
}

/* ------------------------------------------------------------- deep links */

let refOpened = false;

/** Apply a `#ref=<id>` hash: open the named see-also's modal, once. */
export function applySeeAlsoDeepLink(): void {
  if (refOpened) return;
  const link = parseDataDeepLink(location.hash);
  if (!link || link.ref === null) return;
  const el = document.getElementById(link.ref);
  if (!el || !el.matches(SEE_ALSO)) return;
  refOpened = true;
  const target = resolveTarget(el);
  openSeeAlsoModal(el, target);
}

/** Test hook: reset the once-per-page ref-open latch. */
export function resetSeeAlsoLatch(): void {
  refOpened = false;
}

/** Document scan — the reading bundle's per-pass entry. */
export function enhanceSeeAlso(scope: ParentNode): void {
  scope.querySelectorAll(SEE_ALSO).forEach((el) => {
    if (el.hasAttribute('data-sem-upgraded')) return;
    enhanceSeeAlsoElement(el);
    el.setAttribute('data-sem-upgraded', '');
  });
  applySeeAlsoDeepLink();
}
