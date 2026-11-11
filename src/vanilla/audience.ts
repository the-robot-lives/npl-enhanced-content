/**
 * fallback/audience — profile-gated visibility.
 *
 * Contract: spec/schema/sem-audiences.md. The matching itself lives in
 * shared/audience (pure, fail-open); this module only decides WHERE the
 * active profile comes from and WHAT to do with a `false`: set the native
 * `hidden` attribute. No class, no inline style, no marker — so a theme
 * needs no rule and extraction, which never reads `hidden`, is unaffected.
 *
 * Active profile: hash parameter `sem-audience` (shared/state, so it composes
 * with the sem-views bare segment), else the author's default `data-audience`
 * on the root wrapper or on `<html>`. The resolved profile is reflected onto
 * `<html data-audience>`, which is where the Lit tier reads it. Re-resolved
 * on every `hashchange`.
 */

import { closureFor, matches } from '../shared/audience.js';
import { getParam } from '../shared/state.js';

const WRAPPER = 'sem-enhanced-document, .sem-enhanced-document';

// 0.9.1: the bundle re-runs its passes when nodes mount late; the
// hashchange listener rides the WINDOW, so each scope wires it once —
// the document scope via a module flag, panes via a WeakSet.
const wiredScopes = new WeakSet<ParentNode>();
let documentWired = false;

// The authored default on <html>, latched at the first document-scope call.
// <html> is parsed before any bundle code runs, so the latch is safe; the
// attribute must NOT be re-read later — after the first apply it holds the
// resolved profile, not the default.
let htmlAuthored: string | null | undefined;

export function enhanceAudience(scope: ParentNode): void {
  const html = document.documentElement;
  // A pane-scoped call (a host embedding examples) reads the profile block
  // from its own scope when it declares one — two examples may each carry
  // the same profile ids, and a document-wide read would double-count them —
  // and falls back to the document's block when it declares none. A document
  // call reads the document, as before.
  const isDocument = scope === document;
  const root: Document | DocumentFragment | Element =
    isDocument || scope.querySelector('sem-audiences, .sem-audiences') === null
      ? document
      : (scope as DocumentFragment | Element);
  const wrapper = isDocument
    ? document.querySelector(WRAPPER)
    : (scope.querySelector(WRAPPER) ?? document.querySelector(WRAPPER));
  if (isDocument && htmlAuthored === undefined) htmlAuthored = html.getAttribute('data-audience');

  const apply = (): void => {
    // Everything this reads must be derived AT APPLICATION TIME. The wired
    // hashchange listener may have been installed by the first pass call,
    // which on a slow-loading page runs mid-parse — BEFORE the audience
    // block has been parsed (0.9.1 regression: a demo carries it after the
    // bundle script). A closure snapshotted then is empty forever, so every
    // later profile application failed open (unknown token → visible) and a
    // hash switch never re-gated anything. The wrapper's authored default is
    // a static content attribute — safe to re-read; the html one is our own
    // write target — hence the latch above.
    const authored =
      (wrapper && (wrapper.getAttribute('data-audience') || wrapper.getAttribute('audience'))) ||
      (isDocument ? htmlAuthored : html.getAttribute('data-audience'));
    const active = getParam('sem-audience') || authored || null;
    if (active) html.setAttribute('data-audience', active);
    else html.removeAttribute('data-audience');
    const closure = closureFor(root);
    scope.querySelectorAll<HTMLElement>('[data-audience], [audience]').forEach((el) => {
      if (el === html || el === wrapper) return; // default markers, not restrictions
      const spec = el.getAttribute('data-audience') ?? el.getAttribute('audience');
      el.toggleAttribute('hidden', !matches(spec, active, closure));
    });
  };

  if (isDocument ? !documentWired : !wiredScopes.has(scope)) {
    if (isDocument) documentWired = true;
    else wiredScopes.add(scope);
    window.addEventListener('hashchange', apply);
  }
  apply();
}
