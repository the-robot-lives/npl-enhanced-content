/**
 * popover — one hover / focus preview surface per document.
 *
 * Used by sem-references (citation → reference preview) and glossary-mode
 * sem-properties (term → definition preview). One `.sem-popover` element
 * is created lazily on first show and reused: content is swapped, the
 * box is positioned under the anchor, and `aria-describedby` on the
 * anchor points at it while it is open. Native `popover` (top layer) is
 * used where the browser has it; otherwise a fixed-position div does the
 * same job.
 *
 * WCAG 2.2 SC 1.4.13 (Content on Hover or Focus) — dismissible, hoverable,
 * persistent:
 *   - Dismissible: `Esc` closes it and never moves focus.
 *   - Hoverable: leaving the anchor starts a short hide delay instead of
 *     closing at once, and entering the preview cancels it, so the pointer
 *     can travel the gutter between anchor and box without the content
 *     vanishing under it.
 *   - Persistent: it stays open until the pointer has left both the anchor
 *     and the preview (plus the delay), the anchor loses focus, the anchor
 *     is clicked, or `Esc` is pressed.
 * Focus still opens and blur still closes immediately; clicking the anchor
 * closes so navigation is never hidden behind the preview.
 *
 * PLACEMENT TRACKS THE ANCHOR. The box is `position: fixed`, so it is
 * placed from the anchor's viewport rect — and that rect moves. Focusing
 * an off-screen anchor scrolls it into view, and with the vocabulary's
 * `scroll-behavior: smooth` that scroll is an animation: the `focus` event
 * fires while the anchor is still off-screen, so a one-shot placement
 * parked the preview outside the viewport (CI caught it; a fast local
 * scroll had already landed). While open, every scroll and resize
 * re-places the box, and the placement is clamped into the viewport.
 *
 * Content is CLONED from the source element with ids and chrome stripped
 * (`cloneContent`), so a preview can never mint a duplicate id, and the
 * box itself carries a chrome class extraction skips (spec/extraction.md
 * §3.4). The box lives at the end of <body>, outside the root wrapper.
 */

let box: HTMLElement | null = null;
let current: Element | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let docWired = false;

/**
 * Grace window between the pointer leaving the anchor and the preview
 * closing — the SC 1.4.13 bridge. Long enough to cross the gutter between
 * anchor and box, short enough to feel instant when the pointer just moves
 * on. Focus and click paths still close immediately.
 */
const HIDE_DELAY_MS = 200;

function cancelPendingHide(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(anchor: Element): void {
  cancelPendingHide();
  // Bare setTimeout, not window.setTimeout — the same thing in a browser,
  // and the global the test runner fakes.
  hideTimer = setTimeout(() => {
    hideTimer = null;
    hide(anchor);
  }, HIDE_DELAY_MS);
}

function ensure(): HTMLElement {
  // `box.isConnected` — a swapped-out body (SPA navigation, tests) leaves
  // the stale node detached; recreate instead of showing into the void.
  if (box && box.isConnected) return box;
  box = document.createElement('div');
  box.className = 'sem-popover';
  box.id = 'sem-popover';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  if ('popover' in box) box.setAttribute('popover', 'manual');
  document.body.appendChild(box);
  // The hover bridge lives on the box: entering it cancels a pending hide,
  // leaving it starts one (SC 1.4.13 "hoverable"). Re-attached with the box.
  box.addEventListener('mouseenter', cancelPendingHide);
  box.addEventListener('mouseleave', () => {
    if (current) scheduleHide(current);
  });
  // Document/window wiring is per document, not per box — wire once.
  if (!docWired) {
    docWired = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide(); // dismissible: never moves focus
    });
    const track = (): void => {
      if (current && box && !box.hidden) place(current, box);
    };
    window.addEventListener('scroll', track, { passive: true, capture: true });
    window.addEventListener('resize', track, { passive: true });
  }
  return box;
}

function place(anchor: Element, b: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  const w = b.offsetWidth;
  const h = b.offsetHeight;
  let left = r.left;
  if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
  // The top bound clears a pinned sem-reader bar (`--sem-reader-offset`,
  // set on <html> by reading/reader.ts) so a preview flipped above its
  // anchor never slides underneath the chrome.
  const min = 8 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sem-reader-offset')) || 0);
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8 && r.top - h - 6 >= min) top = r.top - h - 6;
  top = Math.max(min, Math.min(top, window.innerHeight - h - 8));
  b.style.left = left + 'px';
  b.style.top = top + 'px';
}

function show(anchor: Element, render: () => Node | null): void {
  const content = render();
  if (!content) return;
  const b = ensure();
  cancelPendingHide(); // a pending hide for a previous anchor is moot
  if (current && current !== anchor) current.removeAttribute('aria-describedby');
  b.replaceChildren(content);
  current = anchor;
  b.hidden = false;
  if (b.hasAttribute('popover')) {
    try { b.hidePopover(); } catch { /* not open */ }
    try { b.showPopover(); } catch { /* disconnected */ }
  }
  place(anchor, b);
  anchor.setAttribute('aria-describedby', b.id);
}

/** Hide the preview. With an anchor, only if that anchor owns it. */
export function hide(anchor?: Element): void {
  cancelPendingHide();
  if (!box || box.hidden) return;
  if (anchor && current !== anchor) return;
  if (box.hasAttribute('popover')) {
    try { box.hidePopover(); } catch { /* not open */ }
  }
  box.hidden = true;
  current?.removeAttribute('aria-describedby');
  current = null;
}

/**
 * Wire an anchor to show `render()` on hover / focus. Idempotency is the
 * caller's job (it stamps a runtime class on the anchor and checks it).
 *
 * `mouseleave` does not close: it opens the hover-bridge window (see
 * HIDE_DELAY_MS) so the pointer can reach the preview. The bridge is
 * completed by the box's own mouseenter/mouseleave in `ensure()`.
 */
export function attachPreview(anchor: Element, render: () => Node | null): void {
  anchor.addEventListener('mouseenter', () => show(anchor, render));
  anchor.addEventListener('focus', () => show(anchor, render));
  anchor.addEventListener('mouseleave', () => scheduleHide(anchor));
  anchor.addEventListener('blur', () => hide(anchor));
  anchor.addEventListener('click', () => hide(anchor));
}

/**
 * Deep-clone `source`'s children into a fragment, dropping anything that
 * matches `skip` and every `id` / `role` attribute so the copy is inert.
 *
 * Interactive descendants are also neutered (SC 1.4.13: the preview is a
 * transient supplement to content reachable at the anchor): `tabindex=-1`
 * takes them out of the tab order — keyboard users must never land inside
 * a preview that can vanish under them — and `aria-hidden` stops their
 * names being announced a second time while the anchor already names the
 * preview via `aria-describedby`.
 */
export function cloneContent(source: Element, skip: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  source.childNodes.forEach((n) => {
    if (n.nodeType === 1 && skip && (n as Element).matches(skip)) return;
    frag.appendChild(n.cloneNode(true));
  });
  frag.querySelectorAll('[id], [role]').forEach((el) => {
    el.removeAttribute('id');
    el.removeAttribute('role');
  });
  frag
    .querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')
    .forEach((el) => {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('aria-hidden', 'true');
    });
  return frag;
}
