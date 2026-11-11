import { SemElement } from './base.js';
import { param } from '../shared/attr.js';

/**
 * sem-step — one instruction of a `sem-procedure` (spec/schema/
 * sem-procedure.md). Graduated from the claim stubs.
 *
 * The visible render stays CSS (counter ordinal, status glyph, rail) so
 * JS-off reads the same; the component adds the attribute-only layer a
 * stylesheet cannot: `data-ordinal` (1-based position among its sibling
 * steps) and `aria-current="step"` on the `current` step, kept in sync as
 * `status` / `data-status` change (sem-bind hydration rewrites them).
 * No child is created or moved. Steps inside other containers
 * (sem-workflow renders its own) are claimed and otherwise left alone.
 */
export class SemStep extends SemElement {
  static properties = {
    status: { type: String },
    dataStatus: { type: String, attribute: 'data-status' },
  };

  declare status: string;
  declare dataStatus: string;

  updated(): void {
    const p = this.parentElement;
    if (!p?.matches('sem-procedure, .sem-procedure')) return;
    this.afterParse('step', () => {
      const steps = Array.from(p.children).filter((c) => c.matches('sem-step, .sem-step'));
      this.setAttribute('data-ordinal', String(steps.indexOf(this) + 1));
      if (param(this, 'status') === 'current') this.setAttribute('aria-current', 'step');
      else this.removeAttribute('aria-current');
    });
  }
}

SemElement.register('sem-step', SemStep);
