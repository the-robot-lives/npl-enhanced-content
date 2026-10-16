/**
 * sem-browser — edit descriptor (prose bucket, Phase 2).
 *
 * sem-browser is ABSENT from elements.json (it postdates the index the way
 * sem-chat does); this descriptor is hand-written and the schema lane must
 * seed a `SEM_BROWSER_SPEC` beside `SEM_CHAT_SPEC` (cross-lane request in
 * the desc-prose report) before `getDescriptor('sem-browser')` resolves —
 * registration alone is unreachable through the schema lookup today.
 *
 * Editing surface: the `src` attribute (URL-rule checked) and `label`.
 * The authored children are the zero-JS fallback figure — structural, so
 * no text slots and no item list. `regions()` re-anchors the wired frame
 * (title bar / address bar / viewport) to the host's model id: with no
 * `src` the element re-homes authored children into the viewport, which
 * shifts positional indexing.
 *
 * `rerender` is the one-shot-wrapper seam (EDITOR.md §3.3) with one twist:
 * SemBrowser latches behind `#wired` AND the §4.4 cleanup treats an
 * unstamped frame as an authored leftover — the first re-render of a wired
 * element removes it. The seam therefore stamps the frame
 * `data-sem-chrome` when present and rebuilds it from the shared
 * window-chrome helpers when the latch already lost it (fallback-content
 * case; the fetched-document case needs the element's own load path and is
 * reported as a cross-lane limitation).
 */

import { registerDescriptor } from '../editor/schema/registry.js';
import { bindingFor } from '../editor/controller/attach.js';
import { isRuntimeChrome } from '../editor/controller/map.js';
import { createWindowTitlebar, WINDOW_CHROME } from '../shared/window-chrome.js';
import type { RegionMap } from '../editor/schema/types.js';

/** The wired frame maps to the host's model subtree (fallback children
 *  live inside the viewport; chrome maps to the host, never to content). */
function frameRegions(el: HTMLElement): RegionMap | null {
  const root = bindingFor(el)?.rootId;
  if (root === undefined) return null;
  return [
    { selector: '.' + WINDOW_CHROME.frame, nodeId: root },
    { selector: '.' + WINDOW_CHROME.viewport + ', .' + WINDOW_CHROME.viewport + ' *', nodeId: root },
  ];
}

/** Tab title without the element's private document title: label, then the
 *  src basename, then untitled (spec priority minus the unknowable middle). */
function fallbackTabTitle(el: Element): string {
  const label = el.getAttribute('label');
  if (label !== null && label !== '') return label;
  const src = el.getAttribute('src');
  if (src !== null && src !== '') {
    const base = src.split('/').pop() ?? src;
    if (base !== '') return base;
  }
  return 'untitled';
}

registerDescriptor({
  tag: 'sem-browser',
  title: 'Browser',
  bucket: 'prose',
  summary: 'A chrome-like window that renders a SemText document live.',
  linkFields: [{ attr: 'src', label: 'Document path (src)' }],
  regions: frameRegions,
  rerender(el) {
    const doc = el.ownerDocument;
    if (doc === null) return;
    let frame = el.querySelector(':scope > .' + WINDOW_CHROME.frame);
    if (frame === null) {
      // Latched wrapper whose frame the re-render cleanup removed: rebuild
      // the standard chrome. Authored fallback content is on the host (the
      // cleanup re-projected it there); the viewport re-homes it below.
      if (!el.hasAttribute('data-sem-upgraded')) return; // authored form — first paint is the element's
      frame = doc.createElement('div');
      frame.className = WINDOW_CHROME.frame;
      frame.appendChild(createWindowTitlebar({ title: fallbackTabTitle(el) }));
      const viewport = doc.createElement('div');
      viewport.className = WINDOW_CHROME.viewport;
      viewport.setAttribute('role', 'region');
      viewport.tabIndex = 0;
      viewport.setAttribute('aria-label', `${fallbackTabTitle(el)} — browser viewport`);
      frame.appendChild(viewport);
      el.appendChild(frame);
    }
    frame.setAttribute('data-sem-chrome', ''); // survives the cleanup; never indexed
    const viewport = frame.querySelector(':scope > .' + WINDOW_CHROME.viewport);
    if (viewport === null) return;
    const src = el.getAttribute('src');
    if (src !== null && src !== '') {
      // fetched document owns the viewport; authored children are the
      // hidden zero-JS fallback and stay on the host (spec: rendered form)
      for (const node of Array.from(el.childNodes)) {
        if (node === frame || isRuntimeChrome(node)) continue;
        if (node.nodeType === Node.ELEMENT_NODE) (node as HTMLElement).hidden = true;
      }
      return;
    }
    // no src: the viewport IS the authored document — re-home the freshly
    // projected children, model is the source of truth (§4.4)
    const fresh = Array.from(el.childNodes).filter((n) => n !== frame && !isRuntimeChrome(n));
    if (fresh.length === 0) return;
    viewport.replaceChildren(...fresh);
    const title = fallbackTabTitle(el);
    viewport.setAttribute('aria-label', `${title} — browser viewport`);
    if (el.hasAttribute('label')) {
      // label outranks every other title source — safe to sync even though
      // the element's resolved document title is unknown here
      const tab = frame.querySelector(':scope > .' + WINDOW_CHROME.titlebar + ' > .' + WINDOW_CHROME.tab);
      const label = tab?.querySelector('.' + WINDOW_CHROME.tabTitle);
      if (label !== null && label !== undefined) label.textContent = el.getAttribute('label');
    }
  },
  templates: [
    {
      id: 'sem-browser',
      label: 'Browser window',
      group: 'Prose',
      xml:
        '<sem-browser src="${1:demo/example-deck.sem.html}" label="${2:the deck}">\n' +
        '  <figure class="code-window">\n' +
        '    <div aria-hidden="true">← → ⟳</div>\n' +
        '    <div>${3:demo/example-deck.sem.html}</div>\n' +
        '  </figure>\n' +
        '</sem-browser>',
    },
    {
      id: 'sem-browser-embed',
      label: 'Browser window (framed content)',
      group: 'Prose',
      xml:
        '<sem-browser label="${1:the deck}">\n' +
        '  <figure class="code-window">\n' +
        '    <div aria-hidden="true">← → ⟳</div>\n' +
        '    <div>${2:Framed content}</div>\n' +
        '  </figure>\n' +
        '</sem-browser>',
    },
  ],
});
