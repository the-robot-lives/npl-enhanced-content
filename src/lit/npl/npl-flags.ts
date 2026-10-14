import { html } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-flags — a runtime flag configuration block: an optional preset badge
 * hosting `npl-flag` children and optional note text (light DOM — authored
 * children survive beside the render output, same contract as npl-example).
 *
 * The `preset` attribute is optional, one of NPL_PRESETS (the NPL flag
 * source spells them `preset:minimal|full|production|creative|tireless`;
 * the attribute accepts the bare word or that prefixed spelling). An
 * unknown preset warns and renders with the `npl-flags-preset-invalid`
 * warning class. No interactivity of its own: `npl-flag` children own the
 * click-to-apply behavior and the `npl-flags-change` event
 * (spec/schema/npl/npl-flags.md).
 */
export const NPL_PRESETS = ['minimal', 'full', 'production', 'creative', 'tireless'] as const;
export type NplPreset = (typeof NPL_PRESETS)[number];

/** Accept `production` or the source spelling `preset:production`. */
function normalizePreset(raw: string): string {
  return raw.startsWith('preset:') ? raw.slice('preset:'.length) : raw;
}

export class NplFlags extends SemElement {
  static properties = {
    preset: { type: String, reflect: true },
  };

  declare preset: string;

  constructor() {
    super();
    this.preset = '';
  }

  updated(): void {
    const preset = normalizePreset(nplParam(this, 'preset', this.preset));
    if (preset && !(NPL_PRESETS as readonly string[]).includes(preset)) {
      this.warn(
        `npl-flags: unknown preset "${preset}" — expected one of ${NPL_PRESETS.join('|')}`,
      );
    }
    // chrome order: the generated preset badge leads the element, the authored
    // `npl-flag` children and note text follow (npl-agent's rule). Light DOM
    // skips LitElement's renderBefore adjustment (base.ts returns `this`), and
    // the container can upgrade with its children already present (innerHTML,
    // hydration, class-form markup), so enforce the position here. Checked
    // against firstChild, not firstElementChild: a note-only body puts a text
    // node ahead of the badge.
    const badge = this.querySelector(':scope > .npl-flags-preset');
    if (badge && badge !== this.firstChild) {
      this.insertBefore(badge, this.firstChild);
    }
    // dual-form contract: the data-* spelling mirrors the bare attribute,
    // so CSS/extraction read one form (deferred past parse, like sem-note).
    this.afterParse('preset', () => this.setAttribute('data-preset', preset));
  }

  render() {
    const preset = normalizePreset(nplParam(this, 'preset', this.preset));
    if (!preset) return html``;
    const known = (NPL_PRESETS as readonly string[]).includes(preset);
    return html`<span class="npl-flags-preset${known ? '' : ' npl-flags-preset-invalid'}">preset:${preset}</span>`;
  }
}

defineNpl('npl-flags', NplFlags);
