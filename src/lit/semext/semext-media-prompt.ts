import { html, nothing, type TemplateResult } from 'lit';
import { CachedEmbedElement } from '../shared/cached-embed.js';
import { defineSemext, semextParam } from './shared.js';

/**
 * semext-media-prompt — an authored media-generation prompt with an
 * output cache region (authored prompt + output; livePolicy 'never').
 *
 * The RECORD is the authored `.media.prompt` YAML (media-tools v0.4),
 * authored in a code block inside the element. The OUTPUT is a cache
 * region the future refresh CLI fills with relative asset paths, marked
 * by comment fences INSIDE the element:
 *
 *   <!-- semtext:cache:start semext-media-prompt <key> -->
 *   …filled asset list (e.g. <ul><li>assets/hero.png</li></ul>)…
 *   <!-- semtext:cache:end semext-media-prompt <key> -->
 *
 * `<key>` is the element's `key` attribute (the cachedEmbed reference
 * key); with no `key` authored, an unkeyed fence matches. The component
 * NEVER fetches and NEVER generates: it only reports the region's state —
 * "filled" (authored asset entries present) or empty (a "not generated
 * yet" placeholder as chrome). The region itself is never moved or
 * rewritten: the scan walks childNodes read-only (comment fences are
 * nodes, not elements, so the region stays invisible to CSS, extraction
 * and the position map alike) and the state lands as a `data-*
 * -cache-region` runtime attribute on the host for the CSS.
 *
 * The optional JSON snapshot mirrors the generation parameters and, once
 * a run landed, the asset manifest:
 *
 *   { "model": "z-image-turbo", "aspect": "16:9",
 *     "output": { "generated": true,
 *                 "assets": [ { "path": "assets/hero-16x9-v1.png",
 *                               "kind": "image" } ] } }
 *
 * JS-off: the authored YAML reads as a plain code block; comment fences
 * are invisible; a filled region's authored list reads as plain prose;
 * the placeholder is chrome-only (JS-off shows nothing for an empty
 * region — exactly what was authored).
 */

const START = 'semtext:cache:start semext-media-prompt';
const END = 'semtext:cache:end semext-media-prompt';

export class SemextMediaPrompt extends CachedEmbedElement {
  protected override renderChrome(data: unknown): TemplateResult {
    const [assets] = this.#region();
    this.setAttribute('data-semext-cache-region', assets > 0 ? 'filled' : 'empty');

    const model = (semextParam(this, 'model') ?? '').trim();
    const aspect = (semextParam(this, 'aspect') ?? '').trim();
    const assetsDir = (semextParam(this, 'assets-dir') ?? '').trim();
    const snapshotAssets = Array.isArray((data as { output?: { assets?: unknown } })?.output?.assets)
      ? ((data as { output: { assets: unknown[] } }).output.assets.length as number)
      : null;

    return html`
      <div class="semext-media-prompt-chrome">
        ${model || aspect || assetsDir
          ? html`<p class="semext-media-prompt-params">
              ${model ? html`<span class="semext-media-prompt-param">${model}</span>` : nothing}
              ${aspect ? html`<span class="semext-media-prompt-param">${aspect}</span>` : nothing}
              ${assetsDir ? html`<code class="semext-media-prompt-dir">${assetsDir}</code>` : nothing}
            </p>`
          : nothing}
        ${assets > 0
          ? html`<p class="semext-media-prompt-state">Output cache region — ${assets} authored asset${assets === 1 ? '' : 's'}${snapshotAssets !== null ? ` (manifest: ${snapshotAssets})` : ''}</p>`
          : html`<p class="semext-media-prompt-empty">Output not generated yet — the refresh CLI fills this region.</p>`}
      </div>
    `;
  }

  /**
   * The cache region, read-only: [authored asset count, region seen]. A
   * region is the child index range between a matching start and end
   * fence (exact match, or the fence keyed with this element's `key`).
   * An unclosed start fence still counts as a region (the CLI may be
   * mid-fill) but never throws.
   */
  #region(): [number, boolean] {
    const key = (semextParam(this, 'key') ?? '').trim();
    const nodes = this.childNodes;
    const matches = (text: string, word: string): boolean => {
      if (text === word) return true;
      return !!key && text.startsWith(word) && text.slice(word.length).trim() === key;
    };
    let start = -1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.nodeType !== 8) continue; // COMMENT_NODE
      const text = (n.nodeValue ?? '').trim();
      if (start < 0) {
        if (matches(text, START)) start = i;
      } else if (matches(text, END)) {
        return this.#countAssets(nodes, start + 1, i);
      }
    }
    if (start >= 0) return this.#countAssets(nodes, start + 1, nodes.length);
    return [0, false];
  }

  /** Asset entries at or beneath the nodes strictly between the fences.
   *  One count per asset: an a/img/[data-semext-asset] element (self or
   *  descendant) counts once; a list of bare text items counts one per
   *  list entry. */
  #countAssets(nodes: NodeListOf<ChildNode>, from: number, to: number): [number, boolean] {
    const SELF = 'a, img, [data-semext-asset]';
    let n = 0;
    for (let i = from; i < to; i++) {
      const node = nodes[i];
      if (node.nodeType !== 1) continue; // ELEMENT_NODE
      const el = node as Element;
      if (el.matches(SELF)) {
        n += 1;
      } else {
        const linked = el.querySelectorAll(SELF);
        n += linked.length ? linked.length : el.querySelectorAll('li').length;
      }
    }
    return [n, true];
  }
}

defineSemext('semext-media-prompt', SemextMediaPrompt);
