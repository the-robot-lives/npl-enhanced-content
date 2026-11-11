import { SemElement } from './base.js';
import { param } from '../shared/attr.js';
import { ensureReferenceId } from '../shared/reference-id.js';

/**
 * sem-reference — one citable entry (spec/schema/sem-references.md).
 *
 * Graduated from the claim stubs. After the parse it:
 *   - materializes the AUTO-ID when no `id` is authored
 *     (`<refs-block-id>-<referenceSlug(cite)>`, src/shared/reference-id.ts;
 *     marked `data-sem-minted-id`, so extraction keeps reading the same
 *     pure derivation with JS on or off);
 *   - stamps `data-ordinal` (1-based position in its block) — the theme
 *     draws it as the footnote number badge; JS-off the CSS counter does;
 *   - sets a `title` tooltip from `cite` when none is authored;
 *   - emits `sem:reference-ready` `{id, ordinal, minted}`.
 * Authored children are never touched; the external ↗ link, preview
 * popover and backlinks stay with src/reading/references.ts (run by the
 * sem-references wrapper), which shares the same idempotent id helper.
 */
export class SemReference extends SemElement {
  connectedCallback(): void {
    super.connectedCallback();
    this.afterParse('ref', () => {
      const id = ensureReferenceId(this);
      const sibs = this.parentElement
        ? Array.from(this.parentElement.children).filter((c) => c.matches('sem-reference, .sem-reference'))
        : [this];
      const ordinal = sibs.indexOf(this) + 1;
      this.setAttribute('data-ordinal', String(ordinal));
      const cite = param(this, 'cite');
      if (cite && !this.title) this.title = cite;
      this.emit('sem:reference-ready', { id, ordinal, minted: this.hasAttribute('data-sem-minted-id') });
    });
  }
}

SemElement.register('sem-reference', SemReference);
