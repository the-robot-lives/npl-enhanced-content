/**
 * vanilla/target — deep links that reach through disclosure state.
 *
 * A plain `#id` scrolls to an element only if it is rendered. In a SemText
 * document the target may sit inside a closed reveal, a collapsed note, an
 * inactive view or a non-current flashcard. On load and on every
 * `hashchange` this module resolves each bare hash segment (`id` or
 * `container/child`, never `name=value`), opens what encloses the target,
 * scrolls to it and marks it `.sem-target` for a moment. The marker is a
 * runtime state class: extraction ignores it (spec/extraction.md §5b).
 *
 * Enclosing elements are opened the way a reader would open them — the
 * note's summary is clicked, the view and the flashcard receive a
 * `sem-activate` event their handler (either tier) answers — so every
 * handler keeps sole ownership of its own state. The hash is never written
 * here: `sem-activate` activates without recording, so the descendant's
 * anchor stays in the address bar.
 *
 * Registered LAST in vanilla/index: every handler it drives must have
 * wired its listeners first. It also defers one macrotask so a Lit element
 * that upgraded in the same document has flushed its first update.
 *
 * Print: `beforeprint` opens every reveal `<details>` and `afterprint`
 * closes the ones it opened — CSS cannot open a closed `<details>`.
 * The tag form's component control is clicked instead (one-way — a
 * component reveal stays revealed after the print).
 */

import { bareSegments } from '../shared/state.js';
import { sel } from '../shared/sel.js';

const VIEW = sel('view');

const REVEAL = sel('reveal');
const SOURCE = sel('source') + '[data-view-as="source"]';
const OPENERS =
  sel('note') + '[collapsed], ' + VIEW + ':not([data-active]), ' +
  sel('facts') + '[data-sem-upgraded] > ' + sel('fact') + ':not(.sem-current)';

let timer = 0;

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** `id` → element; `container/child` → child id inside container, else a view by name. */
function resolve(segment: string): Element | null {
  const [head, child] = segment.split('/').map(decode);
  const root = document.getElementById(head);
  if (!root || child === undefined) return root;
  const byId = document.getElementById(child);
  if (byId && root.contains(byId)) return byId;
  return Array.from(root.querySelectorAll<HTMLElement>(VIEW)).find(
    (v) => (v.getAttribute('data-name') || '').toLowerCase() === child.toLowerCase(),
  ) || null;
}

function run(): void {
  for (const segment of bareSegments()) {
    const target = resolve(segment);
    if (!target) continue;
    // Outermost first, so a card inside a view is selected after the view shows.
    // Every ancestor is in the chain, so a source-mode wrapper anywhere above
    // the target (not only the target itself) is flipped below.
    const chain: Element[] = [];
    for (let el: Element | null = target; el; el = el.parentElement) chain.unshift(el);
    chain.forEach((el) => {
      // The reveal's <details> is its child, so it is opened from the reveal
      // whether the target is the reveal itself or something inside it. The
      // tag form has no <details> — the component's control is clicked
      // instead (the reveal is one-way there; print takes the same path).
      if (el.matches(REVEAL)) {
        const details = el.querySelector<HTMLDetailsElement>(':scope > details');
        if (details) details.setAttribute('open', '');
        else el.querySelector<HTMLElement>(':scope > button.sem-reveal-control')?.click();
      }
      // A wrapper showing its markup hides the target: switch it back to rendered.
      // Prefer the chrome (keeps aria-pressed in step); without the reading
      // bundle the attribute is presentation-only, so flip it directly.
      if (el.matches(SOURCE)) {
        const b = el.querySelector<HTMLElement>(':scope > .sem-source-chrome [data-act="html"]');
        if (b) b.click(); else el.setAttribute('data-view-as', 'html');
      }
      if (!el.matches(OPENERS)) return;
      const sum = el.querySelector<HTMLElement>(':scope > .sem-note-summary');
      if (sum) sum.click();
      else if (el.hasAttribute('collapsed')) el.removeAttribute('collapsed');
      else el.dispatchEvent(new CustomEvent('sem-activate', { bubbles: true }));
    });
    const reduce = typeof matchMedia == 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    document.querySelectorAll('.sem-target').forEach((el) => el.classList.remove('sem-target'));
    clearTimeout(timer);
    target.classList.add('sem-target');
    timer = window.setTimeout(() => target.classList.remove('sem-target'), 1500);
    return; // first resolvable segment wins
  }
}

// 0.9.1: hash state is per document, not per scope — the window listeners
// (hashchange/beforeprint/afterprint) wire ONCE no matter how often the
// re-scan calls back into the document scope.
let wired = false;

export function enhanceTarget(scope: ParentNode): void {
  if (scope !== document) return; // hash state is per document, not per scope
  if (wired) return;
  wired = true;
  window.addEventListener('hashchange', run);
  window.setTimeout(run, 0);

  let opened: Element[] = [];
  window.addEventListener('beforeprint', () => {
    opened = Array.from(document.querySelectorAll(REVEAL + ' > details:not([open])'));
    opened.forEach((d) => d.setAttribute('open', ''));
    // Component-path reveals are one-way: print shows everything, and a
    // revealed component stays revealed after the print.
    document.querySelectorAll<HTMLElement>(
      REVEAL + ':not([data-revealed]) > button.sem-reveal-control',
    ).forEach((b) => b.click());
  });
  window.addEventListener('afterprint', () => {
    opened.forEach((d) => d.removeAttribute('open'));
    opened = [];
  });
}
