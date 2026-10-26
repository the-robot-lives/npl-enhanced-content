// 〚📦:𓉈𔖒𓯮𔀈〛 vanilla handlers :: Core vanilla handlers: progressive enhancement with zero Lit dependency; ships only inside dist/semtext.js.
/**
 * SemText — core vanilla handlers (one-bundle surface, spec v0.6).
 *
 * This module and everything it imports must stay free of Lit. It ships
 * only inside `dist/semtext.js` (`src/index.ts` imports it), where these
 * handlers drive the elements no component defines (`sem-views`,
 * `sem-reveal`, `sem-progress`, audience gating, deep links, the alias
 * mirror, the `sem-source` snapshot pass) — the former standalone
 * `semtext-fallback.js` is retired.
 *
 * MARKER. Each handler marks what it wired with `data-sem-upgraded` — the
 * same marker the Lit components claim — and skips elements that already
 * carry it, so component and handler agree on one runtime state and every
 * hide-rule in the theme CSS is gated on one marker. With no script
 * running, nothing is hidden and the document reads as plain prose. The
 * document root (`<html>`) carries the marker once `enhance` has run, for
 * hide rules whose host element is deliberately unmarked (a list-view
 * deck's distractors).
 *
 * HISTORY: the former standalone bundle's budget (8 → 13 → 14 KB minified,
 * raised for the deep-link resolver, audience gating, the sem-source
 * snapshot and the canonical tag form) is recorded in ROADMAP.md; the
 * handlers now share the single bundle budget.
 */

import { enhanceSource } from './source.js';
import { enhanceAttrs } from './attrs.js';
import { enhanceFacts } from './facts.js';
import { enhanceDetails } from './details.js';
import { enhanceNote } from './note.js';
import { enhanceProperties } from './properties.js';
import { enhanceViews } from './views.js';
import { enhanceReveal } from './reveal.js';
import { enhanceProgress } from './progress.js';
import { enhanceAudience } from './audience.js';
import { enhanceTarget, settleTarget } from './target.js';

export type VanillaHandler = (scope: ParentNode) => void;

/**
 * Registry order is the original inline handler's order and is load-bearing:
 * `enhanceDetails` rewrites `.sem-highlight` nodes that later handlers must
 * not see twice, and `enhanceReveal` moves `.sem-reveal` children into a
 * `<details>` after `enhanceProgress`'s targets have been located.
 * `enhanceTarget` is LAST: it drives the others' listeners (note summary,
 * `sem-activate` on views and cards), which must exist before it resolves
 * the hash.
 */
export const handlers: VanillaHandler[] = [
  enhanceSource, // FIRST: snapshots sem-source markup before anything touches it
  enhanceAttrs, // then: bare tag-form attributes get their data-* twin
  enhanceFacts,
  enhanceDetails,
  enhanceNote,
  enhanceProperties,
  enhanceViews,
  enhanceReveal,
  enhanceProgress,
  enhanceAudience,
  enhanceTarget,
];

/** Run every handler over a scope. Exported so a host can re-run on new DOM. */
export function enhance(scope: ParentNode = document): void {
  if (scope === document) document.documentElement.setAttribute('data-sem-upgraded', '');
  for (const handler of handlers) handler(scope);
}

export {
  enhanceSource,
  enhanceAttrs,
  enhanceFacts,
  enhanceDetails,
  enhanceNote,
  enhanceProperties,
  enhanceViews,
  enhanceReveal,
  enhanceProgress,
  enhanceAudience,
  enhanceTarget,
  settleTarget,
};
export { wireFactsDeck } from './facts-deck.js';
