import { html } from 'lit';
import { SemElement } from '../base.js';
import { hasParam } from '../../shared/attr.js';
import { defineNpl } from './shared.js';

/**
 * npl-mode — display-only cognitive lens declaration. The authored `mode`
 * children (each with a required `type` attribute) enumerate the cognitive
 * lenses of an NPL agent; the component renders one chip per typed child,
 * labelled by its type, marking them all when the `primary` parameter is
 * present in either authoring spelling (`data-primary` wins when both are).
 * Pattern proven by npl-example; the recipe stays:

 *   - extend SemElement — light DOM (no shadow root, no static styles),
 *     the `data-sem-upgraded` claim, afterParse, whenChildrenReady;
 *   - reactive `static properties` for parameters, mirrored to the
 *     `data-*` spelling in `updated()` via afterParse (the dual-form
 *     contract sem-note's variant follows; a parse-time write would leak
 *     into a sem-source snapshot, hence afterParse). The mirror writes the
 *     *resolved* value, so an authored `data-primary` is never clobbered
 *     by the default (conventions §2: `data-*` wins when both are present);
 *   - generated chrome leads the element, authored children follow —
 *     light DOM skips LitElement's renderBefore adjustment (base.ts
 *     returns `this`), so `updated()` enforces the order (npl-agent's rule);
 *   - render() for display-only output; authored children survive beside
 *     it (light DOM);
 *   - `defineNpl('<tag>', <Class>);` as the file's last line.
 */
export class NplMode extends SemElement {
  static properties = {
    primary: { type: Boolean, reflect: true },
  };

  declare primary: boolean;

  constructor() {
    super();
    this.primary = false;
  }

  /** Resolved primary: the `data-*` spelling wins when both are authored. */
  #resolved(): boolean {
    return hasParam(this, 'primary');
  }

  updated(): void {
    // chrome order: the generated chips lead the element, the authored
    // children follow. Light DOM skips LitElement's renderBefore adjustment,
    // so enforce the position here, where render and children have both
    // happened (npl-agent's rule). The walk moves each chip before the
    // first non-chip node, preserving the chips' own order, and is a no-op
    // once they lead.
    let anchor = this.firstChild;
    for (const chip of this.querySelectorAll(':scope > .npl-mode-chip')) {
      if (chip !== anchor) this.insertBefore(chip, anchor);
      anchor = chip.nextSibling;
    }
    // dual-form contract: data-primary mirrors the *resolved* value, so an
    // authored data-primary is never overwritten by the default (deferred
    // past parse, like sem-note — a parse-time write would leak into a
    // sem-source snapshot).
    this.afterParse('primary', () => {
      if (this.#resolved()) this.setAttribute('data-primary', '');
      else this.removeAttribute('data-primary');
    });
  }

  render() {
    // `mode[type]` — the type attribute is required; untyped children are
    // skipped. Authored children stay in the light DOM behind the chips.
    const primary = this.#resolved();
    const modes = Array.from(this.querySelectorAll('mode[type]'));
    return html`${modes.map((mode) => {
      const type = mode.getAttribute('type') as string;
      return html`<span
        class="npl-mode-chip${primary ? ' npl-mode-chip-primary' : ''}"
        data-type="${type}"
        >${type}</span
      >`;
    })}`;
  }
}

defineNpl('npl-mode', NplMode);
