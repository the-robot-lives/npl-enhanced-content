import { SemElement } from './base.js';

/**
 * sem-tldr — the namespace walking skeleton (spec/schema/sem-tldr.md).
 *
 * The user rule is explicit: no CSS-only elements — every element
 * registers a Lit component even when it is a no-logic display stub.
 * sem-tldr is exactly that stub, in its own module (not the claim-stub
 * file): it exists so the SemText extension machinery — bundles, lazy
 * loaders, manifests, validator families — can prove itself end to end
 * with one trivial `sem-*` element.
 *
 * The component does NOTHING: no render, no shadow root, no behaviour —
 * light-DOM children pass through untouched (the base's contract, PRD §4
 * rule 5). Everything visible is the vocabulary CSS: the block box, the
   "TL;DR" label chrome (::before, so it is outside textContent and the
 * extraction invariant holds byte-for-byte with the script on or off).
 *
 * It registers through the CORE barrel (src/index.ts), so it ships in
 * dist/semtext.js — `customElements.get('sem-tldr')` answers in any page
 * that loads the core bundle, and `data-sem-upgraded` is claimed at
 * connect (inherited from SemElement).
 */
export class SemTldr extends SemElement {}
SemElement.register('sem-tldr', SemTldr);
