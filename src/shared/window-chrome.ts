/**
 * window-chrome — the one window-frame standard for SemText demo windows.
 *
 * sem-browser, sem-shell, sem-code and the site's ExampleViewer all draw the
 * same chrome — a title bar with a favicon/status dot, an active tab, and an
 * actions slot — at three different altitudes. This module is that standard's
 * single source of truth: the class names, one builder per consumption form
 * (imperative DOM for elements that own their children; a Lit template for
 * elements whose whole render is a template), and the reduced-motion helper.
 * The paint lives in the sem-browser block of themes/_vocabulary.css — light
 * DOM has no shadow styles (PRD §4 rule 5), so the stylesheet is the only
 * style channel.
 *
 * ADOPTION CONTRACT (what a host element does; none of them are edited here):
 *
 *   - sem-browser (src/browser/sem-browser.ts) — uses it today. It renders
 *     the title bar as its tab strip (one tab: dot + title), adds its own
 *     address bar and a sem-window-viewport scroll region.
 *   - sem-shell / sem-terminal — adopt by rendering `renderWindowTitlebar`
 *     (or the imperative `createWindowTitlebar`) as the frame's first child,
 *     with one tab per shell tab (Epoch 3's cmd tabs set `active` per tab),
 *     and moving the transcript into the viewport. Until then the shell
 *     keeps `.sem-shell-frame`; the CSS keeps both looking alike.
 *   - sem-code — adopt by promoting `.sem-code-chrome` to the title bar
 *     (filename in the tab title, copy/wrap buttons into
 *     sem-window-actions). The `.sem-code-*` names stay valid until then.
 *   - site ExampleViewer (bundle-sync lane owns example-viewer.tsx) — adopt
 *     by rendering the same title bar above the SOURCE/RENDER panes and
 *     scoping panes to the viewport class; request logged in the
 *     sem-browser lane report, not changed here.
 *
 * Sizes and focus are conventions, not code: the frame keys on
 * `:focus-within` (the viewport is the focusable element), and height comes
 * from `--sem-window-height` with the `size`/`data-size` attribute spellings
 * `sm` and `lg` as presets — the same dual-spelling rule as every other
 * parameter (conventions §2).
 */

import { html, type TemplateResult } from 'lit';

/** The class-name contract. Keep in one place; the CSS keys off these. */
export const WINDOW_CHROME = {
  /** The frame — border, radius, focus ring. */
  frame: 'sem-window',
  /** The title-bar strip: dot, tab(s), actions. */
  titlebar: 'sem-window-titlebar',
  /** The favicon/status dot. Always decorative: aria-hidden. */
  dot: 'sem-window-dot',
  /** One document tab inside the strip. */
  tab: 'sem-window-tab',
  /** The tab that names what the viewport shows. */
  tabActive: 'sem-window-tab-active',
  /** The tab's label text (updates from the loaded document). */
  tabTitle: 'sem-window-tab-title',
  /** Host-provided controls (copy, wrap, replay…). Hidden while empty. */
  actions: 'sem-window-actions',
  /** The scrollable content region; the frame's focusable element. */
  viewport: 'sem-window-viewport',
} as const;

export interface WindowTitlebarOptions {
  /** The tab label. Rendered as text — never HTML. */
  title: string;
  /** False renders the tab without the active class (future multi-tab). */
  active?: boolean;
  /** Host controls stamped into the actions container. */
  actions?: TemplateResult | null;
}

/**
 * The title bar as a Lit template — for elements whose whole render is a
 * template. The dot is `aria-hidden` (decorative), the title is a text
 * binding, the actions container renders only when controls are given.
 */
export function renderWindowTitlebar(options: WindowTitlebarOptions): TemplateResult {
  const { title, active = true, actions = null } = options;
  return html`
    <div class=${WINDOW_CHROME.titlebar}>
      <span class=${WINDOW_CHROME.dot} aria-hidden="true"></span>
      <div class="${WINDOW_CHROME.tab}${active ? ` ${WINDOW_CHROME.tabActive}` : ''}">
        <span class=${WINDOW_CHROME.tabTitle}>${title}</span>
      </div>
      ${actions === null ? null : html`<div class=${WINDOW_CHROME.actions}>${actions}</div>`}
    </div>
  `;
}

/**
 * The title bar as a plain element — for elements that own their children
 * imperatively (sem-browser moves authored fallback content into the
 * viewport, so it cannot let a Lit template own the render root). Structurally
 * identical to `renderWindowTitlebar`; the parity test holds them together.
 */
export function createWindowTitlebar(options: WindowTitlebarOptions): HTMLElement {
  const { title, active = true, actions = null } = options;
  const doc = typeof document === 'undefined' ? null : document;
  if (doc === null) throw new Error('createWindowTitlebar needs a document');

  const bar = doc.createElement('div');
  bar.className = WINDOW_CHROME.titlebar;

  const dot = doc.createElement('span');
  dot.className = WINDOW_CHROME.dot;
  dot.setAttribute('aria-hidden', 'true');
  bar.appendChild(dot);

  const tab = doc.createElement('div');
  tab.className = `${WINDOW_CHROME.tab}${active ? ` ${WINDOW_CHROME.tabActive}` : ''}`;
  const label = doc.createElement('span');
  label.className = WINDOW_CHROME.tabTitle;
  label.textContent = title; // textContent — the title is never HTML
  tab.appendChild(label);
  bar.appendChild(tab);

  // The actions container always exists, hidden while empty — hosts un-hide
  // it by appending controls (the imperative builder's fill-in point).
  const slot = doc.createElement('div');
  slot.className = WINDOW_CHROME.actions;
  slot.setAttribute('hidden', '');
  bar.appendChild(slot);
  return bar;
}

/**
 * True when the view honours `prefers-reduced-motion: reduce`. View is
 * injectable for tests; a missing view (SSR, worker) is treated as
 * reduce-agnostic: false.
 */
export function reducedMotion(view?: Window | null): boolean {
  const v = view ?? (typeof window === 'undefined' ? null : window);
  return typeof v?.matchMedia === 'function' && v.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
