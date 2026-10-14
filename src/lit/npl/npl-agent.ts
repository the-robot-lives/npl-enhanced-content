import { html } from 'lit';
import { SemElement } from '../base.js';
import { defineNpl, nplParam } from './shared.js';

/**
 * npl-agent — display-only agent definition card.
 *
 * Marks up the NPL agent convention (source form
 * `⌜<agent-name>|<type>|NPL@{version}⌝ … ⌞<agent-name>⌟`) as HTML: the
 * three header fields become attributes (plus the optional `extends`
 * parent), and the body is the authored prose — the description and
 * behavioural spec — which stays plain light-DOM children (searchable,
 * copyable, styled by theme CSS only).
 *
 * Follows the namespace recipe (src/lit/npl/index.ts header):
 *   - extend SemElement — light DOM (no shadow root, no static styles);
 *   - reactive `static properties` mirrored to the `data-*` spelling in
 *     `updated()` via afterParse (deferred past parse, like npl-example).
 *     The mirror writes the *resolved* value, so an authored `data-*`
 *     spelling is never clobbered by the bare one (conventions §2);
 *   - render() for display-only output — one generated chrome element
 *     (`.npl-agent-header`); no events, no keys, no network;
 *   - `defineNpl('npl-agent', NplAgent);` as the file's last line.
 */
export class NplAgent extends SemElement {
  static properties = {
    name: { type: String, reflect: true },
    type: { type: String, reflect: true },
    version: { type: String, reflect: true },
    extends: { type: String, reflect: true },
  };

  declare name: string;
  declare type: string;
  declare version: string;
  declare extends: string;

  constructor() {
    super();
    this.name = '';
    this.type = '';
    this.version = '';
    this.extends = '';
  }

  updated(): void {
    // chrome order: the generated header goes before the authored body.
    // Light DOM skips LitElement's renderBefore adjustment (base.ts returns
    // `this` from createRenderRoot), and an element can connect before its
    // children exist (upgrade pre-parse, innerHTML on a live document), so
    // enforce the position here — where render AND children have happened.
    // The check is against firstChild, not firstElementChild: a text-only
    // body leaves a text node ahead of the header, and firstElementChild
    // would still match the header while a stray text node precedes it.
    // Only the div moves; lit's text parts keep updating it in place.
    const header = this.querySelector(':scope > .npl-agent-header');
    if (header && header !== this.firstChild) {
      this.insertBefore(header, this.firstChild);
    }
    // dual-form contract: the data-* spellings mirror the *resolved* values,
    // so an authored `data-*` spelling is never overwritten by the bare one
    // (conventions §2: `data-*` wins when both are present; npl-section's
    // idiom). Deferred past parse, like npl-example.
    this.afterParse('name', () => this.setAttribute('data-name', nplParam(this, 'name', this.name)));
    this.afterParse('type', () => this.setAttribute('data-type', nplParam(this, 'type', this.type)));
    this.afterParse('version', () => this.setAttribute('data-version', nplParam(this, 'version', this.version)));
    this.afterParse('extends', () => this.setAttribute('data-extends', nplParam(this, 'extends', this.extends)));
  }

  render() {
    const name = nplParam(this, 'name', this.name);
    const type = nplParam(this, 'type', this.type);
    const version = nplParam(this, 'version', this.version);
    const extendsParent = nplParam(this, 'extends', this.extends);
    return html`<div class="npl-agent-header">
      <span class="npl-agent-name">${name}</span>
      <span class="npl-agent-type">${type}</span>
      <span class="npl-agent-version">${version}</span>
      ${extendsParent
        ? html`<span class="npl-agent-extends">${extendsParent}</span>`
        : ''}
    </div>`;
  }
}

defineNpl('npl-agent', NplAgent);
