import { html, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext } from './shared.js';

/**
 * semext-styleguide-themes — the collection wrapper of the
 * styleguide-theme pair (contract: spec/schema/semext/styleguide-theme.md,
 * the multi-tag file). Its authored children are `semext-styleguide-theme`
 * entries; the wrapper renders only a summary line of chrome — the cards
 * themselves belong to the entry element.
 *
 * Snapshot shape (optional): `{ "themes": ["nocturne", "paper"] }` — the
 * slugs of the collection. Without a snapshot the wrapper counts its
 * authored entry children instead, so the summary is honest in both
 * cases. livePolicy stays 'never'.
 *
 * JS-off: the authored entries read as plain prose; no summary line.
 */
export class SemextStyleguideThemes extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const slugs = Array.isArray((data as { themes?: unknown })?.themes)
      ? ((data as { themes: unknown[] }).themes.filter((s) => typeof s === 'string') as string[])
      : null;
    const n = slugs ? slugs.length : this.querySelectorAll('semext-styleguide-theme').length;
    const names = slugs ? slugs.join(', ') : '';
    return html`<p class="semext-styleguide-themes-summary">
      ${n} theme${n === 1 ? '' : 's'}${names ? html` — ${names}` : ''}
    </p>`;
  }
}

defineSemext('semext-styleguide-themes', SemextStyleguideThemes);
