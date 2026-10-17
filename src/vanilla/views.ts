/**
 * fallback/views — `.sem-views[id]` tab bar, arrow-key navigation and
 * `#<container-id>/<view>` deep links.
 *
 * The deep link is the bare hash segment `<id>/<view>`; it is read and
 * written through shared/state so a named parameter beside it
 * (`&sem-audience=…`) survives a tab switch. Format and the `sem-navigate`
 * CustomEvent payload are asserted by test/e2e/sem-views.cy.js.
 *
 * Marks the container `data-sem-upgraded`: the inactive-view hide rule is
 * gated on that marker (D12), so with no script every view renders stacked.
 *
 * The container is a region (`role="region"`, `aria-label` = authored label
 * or the id); the `tablist` role sits on the generated bar, which owns the
 * tab buttons. Tabs get ids, `aria-controls` and a roving tabindex; views
 * get `role="tabpanel"` + `aria-labelledby`. A view without an authored id
 * receives a generated panel id for that wiring only — deep links still
 * record the authored id-or-name, so `#<id>/<name>` stays canonical.
 * Arrow keys wrap; Home/End jump to the first/last view. If the view being
 * hidden held focus, focus follows to its tab.
 *
 * Switching never moves or rewrites content: only `data-active`,
 * `aria-selected`, tab state and the hash segment change.
 *
 * `sem-activate` dispatched on a view (by fallback/target for a deep link
 * into a view's descendant) activates it WITHOUT rewriting the hash, so the
 * descendant's own anchor stays in the address bar.
 */

import { bareSegments, setBare } from '../shared/state.js';
import { sel } from '../shared/sel.js';

const VIEW = sel('view');

export function enhanceViews(scope: ParentNode): void {
  scope.querySelectorAll<HTMLElement>(sel('views') + '[id]').forEach((root) => {
    const views = Array.from(root.querySelectorAll<HTMLElement>(VIEW));
    if (!views.length) return;
    // Idempotent re-scan guard (0.9.1): the bundle re-runs its passes over
    // the document whenever nodes mount late (island/SPA hosts). The bar,
    // the hashchange/sem-activate listeners and the deepIds capture are
    // built once per container — a second build would duplicate the bar
    // and stack stale closures over the same views.
    if (root.querySelector(':scope > .sem-views-tabs')) return;
    root.setAttribute('data-sem-upgraded', '');
    if (!root.hasAttribute('role')) root.setAttribute('role', 'region');
    if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', root.id);

    const marked = views.filter((v) => v.hasAttribute('data-active'));
    if (marked.length > 1) {
      console.warn(`[semtext] <sem-views id="${root.id}">: ${marked.length} views carry active; first wins.`);
      marked.slice(1).forEach((v) => v.removeAttribute('data-active'));
    }
    if (!marked.length) views[0].setAttribute('data-active', '');
    let active = Math.max(0, views.findIndex((v) => v.hasAttribute('data-active')));

    // Authored identities (id, else lowercased name) are captured before any
    // generated panel ids exist, so the hash always records the canonical
    // `#<container>/<id-or-name>` form, never `<container>-view-<n>`.
    const deepIds = views.map((v) => v.id || (v.getAttribute('data-name') || '').toLowerCase());

    const bar = document.createElement('div');
    bar.className = 'sem-views-tabs';
    bar.setAttribute('role', 'tablist');
    const tabs: HTMLButtonElement[] = [];
    const tabId = (k: number): string => `${root.id}-tab-${k + 1}`;
    views.forEach((v, k) => {
      if (!v.id) {
        v.id = `${root.id}-view-${k + 1}`;
        // Runtime state marker (conventions: script state is always
        // data-*): the id is ours for aria wiring, not authored identity,
        // so extraction must not report it as the record id.
        v.setAttribute('data-sem-minted-id', '');
      }
      v.setAttribute('role', 'tabpanel');
      v.setAttribute('aria-labelledby', tabId(k));
      const b = document.createElement('button');
      b.type = 'button';
      b.id = tabId(k);
      b.setAttribute('role', 'tab');
      b.textContent = v.getAttribute('data-name') || `View ${k + 1}`;
      b.setAttribute('aria-selected', String(k === active));
      b.setAttribute('aria-controls', v.id);
      b.tabIndex = k === active ? 0 : -1; // roving tabindex: the active tab is the only stop
      b.addEventListener('click', () => { activate(k); });
      b.addEventListener('keydown', (e) => {
        const last = views.length - 1;
        if (e.key === 'ArrowRight') { e.preventDefault(); activate(active === last ? 0 : active + 1, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); activate(active === 0 ? last : active - 1, true); }
        if (e.key === 'Home') { e.preventDefault(); activate(0, true); }
        if (e.key === 'End') { e.preventDefault(); activate(last, true); }
      });
      tabs.push(b);
      bar.appendChild(b);
    });
    root.insertBefore(bar, root.firstChild);

    function activate(k: number, focus?: boolean, silent?: boolean): void {
      const prev = active;
      active = k;
      views.forEach((v, j) => {
        if (j === k) v.setAttribute('data-active', ''); else v.removeAttribute('data-active');
      });
      tabs.forEach((t, j) => {
        t.setAttribute('aria-selected', String(j === k));
        t.tabIndex = j === k ? 0 : -1;
      });
      const v = views[k];
      if (!silent) setBare(root.id, deepIds[k]);
      v.dispatchEvent(new CustomEvent('sem-navigate', {
        bubbles: true, detail: { id: root.id, name: v.getAttribute('data-name'), index: k },
      }));
      // A panel that hid while holding focus must not strand the reader:
      // focus follows to the tab of the view now shown.
      const hadFocus = prev !== k && views[prev].contains(document.activeElement);
      if (focus || hadFocus) tabs[k].focus();
    }

    function fromHash(): void {
      const head = root.id + '/';
      const seg = bareSegments().find((b) => b.startsWith(head));
      if (!seg) return;
      const want = seg.slice(head.length);
      const k = views.findIndex(
        (v) => v.id === want || (v.getAttribute('data-name') || '').toLowerCase() === want,
      );
      if (k >= 0 && k !== active) activate(k);
    }
    window.addEventListener('hashchange', fromHash);
    root.addEventListener('sem-activate', (e) => {
      // e.target may be a descendant of the view that owns it; resolve the view.
      const host = e.target instanceof Element ? e.target.closest<HTMLElement>(VIEW) : null;
      const k = host ? views.indexOf(host) : -1;
      if (k >= 0 && k !== active) activate(k, false, true);
    });
    fromHash();
  });
}
