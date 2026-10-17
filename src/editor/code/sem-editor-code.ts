/**
 * `<sem-editor-code>` — the code view (EDITOR.md §6): a transparent-text
 * `<textarea>` (the editor of record) over a highlight `<pre>`, sharing one
 * scroll container; a line-number gutter; and the `role="alert"` issue strip
 * with jump-to-line buttons.
 *
 * It is an input device, not state (§2.5): every debounced re-parse goes
 * through the injected {@link CodeViewHost}. A failed parse NEVER touches the
 * host tree — the last good tree stays active, the textarea is flagged
 * `aria-invalid`, and fixing the source recovers automatically. Split-mode
 * selection arbitration is one-way-on-typing (§2.6): while this pane holds a
 * recent keystroke (250 ms) it drives, and external selections are deferred.
 *
 * Keyboard: Tab inserts two spaces (Shift+Tab outdents) and never leaves the
 * textarea. All rendering is `createElement` + `textContent` — source text
 * is never parsed as HTML (§8: the pane is inert by construction).
 */

import { html, type PropertyValues } from 'lit';
import { SemElement } from '../../lit/base.js';
import { highlight, lineIndexOf, markErrors } from './highlight.js';
import { renderGutter, renderHighlight, renderStrip } from './render.js';
import { ensureCodeCss } from './code-css.js';
import type { CodeSelection, CodeViewHost, HighlightResult } from './types.js';
import type { ParseIssue } from '../model/types.js';

const REPARSE_DEBOUNCE_MS = 300;
const DRIVE_WINDOW_MS = 250;
const STRIP_JUMP_SELECTOR = '.sem-ed-code-jump';

let seq = 0;

export class SemEditorCode extends SemElement {
  static properties = {
    host: { attribute: false },
    wrap: { type: Boolean, reflect: true },
  };

  /** Shell-provided adapter (tryParse/adopt/offsetToPos). */
  declare host: CodeViewHost | null;
  /** Soft-wrap toggle (reflected; CSS keys the pane layout off `[wrap]`). */
  declare wrap: boolean;

  #ta: HTMLTextAreaElement | null = null;
  #pre: HTMLElement | null = null;
  #gutter: HTMLElement | null = null;
  #scroller: HTMLElement | null = null;
  #strip: HTMLElement | null = null;
  #result: HighlightResult | null = null;
  #issues: ParseIssue[] = [];
  #pendingSource: string | null = null;
  #lastInputAt = -Infinity;
  #reparseTimer: ReturnType<typeof setTimeout> | null = null;
  #rehighlightRaf: number | null = null;
  #selectionRaf: number | null = null;

  constructor() {
    super();
    this.host = null;
    this.wrap = false;
  }

  /** The raw source in the pane (textarea of record). */
  get source(): string {
    return this.#ta ? this.#ta.value : (this.#pendingSource ?? '');
  }

  set source(value: string) {
    if (!this.#ta) {
      this.#pendingSource = value;
      return;
    }
    if (this.#ta.value === value) return;
    // While this pane is focused with a recent keystroke its in-flight text
    // wins; the external value lands on the next non-typing set (§2.6).
    if (this.#isDriving()) return;
    this.#ta.value = value;
    // An external push is a model→pane display refresh (wireDocument on open
    // and on every doc change) — never in-flight typing (§2.5): parsing it
    // back and adopting would re-open the whole document ~300 ms later over
    // a live session (contenteditable stripped, canvas re-projected, focus
    // dead). Only user input drives parse+adopt, so the pending reparse for
    // overwritten text is cancelled, and the pushed value — model truth by
    // construction — clears any stale failure flag with it.
    if (this.#reparseTimer) {
      clearTimeout(this.#reparseTimer);
      this.#reparseTimer = null;
    }
    this.#applyIssues([], false);
  }

  render() {
    return html`<div class="sem-ed-code-shell">
      <div class="sem-ed-code-scroll">
        <div class="sem-ed-code-gutter" aria-hidden="true"></div>
        <div class="sem-ed-code-stack">
          <pre class="sem-ed-code" aria-hidden="true"></pre>
          <textarea
            class="sem-ed-code-input"
            aria-label="XHTML source"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            aria-autocomplete="none"
          ></textarea>
        </div>
      </div>
      <div class="sem-ed-code-strip" role="alert" hidden></div>
    </div>`;
  }

  protected firstUpdated(): void {
    this.#ta = this.querySelector('textarea');
    this.#pre = this.querySelector('pre');
    this.#gutter = this.querySelector('.sem-ed-code-gutter');
    this.#scroller = this.querySelector('.sem-ed-code-scroll');
    this.#strip = this.querySelector('.sem-ed-code-strip');
    const ta = this.#ta;
    const strip = this.#strip;
    if (!ta || !this.#pre || !this.#gutter || !this.#scroller || !strip) return;

    ensureCodeCss(this.ownerDocument ?? document);
    if (!this.id) this.id = `sem-editor-code-${++seq}`;
    strip.id = `${this.id}-issues`;
    ta.setAttribute('aria-describedby', strip.id);
    ta.setAttribute('wrap', this.wrap ? 'soft' : 'off');

    ta.addEventListener('input', () => this.#onInput());
    ta.addEventListener('scroll', () => this.#onTextareaScroll());
    ta.addEventListener('select', () => this.#emitSelectionSoon());
    ta.addEventListener('click', () => this.#emitSelectionSoon());
    ta.addEventListener('keyup', () => this.#emitSelectionSoon());
    ta.addEventListener('keydown', (e) => this.#onKeydown(e));
    strip.addEventListener('click', (e) => this.#onStripClick(e));

    const initial = this.#pendingSource ?? '';
    this.#pendingSource = null;
    ta.value = initial;
    this.#rehighlight();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('wrap') && this.#ta) {
      this.#ta.setAttribute('wrap', this.wrap ? 'soft' : 'off');
    }
  }

  disconnectedCallback(): void {
    if (this.#reparseTimer) clearTimeout(this.#reparseTimer);
    if (this.#rehighlightRaf !== null) cancelAnimationFrame(this.#rehighlightRaf);
    if (this.#selectionRaf !== null) cancelAnimationFrame(this.#selectionRaf);
    super.disconnectedCallback();
  }

  /** Parse immediately (the "Re-parse now" escape hatch, §6). */
  reparseNow(): void {
    if (this.#reparseTimer) {
      clearTimeout(this.#reparseTimer);
      this.#reparseTimer = null;
    }
    this.#reparse();
  }

  /** Move the pane's selection to a source offset (shell-driven selection
   *  sync, §2.6). Deferred while this pane is driving (recent typing). */
  setSelectionByOffset(start: number, end: number = start): void {
    const ta = this.#ta;
    if (!ta) return;
    if (this.#isDriving()) return;
    ta.setSelectionRange(start, end);
    this.#scrollCaretIntoView(start);
  }

  #isDriving(): boolean {
    const ta = this.#ta;
    return (
      ta !== null &&
      this.ownerDocument?.activeElement === ta &&
      Date.now() - this.#lastInputAt < DRIVE_WINDOW_MS
    );
  }

  #onInput(): void {
    this.#lastInputAt = Date.now();
    this.#scheduleReparse();
    this.#rehighlightSoon();
  }

  #scheduleReparse(): void {
    if (this.#reparseTimer) clearTimeout(this.#reparseTimer);
    this.#reparseTimer = setTimeout(() => {
      this.#reparseTimer = null;
      this.#reparse();
    }, REPARSE_DEBOUNCE_MS);
  }

  #reparse(): void {
    const ta = this.#ta;
    const strip = this.#strip;
    if (!ta || !strip) return;
    const src = ta.value;
    const host = this.host;
    if (!host) {
      this.#applyIssues([], false);
      return;
    }
    const res = host.tryParse(src);
    if (res.ok) {
      host.adopt(res.doc);
      this.#applyIssues(res.issues, false);
      host.announce?.(
        res.issues.length === 0
          ? 'Source parsed clean — tree updated.'
          : `Source parsed with ${res.issues.length} warning(s).`,
      );
    } else {
      // last good tree stays active (§2.2): no adopt, flag the pane
      this.#applyIssues(res.issues, true);
      const first = res.issues[0];
      const at =
        first && this.#result
          ? ` First: line ${lineIndexOf(this.#result, first.range.start) + 1}.`
          : '';
      host.announce?.(`Source has ${res.issues.length} parse issue(s); last good tree kept.${at}`);
    }
  }

  #applyIssues(issues: ParseIssue[], failed: boolean): void {
    this.#issues = issues;
    const ta = this.#ta;
    if (ta) {
      if (failed) ta.setAttribute('aria-invalid', 'true');
      else ta.removeAttribute('aria-invalid');
    }
    this.#rehighlight();
    if (this.#strip && this.#result) {
      renderStrip(this.#strip, this.#result, issues);
    }
    this.host?.onIssues?.(issues, failed);
  }

  #rehighlightSoon(): void {
    if (this.#rehighlightRaf !== null) return;
    this.#rehighlightRaf = requestAnimationFrame(() => {
      this.#rehighlightRaf = null;
      this.#rehighlight();
    });
  }

  #rehighlight(): void {
    const ta = this.#ta;
    if (!ta || !this.#pre || !this.#gutter) return;
    this.#result = highlight(ta.value);
    markErrors(this.#result, this.#issues);
    renderHighlight(this.#pre, this.#result, ta.value);
    renderGutter(this.#gutter, this.#result, this.#issues);
  }

  #onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    if (e.shiftKey) this.#outdent();
    else this.#indent();
    this.#lastInputAt = Date.now();
    this.#rehighlightSoon();
    this.#scheduleReparse();
  }

  /** Line starts the selection touches (a selection ending exactly at a
   *  newline does not reach into the following line). */
  #touchedLineStarts(value: string, start: number, end: number): number[] {
    const firstLine = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const starts = [firstLine];
    for (
      let p = value.indexOf('\n', firstLine);
      p !== -1 && p + 1 < end;
      p = value.indexOf('\n', p + 1)
    ) {
      starts.push(p + 1);
    }
    return starts;
  }

  #indent(): void {
    const ta = this.#ta;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    if (end === start || !value.slice(start, end).includes('\n')) {
      ta.setRangeText('  ', start, end, 'end');
      return;
    }
    // indent every touched line, bottom-up so offsets hold
    const starts = this.#touchedLineStarts(value, start, end);
    for (let k = starts.length - 1; k >= 0; k--) {
      ta.setRangeText('  ', starts[k], starts[k], 'end');
    }
  }

  #outdent(): void {
    const ta = this.#ta;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    // remove up to two leading spaces per touched line, bottom-up
    const starts = this.#touchedLineStarts(value, start, end);
    for (let k = starts.length - 1; k >= 0; k--) {
      const ls = starts[k];
      const lead = value.slice(ls, ls + 2);
      const cut = lead === '  ' ? 2 : lead.startsWith(' ') ? 1 : 0;
      if (cut > 0) ta.setRangeText('', ls, ls + cut, 'end');
    }
  }

  #onStripClick(e: Event): void {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest?.(STRIP_JUMP_SELECTOR) as HTMLElement | null;
    if (!btn) return;
    const offset = Number(btn.dataset.offset);
    if (Number.isFinite(offset)) this.setSelectionByOffset(offset);
  }

  #emitSelectionSoon(): void {
    if (this.#selectionRaf !== null) return;
    this.#selectionRaf = requestAnimationFrame(() => {
      this.#selectionRaf = null;
      this.#emitSelection();
    });
  }

  #emitSelection(): void {
    const ta = this.#ta;
    const host = this.host;
    if (!ta || !host?.onCodeSelection) return;
    const anchorOffset = ta.selectionStart;
    const focusOffset = ta.selectionEnd;
    const selection: CodeSelection = {
      anchorOffset,
      focusOffset,
      anchor: host.offsetToPos(anchorOffset),
      focus: host.offsetToPos(focusOffset),
      source: 'code',
    };
    host.onCodeSelection(selection);
  }

  #onTextareaScroll(): void {
    const ta = this.#ta;
    const scroller = this.#scroller;
    if (!ta || !scroller) return;
    if (ta.scrollTop !== 0 || ta.scrollLeft !== 0) {
      scroller.scrollTop += ta.scrollTop;
      scroller.scrollLeft += ta.scrollLeft;
      ta.scrollTop = 0;
      ta.scrollLeft = 0;
    }
  }

  #scrollCaretIntoView(offset: number): void {
    const scroller = this.#scroller;
    const ta = this.#ta;
    if (!scroller || !ta) return;
    const result = this.#result;
    if (!result) return;
    const li = lineIndexOf(result, offset);
    const lh = (() => {
      const raw = getComputedStyle(ta).lineHeight;
      const px = Number.parseFloat(raw);
      return Number.isFinite(px) ? px : 20;
    })();
    const target = li * lh - scroller.clientHeight / 3;
    scroller.scrollTop = Math.max(0, target);
  }
}

SemElement.register('sem-editor-code', SemEditorCode);

declare global {
  interface HTMLElementTagNameMap {
    'sem-editor-code': SemEditorCode;
  }
}
