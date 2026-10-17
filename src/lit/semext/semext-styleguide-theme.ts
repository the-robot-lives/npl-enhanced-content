import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';

/**
 * semext-styleguide-theme — a theme token card rendered from a cached
 * snapshot (static snapshot; livePolicy 'never'). The authored inner
 * content IS the record (the theme's stated tokens); the snapshot mirrors
 * them for the card chrome.
 *
 * Snapshot shape:
 *
 *   { "theme": {
 *       "name": "Nocturne",
 *       "slug": "nocturne",
 *       "colors": [ { "token": "--sem-accent", "value": "#7aa2f7",
 *                     "role": "accent" } ],
 *       "typography": { "heading": "Iosevka, monospace",
 *                       "body": "Inter, sans-serif",
 *                       "sample": "The quick brown fox…" } } }
 *
 * Attributes:
 *   theme   the theme slug (informational here; selects nothing)
 *   src     URL of the theme CSS — the "Preview theme CSS" link's href,
 *           rendered only when the attribute is authored
 *
 * Swatch VALUES come from the authored snapshot (author-trusted, like the
 * rest of the document), but they are applied only when they parse as a
 * plain color (hex / rgb(a) / hsl(a) / simple named form); anything else
 * renders as text and gets no inline style — no CSS injection surface.
 *
 * JS-off: authored children read as plain prose; the card is not drawn.
 */

interface ThemeColor {
  token?: string;
  value?: string;
  role?: string;
}

interface ThemeSnapshot {
  name?: string;
  slug?: string;
  colors?: ThemeColor[];
  typography?: { heading?: string; body?: string; sample?: string };
}

function themeOf(data: unknown): ThemeSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data as { theme?: unknown }).theme ?? data;
  return t && typeof t === 'object' ? (t as ThemeSnapshot) : null;
}

/** A conservative plain-color test: hex, rgb(a), hsl(a), or one word. */
function plainColor(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v || v.length > 64) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(rgba?|hsla?)\(\s*[-0-9.%,\s/]+\)$/i.test(v)) return v;
  if (/^[a-z]+$/i.test(v)) return v;
  return null;
}

export class SemextStyleguideTheme extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const theme = themeOf(data);
    if (!theme) {
      return html`<p class="semext-styleguide-theme-missing">No theme snapshot.</p>`;
    }
    const src = (semextParam(this, 'src') ?? '').trim();
    const colors = Array.isArray(theme.colors) ? theme.colors : [];
    const type = theme.typography ?? {};
    return html`
      <div class="semext-styleguide-theme-card">
        <h3 class="semext-styleguide-theme-name">${theme.name ?? theme.slug ?? 'Theme'}</h3>
        ${colors.length
          ? html`
              <ul class="semext-styleguide-theme-swatches">
                ${colors.map(
                  (c) => html`
                    <li class="semext-styleguide-theme-swatch">
                      <span
                        class="semext-styleguide-theme-dot"
                        style=${plainColor(c.value) ? `background: ${plainColor(c.value)}` : nothing}
                      ></span>
                      <code class="semext-styleguide-theme-token">${c.token ?? ''}</code>
                      <span class="semext-styleguide-theme-value">${c.value ?? ''}</span>
                    </li>
                  `,
                )}
              </ul>
            `
          : nothing}
        ${type.heading || type.body
          ? html`
              <dl class="semext-styleguide-theme-type">
                ${type.heading ? html`<dt>heading</dt><dd>${type.heading}</dd>` : nothing}
                ${type.body ? html`<dt>body</dt><dd>${type.body}</dd>` : nothing}
              </dl>
            `
          : nothing}
        ${type.sample ? html`<p class="semext-styleguide-theme-sample">${type.sample}</p>` : nothing}
        ${src
          ? html`<a class="semext-styleguide-theme-preview" href=${src} target="_blank" rel="noopener">Preview theme CSS</a>`
          : nothing}
      </div>
    `;
  }
}

defineSemext('semext-styleguide-theme', SemextStyleguideTheme);
