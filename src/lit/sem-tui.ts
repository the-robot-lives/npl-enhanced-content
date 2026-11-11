import { SemElement } from './base.js';

/**
 * sem-tui — the terminal-frame wrapper (render-mode context provider).
 *
 * A sem-tui element switches its SUBTREE to the terminal text view: every
 * sem-* element below it that has no explicit opt-out renders its
 * `renderText()` text (src/shared/text-render) instead of its rich
 * presentation, inside `<pre class="sem-tui">` blocks. The wrapper owns
 * three things and nothing else:
 *
 *   - context: the subtree's render mode (`data-mode`, default `tui`),
 *     read by the shared resolver (src/lit/shared/render-mode.ts);
 *   - the frame: vocabulary-CSS terminal chrome (palette, border,
 *     padding) themed by the `theme` attribute;
 *   - the optional Rich/Terminal switch (`toggle` attribute): a real
 *     button with `aria-pressed` that flips `data-mode` and dispatches
 *     the bubbling, composed `sem-render-mode-change` event the driver
 *     re-scans on. Flipping back to rich unmoves nothing — the pres are
 *     removed and the authored children, which were never touched, show
 *     again with their rich wiring intact.
 *
 * Attributes: `cols` (wrap width for the text renderers, default 80),
 * `theme` (`dark|light|amber|green`, palette custom properties),
 * `toggle` (boolean, renders the switch). `cols`/`theme`/`toggle` are
 * read from the authored attributes by CSS and the driver too, so a
 * not-yet-upgraded (lazy chunk) sem-tui still frames its subtree; only
 * the switch needs this component.
 *
 * Light DOM per PRD §4 rule 5 — authored children stay in place, are
 * never moved into a frame node, and with JS off the wrapper is an
 * unknown element rendering its children as the ordinary rich document.
 */

const THEMES = ['dark', 'light', 'amber', 'green'];

export class SemTui extends SemElement {
  static properties = {
    cols: { type: Number },
    theme: { type: String },
    toggle: { type: Boolean },
    mode: { type: String, state: true },
  };

  declare cols: number;
  declare theme: string;
  declare toggle: boolean;
  declare mode: string;

  constructor() {
    super();
    this.cols = 80;
    this.theme = 'dark';
    this.toggle = false;
    this.mode = 'tui';
  }

  connectedCallback(): void {
    super.connectedCallback();
    // An authored data-mode (a page that pins the subtree to rich, or a
    // persisted toggle state a script re-applies) wins over the default.
    const authored = this.getAttribute('data-mode');
    this.mode = authored === 'rich' ? 'rich' : 'tui';
    if (authored !== this.mode) this.setAttribute('data-mode', this.mode);
  }

  updated(): void {
    this.afterParse('sem-tui', () => this.#wire());
  }

  #wire(): void {
    this.#validTheme(this.getAttribute('theme'));

    if (!this.toggle) return;
    let header = this.querySelector(':scope > .sem-tui-header');
    if (!header) {
      header = document.createElement('div');
      header.className = 'sem-tui-header';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sem-tui-toggle';
      btn.addEventListener('click', () => this.flip());
      header.appendChild(btn);
      this.insertBefore(header, this.firstChild);
    }
    this.#paintToggle(header.querySelector('button')!);
  }

  /** Map an authored theme to a valid one ('' → default). */
  #validTheme(theme: string | null): string {
    const t = theme && THEMES.includes(theme) ? theme : 'dark';
    if (this.getAttribute('data-theme') !== t) this.setAttribute('data-theme', t);
    return t;
  }

  #paintToggle(btn: HTMLButtonElement): void {
    const tui = this.mode === 'tui';
    btn.textContent = tui ? 'Terminal' : 'Rich';
    btn.setAttribute('aria-pressed', tui ? 'true' : 'false');
    btn.setAttribute(
      'aria-label',
      (tui ? 'Terminal view' : 'Rich view') + ' — switch this subtree'
    );
  }

  /** Toggle the subtree between terminal and rich; announces the change. */
  flip(): void {
    this.mode = this.mode === 'tui' ? 'rich' : 'tui';
    if (this.getAttribute('data-mode') !== this.mode) this.setAttribute('data-mode', this.mode);
    const header = this.querySelector(':scope > .sem-tui-header');
    const btn = header?.querySelector('button');
    if (btn) this.#paintToggle(btn as HTMLButtonElement);
    this.dispatchEvent(
      new CustomEvent('sem-render-mode-change', { bubbles: true, composed: true })
    );
  }
}

SemElement.register('sem-tui', SemTui);
