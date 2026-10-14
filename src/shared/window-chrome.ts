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
 *     keeps `.sem-shell-frame`; the CSS keeps both looking alike. Several
 *     shell tabs at once render `renderTabStrip` / `createTabStrip`
 *     (CORE-V2 §11.2) in place of the single tab; the per-tab status dot
 *     rides the title bar's `tone` option (the OSC 9 feed).
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
  /** The dot's busy tone (OSC 9 feed, §11.1) — appended to `dot`. */
  dotBusy: 'sem-window-dot-busy',
  /** The dot's alert tone (OSC 9 feed, §11.1) — appended to `dot`. */
  dotAlert: 'sem-window-dot-alert',
  /** One document tab inside the strip. */
  tab: 'sem-window-tab',
  /** The multi-tab strip container (role=tablist) — several shell tabs. */
  tabs: 'sem-window-tabs',
  /** The per-tab close affordance; rendered only when the strip is closable. */
  tabClose: 'sem-window-tab-close',
  /** The tab that names what the viewport shows. */
  tabActive: 'sem-window-tab-active',
  /** The tab's label text (updates from the loaded document). */
  tabTitle: 'sem-window-tab-title',
  /** Host-provided controls (copy, wrap, replay…). Hidden while empty. */
  actions: 'sem-window-actions',
  /** The scrollable content region; the frame's focusable element. */
  viewport: 'sem-window-viewport',
} as const;

/**
 * The status-dot tone (CORE-V2 §11.1): the terminal's OSC 9 feed maps
 * `idle|busy|alert` onto the chrome dot. Kept as its own literal union
 * here — shared/ stays the lowest layer and must not import terminal
 * types; src/terminal/title/title-feed.ts uses the structurally identical
 * `StatusTone` from the screen model, and a unit test pins the two
 * unions assignable in both directions.
 */
export type WindowStatusTone = 'idle' | 'busy' | 'alert';

export interface WindowTitlebarOptions {
  /** The tab label. Rendered as text — never HTML. */
  title: string;
  /** False renders the tab without the active class (future multi-tab). */
  active?: boolean;
  /** Host controls stamped into the actions container. */
  actions?: TemplateResult | null;
  /**
   * The status-dot tone; undefined/idle renders the bare dot exactly as
   * before this option existed.
   */
  tone?: WindowStatusTone;
}

/** The dot's classes for a tone: `idle` is the bare dot (no modifier). */
function dotClasses(tone?: WindowStatusTone): string {
  if (tone === 'busy') return `${WINDOW_CHROME.dot} ${WINDOW_CHROME.dotBusy}`;
  if (tone === 'alert') return `${WINDOW_CHROME.dot} ${WINDOW_CHROME.dotAlert}`;
  return WINDOW_CHROME.dot;
}

/**
 * The title bar as a Lit template — for elements whose whole render is a
 * template. The dot is `aria-hidden` (decorative), the title is a text
 * binding, the actions container renders only when controls are given.
 */
export function renderWindowTitlebar(options: WindowTitlebarOptions): TemplateResult {
  const { title, active = true, actions = null, tone } = options;
  return html`
    <div class=${WINDOW_CHROME.titlebar}>
      <span class=${dotClasses(tone)} aria-hidden="true"></span>
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
  const { title, active = true, actions = null, tone } = options;
  const doc = typeof document === 'undefined' ? null : document;
  if (doc === null) throw new Error('createWindowTitlebar needs a document');

  const bar = doc.createElement('div');
  bar.className = WINDOW_CHROME.titlebar;

  const dot = doc.createElement('span');
  dot.className = dotClasses(tone);
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

/* ------------------------------------------------------------------ *
 * The tab strip (CORE-V2 §11.2) — several shell tabs in one window.
 * A host drops the strip into its titlebar in place of the single tab;
 * switching stays the host's job (the tabs model, the title feed and
 * the per-session wiring live in src/terminal/{tabs,title}/).
 * ------------------------------------------------------------------ */

/** One tab of the strip. `id` rides the DOM as `data-tab-id`/`data-tab-close`. */
export interface WindowTab {
  id: string;
  /** The label (the owning session's OSC 0 title). Text — never HTML. */
  title: string;
  active?: boolean;
}

export interface WindowTabStripOptions {
  tabs: readonly WindowTab[];
  /** Accessible name for the tablist. */
  label?: string;
  /** Render a close affordance per tab; the host delegates the clicks. */
  closable?: boolean;
}

/** Strip class for a tab: base + active. */
function tabClasses(tab: WindowTab): string {
  return tab.active === true ? `${WINDOW_CHROME.tab} ${WINDOW_CHROME.tabActive}` : WINDOW_CHROME.tab;
}

/**
 * The tab strip as a Lit template — same contract as `renderWindowTitlebar`
 * for the single-tab form: labels are text bindings, the active tab carries
 * `aria-selected` and the roving tab stop (`tabindex="0"`), the rest are
 * `tabindex="-1"`. Close buttons render only when `closable`; the host
 * delegates clicks by `data-tab-close`.
 */
export function renderTabStrip(options: WindowTabStripOptions): TemplateResult {
  const { tabs, label = 'Tabs', closable = false } = options;
  return html`
    <div class=${WINDOW_CHROME.tabs} role="tablist" aria-label=${label}>
      ${tabs.map(
        (tab) => html`
          <div
            class=${tabClasses(tab)}
            role="tab"
            aria-selected=${tab.active === true}
            tabindex=${tab.active === true ? 0 : -1}
            data-tab-id=${tab.id}
          >
            <span class=${WINDOW_CHROME.tabTitle}>${tab.title}</span>
            ${closable
              ? html`<button
                  type="button"
                  class=${WINDOW_CHROME.tabClose}
                  aria-label="Close ${tab.title}"
                  data-tab-close=${tab.id}
                >
                  &times;
                </button>`
              : null}
          </div>
        `,
      )}
    </div>
  `;
}

/**
 * The tab strip as a plain element — the imperative twin of
 * `renderTabStrip`, structurally identical (the parity test holds them
 * together). Labels go in via `textContent`; the host owns the events.
 */
export function createTabStrip(options: WindowTabStripOptions): HTMLElement {
  const { tabs, label = 'Tabs', closable = false } = options;
  const doc = typeof document === 'undefined' ? null : document;
  if (doc === null) throw new Error('createTabStrip needs a document');

  const strip = doc.createElement('div');
  strip.className = WINDOW_CHROME.tabs;
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', label);

  for (const tab of tabs) {
    const cell = doc.createElement('div');
    cell.className = tabClasses(tab);
    cell.setAttribute('role', 'tab');
    cell.setAttribute('aria-selected', tab.active === true ? 'true' : 'false');
    cell.setAttribute('tabindex', tab.active === true ? '0' : '-1');
    cell.setAttribute('data-tab-id', tab.id);

    const cellTitle = doc.createElement('span');
    cellTitle.className = WINDOW_CHROME.tabTitle;
    cellTitle.textContent = tab.title; // textContent — the title is never HTML
    cell.appendChild(cellTitle);

    if (closable) {
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = WINDOW_CHROME.tabClose;
      close.setAttribute('aria-label', `Close ${tab.title}`);
      close.setAttribute('data-tab-close', tab.id);
      close.textContent = '×';
      cell.appendChild(close);
    }
    strip.appendChild(cell);
  }
  return strip;
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
