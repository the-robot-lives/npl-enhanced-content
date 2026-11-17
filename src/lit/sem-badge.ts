import { SemElement } from './base.js';

/**
 * sem-badge — small inline status chip (spec/schema/sem-badge.md).
 * Light DOM: the authored text stays the content. The glyph and colour
 * come from vocabulary CSS keyed on `variant`, so the JS-off rendering is
 * identical; this element only normalises an unknown variant to `neutral`
 * (mirrored to `data-variant`) and keeps the chip a plain inline run.
 */
export const BADGE_VARIANTS = ['success', 'warning', 'danger', 'info', 'neutral'] as const;
export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

export class SemBadge extends SemElement {
  static properties = {
    variant: { type: String },
  };

  declare variant: string;

  constructor() {
    super();
    this.variant = 'neutral';
  }

  updated(): void {
    const v = (BADGE_VARIANTS as readonly string[]).includes(this.variant) ? this.variant : 'neutral';
    // deferred: a parse-time write would leak into a sem-source snapshot
    this.afterParse('variant', () => this.setAttribute('data-variant', v));
  }
}
SemElement.register('sem-badge', SemBadge);
