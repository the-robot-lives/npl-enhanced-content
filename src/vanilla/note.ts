/**
 * fallback/note — `sem-note[collapsed]` summary toggle (either authoring form).
 *
 * Marks the note with `data-sem-upgraded` (the CSS hide-rule for the body is
 * gated on that marker, so a note stays fully readable when the script never
 * runs) and inserts a ten-word teaser that expands on click. A tag-form note
 * carries its body as bare content; it is wrapped in `.sem-note-body` here
 * so the same hide rule applies. Lit-upgraded notes are skipped.
 */

import { sel } from '../shared/sel.js';

export function enhanceNote(scope: ParentNode): void {
  scope.querySelectorAll(sel('note') + '[collapsed]:not([data-sem-upgraded])').forEach((n) => {
    let body = n.querySelector('.sem-note-body');
    if (!body) {
      if (!n.firstChild) return;
      body = document.createElement('div');
      body.className = 'sem-note-body';
      while (n.firstChild) body.appendChild(n.firstChild);
      n.appendChild(body);
    }
    n.setAttribute('data-sem-upgraded', '');
    const sum = document.createElement('div');
    sum.className = 'sem-note-summary';
    sum.textContent = (body.textContent || '').trim().split(/\s+/).slice(0, 10).join(' ') + ' …';
    n.insertBefore(sum, body);
    sum.addEventListener('click', () => {
      n.removeAttribute('collapsed');
      sum.remove();
    });
  });
}
