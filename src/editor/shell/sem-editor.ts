/**
 * sem-editor — the editor shell element (EDITOR.md §5).
 *
 * A `SemElement` that owns its children at the sem-browser altitude: it builds
 * a `sem-window` frame (titlebar from `src/shared/window-chrome.ts`), a
 * toolbar, a breadcrumb row, an outline rail and the WYSIWYG | Code | Split
 * panes, and moves the document into the viewport. The document of record is
 * the model (`EditorDocument`) — the DOM is a projection, re-drawn through the
 * injected canvas projector (EDITOR.md §8: `renderAuthorInert` is the only
 * source→preview path; the shell never innerHTMLs model content).
 *
 * Seams (Phase 1 — other lanes land later, nothing here imports them):
 *  - `setModelFactory` (context.js): source → document. Without it the shell
 *    still opens an injected document and shows an empty-state canvas.
 *  - `setCanvasProjector` (context.js): the author-inert projection.
 *  - code pane: a named slot (`code-view`) for the code lane's
 *    `<sem-editor-code>`; a fallback note until one is slotted.
 *  - `ctx.schema` / `ctx.descriptors`: the schema and descriptor views the
 *    property modal and outline read.
 *
 * Mode is reflected as `data-mode` (§5.2); edit-mode is stamped on the host
 * when a document opens so the base.ts lazy hook (§4.1) queues the edited
 * elements. `sem-edit-change` / `sem-edit-mode` / `sem-edit-selection` are
 * optional DOM mirrors — the intra-editor contract is `doc.on` (§2.4).
 */

import { SemElement } from '../../lit/base.js';
import { WINDOW_CHROME, createWindowTitlebar, reducedMotion } from '../../shared/window-chrome.js';
import {
  EditorContext,
  documentTitle,
  getCanvasProjector,
  getModelFactory,
} from './context.js';
import type { EditorDocument, ElementNode, NodeId } from '../model/types.js';
import { OutlineList } from './outline.js';
import { openPropertiesModal } from './property-modal.js';
import { SHELL_CSS, SHELL_CSS_ID } from './shell-css.js';

export const EDITOR_TAG = 'sem-editor';

export type EditorMode = 'wysiwyg' | 'code' | 'split';
const MODES: readonly EditorMode[] = ['wysiwyg', 'code', 'split'];
const MODE_LABELS: Record<EditorMode, string> = {
  wysiwyg: 'Visual',
  code: 'Code',
  split: 'Split',
};

export class SemEditor extends SemElement {
  static properties = {
    /** View mode; reflected as `data-mode` on the host (§5.2). */
    mode: { type: String },
    /** The open document (injected — never authored). */
    doc: { attribute: false },
  };

  declare mode: EditorMode;
  declare doc: EditorDocument | null;

  #wired = false;
  #ctx: EditorContext | null = null;
  #unsubs: Array<() => void> = [];
  #pendingSource: string | null = null;

  #frame: HTMLElement | null = null;
  #titlebar: HTMLElement | null = null;
  #toolbar: HTMLElement | null = null;
  #undoBtn: HTMLButtonElement | null = null;
  #redoBtn: HTMLButtonElement | null = null;
  #modeGroup: HTMLElement | null = null;
  #crumbs: HTMLElement | null = null;
  #outline: OutlineList | null = null;
  #outlineHost: HTMLElement | null = null;
  #canvas: HTMLElement | null = null;
  #codeSlot: HTMLSlotElement | null = null;
  #codeFallback: HTMLElement | null = null;
  #live: HTMLElement | null = null;

  constructor() {
    super();
    this.mode = 'wysiwyg';
    this.doc = null;
  }

  /** The live context once a document is open; null before that. */
  get ctx(): EditorContext | null {
    return this.#ctx;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // document-authored elements upgrade before their children parse — wire
    // after the parse (afterParse is immediate once readyState past 'loading')
    this.afterParse('wire', () => this.#wire());
  }

  disconnectedCallback(): void {
    for (const off of this.#unsubs) off();
    this.#unsubs = [];
    super.disconnectedCallback();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('mode')) {
      this.setAttribute('data-mode', this.mode);
      if (this.#ctx !== null) {
        this.#ctx.announce(`${MODE_LABELS[this.mode]} view`);
        this.#emit('sem-edit-mode', { mode: this.mode });
      }
      this.#syncModeGroup();
    }
  }

  /** Open (or replace) the document of record. */
  openDocument(doc: EditorDocument): void {
    this.#ensureWired();
    for (const off of this.#unsubs) off();
    this.#unsubs = [];

    const ctx = new EditorContext(doc);
    ctx.schema = this.#schemaBridge;
    ctx.descriptors = this.#descriptorBridge;
    this.#ctx = ctx;
    this.doc = doc;
    // §4.1 signal: elements in this subtree (and this frame) queue for edit
    this.setAttribute('edit-mode', '');

    this.#pendingSource = null;
    this.#syncModeGroup();

    this.#unsubs.push(
      doc.on('change', () => this.#renderFromModel()),
      doc.on('history', () => this.#syncHistoryButtons()),
    );

    ctx.setLiveRegion(this.#live);
    ctx.on('selectionchange', (id) => {
      this.#outline?.syncSelection(id);
      this.#renderCrumbs();
      this.#emit('sem-edit-selection', { id });
    });
    this.#ensureOutline(ctx).refresh();
    this.#renderCrumbs();
    this.#renderFromModel();
    this.#syncHistoryButtons();
    this.#renderTitle();
  }

  /** Cycle wysiwyg → code → split → wysiwyg (Cmd/Ctrl+Shift+E, §7). */
  cycleMode(): void {
    const next = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.mode = next;
  }

  // ── schema / descriptor bridges (hosts and tests may override per element) ──

  /** Hosts set richer bridges; the defaults read the context of THIS editor
   *  only — tests inject directly onto `el.ctx.schema`. */
  #schemaBridge: EditorContext['schema'] = null;
  #descriptorBridge: EditorContext['descriptors'] = null;

  // ── wiring ────────────────────────────────────────────────────────────────

  #ensureWired(): void {
    if (!this.#wired) this.#wire();
  }

  #wire(): void {
    if (this.#wired) return;
    const doc = this.ownerDocument;
    if (doc === null) return;
    this.#wired = true;
    this.#injectCss(doc);

    // authored children: the pending source (parsed once a model factory is
    // wired — §5.2 move-on-connect; the model preserves the bytes, not the DOM)
    if (this.childNodes.length > 0) {
      this.#pendingSource = this.innerHTML;
      this.textContent = '';
    }

    const frame = doc.createElement('div');
    frame.className = `sem-window sem-ed-frame`;
    this.#frame = frame;

    this.#titlebar = createWindowTitlebar({ title: this.#documentName() });
    frame.appendChild(this.#titlebar);

    frame.appendChild(this.#buildToolbar(doc));
    frame.appendChild(this.#buildCrumbs(doc));
    frame.appendChild(this.#buildBody(doc));

    const live = doc.createElement('div');
    live.className = 'sem-ed-live';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    this.#live = live;
    frame.appendChild(live);

    this.appendChild(frame);
    frame.addEventListener('keydown', this.#onFrameKey);
    this.setAttribute('data-mode', this.mode);
    this.#syncModeGroup();

    // authored document → model, when the parser is wired
    if (this.#pendingSource !== null) {
      const factory = getModelFactory();
      if (factory !== null) {
        try {
          this.openDocument(factory(this.#pendingSource));
        } catch {
          this.#showEmpty('This document could not be parsed.');
        }
      } else {
        this.#showEmpty('No model source is wired — call openDocument() to begin.');
      }
    }
  }

  #injectCss(doc: Document): void {
    if (doc.querySelector(`style[data-sem-editor-css][data-sem-ed-block="shell"]`) !== null) return;
    const style = doc.createElement('style');
    style.id = SHELL_CSS_ID;
    style.setAttribute('data-sem-editor-css', '');
    style.setAttribute('data-sem-ed-block', 'shell');
    style.textContent = SHELL_CSS;
    doc.head?.appendChild(style) ?? doc.appendChild(style);
  }

  #documentName(): string {
    return this.doc !== null ? documentTitle(this.doc) : 'Untitled';
  }

  #renderTitle(): void {
    const label = this.#titlebar?.querySelector(`.${WINDOW_CHROME.tabTitle}`);
    if (label !== null && label !== undefined) label.textContent = this.#documentName();
  }

  // ── toolbar (§5.1: one tab stop, roving arrows) ───────────────────────────

  #buildToolbar(doc: Document): HTMLElement {
    const bar = doc.createElement('div');
    bar.className = 'sem-ed-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Editor tools');
    bar.setAttribute('aria-controls', '');
    bar.addEventListener('keydown', (e) => this.#onToolbarKey(e));
    this.#toolbar = bar;

    const tool = (label: string, onClick: () => void, hint?: string): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sem-ed-btn';
      b.textContent = label;
      b.tabIndex = -1;
      if (hint) {
        b.title = hint;
        b.setAttribute('aria-label', `${label} (${hint})`);
      }
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    };
    const sep = (): void => {
      const s = doc.createElement('span');
      s.className = 'sem-ed-sep';
      s.setAttribute('aria-hidden', 'true');
      bar.appendChild(s);
    };

    this.#undoBtn = tool('Undo', () => this.#doUndo(), 'Ctrl+Z');
    this.#undoBtn.setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
    this.#redoBtn = tool('Redo', () => this.#doRedo(), 'Ctrl+Shift+Z');
    this.#redoBtn.setAttribute('aria-keyshortcuts', 'Control+Shift+Z Meta+Shift+Z');
    sep();

    const group = doc.createElement('div');
    group.className = 'sem-ed-mode-group';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'View mode');
    group.tabIndex = 0; // the toolbar's single stop for the whole group
    group.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation(); // keep the toolbar rover out of the group
      const at = MODES.indexOf(this.mode);
      const next = e.key === 'ArrowRight' ? (at + 1) % MODES.length : (at + MODES.length - 1) % MODES.length;
      this.mode = MODES[next];
      (group.querySelector(`[data-mode-value="${this.mode}"]`) as HTMLElement | null)?.focus();
    });
    for (const mode of MODES) {
      const radio = doc.createElement('button');
      radio.type = 'button';
      radio.className = 'sem-ed-mode';
      radio.setAttribute('role', 'radio');
      radio.dataset.modeValue = mode;
      radio.tabIndex = -1;
      radio.textContent = MODE_LABELS[mode];
      radio.addEventListener('click', () => {
        this.mode = mode;
      });
      group.appendChild(radio);
    }
    this.#modeGroup = group;
    bar.appendChild(group);
    sep();

    const insert = tool('Insert…', () => {
      const ctx = this.#ctx;
      const parent = ctx?.selectedId ?? ctx?.rootId ?? null;
      this.#emit('sem-edit-insert-request', { parent, index: null });
    });
    insert.disabled = this.doc === null;
    this.#insertBtn = insert;

    const exporter = tool('Export…', () => this.#emit('sem-edit-export-request', {}));
    exporter.disabled = this.doc === null;
    this.#exportBtn = exporter;

    const open = tool('Open…', () => this.#emit('sem-edit-open-request', {}));
    this.#openBtn = open;

    // the roving tab stop: first enabled tool
    const first = bar.querySelector<HTMLButtonElement>('button:not([disabled])');
    if (first !== null) first.tabIndex = 0;
    return bar;
  }

  #insertBtn: HTMLButtonElement | null = null;
  #exportBtn: HTMLButtonElement | null = null;
  #openBtn: HTMLButtonElement | null = null;

  #onToolbarKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const bar = this.#toolbar;
    if (bar === null) return;
    const stops = Array.from(bar.querySelectorAll<HTMLElement>('[tabindex]:not([disabled])')).filter(
      (el) => el.tabIndex >= 0,
    );
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = stops.length - 1;
    else if (e.key === 'ArrowRight') next = at < 0 ? 0 : (at + 1) % stops.length;
    else next = at < 0 ? stops.length - 1 : (at + stops.length - 1) % stops.length;
    e.preventDefault();
    stops[next].focus();
  }

  #syncModeGroup(): void {
    const group = this.#modeGroup;
    if (group === null) return;
    for (const radio of group.querySelectorAll<HTMLButtonElement>('[role="radio"]')) {
      const on = radio.dataset.modeValue === this.mode;
      radio.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  // ── crumbs, body, panes ───────────────────────────────────────────────────

  #buildCrumbs(doc: Document): HTMLElement {
    const nav = doc.createElement('nav');
    nav.className = 'sem-ed-crumbs';
    nav.setAttribute('aria-label', 'Breadcrumb');
    this.#crumbs = nav;
    return nav;
  }

  #buildBody(doc: Document): HTMLElement {
    const body = doc.createElement('div');
    body.className = 'sem-ed-body';

    const outlineHost = doc.createElement('div');
    outlineHost.className = 'sem-ed-outline-host';
    this.#outlineHost = outlineHost;
    body.appendChild(outlineHost);

    const viewport = doc.createElement('div');
    viewport.className = WINDOW_CHROME.viewport;
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Document canvas');

    const panes = doc.createElement('div');
    panes.className = 'sem-ed-panes';

    const wysiwyg = doc.createElement('div');
    wysiwyg.className = 'sem-ed-pane sem-ed-pane-wysiwyg';
    const canvas = doc.createElement('div');
    canvas.className = 'sem-ed-canvas';
    canvas.setAttribute('aria-label', 'Visual view');
    wysiwyg.appendChild(canvas);
    this.#canvas = canvas;

    const codePane = doc.createElement('div');
    codePane.className = 'sem-ed-pane sem-ed-pane-code';
    const slot = doc.createElement('slot') as HTMLSlotElement;
    slot.name = 'code-view';
    slot.addEventListener('slotchange', () => this.#syncCodeFallback());
    const fallback = doc.createElement('p');
    fallback.className = 'sem-ed-empty';
    fallback.textContent = 'Code view: slot a <sem-editor-code> element (code lane) here.';
    this.#codeSlot = slot;
    this.#codeFallback = fallback;
    codePane.append(slot, fallback);

    panes.append(wysiwyg, codePane);
    viewport.appendChild(panes);
    body.appendChild(viewport);
    return body;
  }

  /** The outline is created lazily — it needs a document-backed context, so
   *  openDocument builds (or re-points) it before the first refresh. */
  #ensureOutline(ctx: EditorContext): OutlineList {
    if (this.#outline === null) {
      this.#outline = new OutlineList(ctx, {
        onSelect: (id) => {
          this.#ctx?.select(id);
          this.#scrollToNode(id);
        },
        onProperties: (id) => {
          this.#ctx?.select(id);
          this.#openProperties();
        },
        onDelete: (id) => this.#deleteNode(id),
      });
      this.#outlineHost?.appendChild(this.#outline.root);
    } else {
      this.#outline.setContext(ctx);
    }
    return this.#outline;
  }

  #syncCodeFallback(): void {
    const slot = this.#codeSlot;
    const fallback = this.#codeFallback;
    if (slot === null || fallback === null) return;
    fallback.hidden = slot.assignedElements().length > 0;
  }

  #showEmpty(message: string): void {
    const canvas = this.#canvas;
    if (canvas === null) return;
    canvas.textContent = '';
    const note = this.ownerDocument?.createElement('p');
    if (note === null || note === undefined) return;
    note.className = 'sem-ed-empty';
    note.textContent = message;
    canvas.appendChild(note);
  }

  // ── model rendering ───────────────────────────────────────────────────────

  #renderFromModel(): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    this.#renderTitle();
    this.#outline?.refresh();
    this.#renderCrumbs();
    const projector = getCanvasProjector();
    const canvas = this.#canvas;
    if (projector === null) {
      this.#showEmpty('The visual projection is wired in Phase 3 (renderAuthorInert).');
    } else if (canvas !== null) {
      canvas.textContent = '';
      try {
        projector(ctx.doc, canvas);
      } catch (err) {
        this.#showEmpty(`Projection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (this.#insertBtn !== null) this.#insertBtn.disabled = false;
    if (this.#exportBtn !== null) this.#exportBtn.disabled = false;
    this.#syncHistoryButtons();
    this.#emit('sem-edit-change', { version: ctx.doc.version });
  }

  #renderCrumbs(): void {
    const ctx = this.#ctx;
    const crumbs = this.#crumbs;
    if (ctx === null || crumbs === null || crumbs.ownerDocument === null) return;
    const doc = crumbs.ownerDocument;
    crumbs.textContent = '';

    const docCrumb = doc.createElement('button');
    docCrumb.type = 'button';
    docCrumb.className = 'sem-ed-crumb';
    docCrumb.textContent = 'Document';
    docCrumb.addEventListener('click', () => ctx.select(null));
    crumbs.appendChild(docCrumb);

    const selected = ctx.selectedId;
    if (selected === null) return;
    const chain = [...ctx.doc.ancestorsOf(selected), ctx.doc.node(selected)].filter(
      (n): n is ElementNode => n !== undefined && n.kind === 'element',
    );
    for (const node of chain) {
      const tag = node.name.toLowerCase();
      const isCurrent = node.id === selected;
      const title = ctx.descriptors?.descriptorFor(tag)?.title ?? tag;
      const crumb = doc.createElement(isCurrent ? 'span' : 'button');
      crumb.className = 'sem-ed-crumb';
      crumb.textContent = isCurrent ? `${title} (${tag})` : title; // text — never HTML
      if (isCurrent) crumb.setAttribute('aria-current', 'location');
      else {
        const target = node.id;
        crumb.addEventListener('click', () => ctx.select(target));
      }
      crumbs.appendChild(crumb);
    }
  }

  #scrollToNode(id: NodeId): void {
    const target = this.#canvas?.querySelector(`[data-sem-edit-node="${CSS.escape(id)}"]`);
    if (target !== null && target !== undefined) target.scrollIntoView({ block: 'nearest' });
  }

  // ── verbs ─────────────────────────────────────────────────────────────────

  #doUndo(): void {
    const ctx = this.#ctx;
    if (ctx === null || !ctx.doc.canUndo()) return;
    ctx.doc.undo();
    ctx.announce('Undid last change.');
  }

  #doRedo(): void {
    const ctx = this.#ctx;
    if (ctx === null || !ctx.doc.canRedo()) return;
    ctx.doc.redo();
    ctx.announce('Redid change.');
  }

  #syncHistoryButtons(): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    this.#undoBtn?.toggleAttribute('disabled', !ctx.doc.canUndo());
    this.#redoBtn?.toggleAttribute('disabled', !ctx.doc.canRedo());
  }

  #openProperties(): void {
    const ctx = this.#ctx;
    if (ctx === null || ctx.selectedId === null) return;
    openPropertiesModal(ctx, {});
  }

  #deleteNode(id: NodeId): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    const check = ctx.doc.canApply({ type: 'removeNode', node: id });
    if (!check.ok) {
      ctx.announce(`Cannot delete: ${check.reason ?? 'rejected'}`);
      return;
    }
    const title = ctx.titleFor(id);
    if (ctx.selectedId !== null && ctx.doc.contains(id, ctx.selectedId)) ctx.select(null);
    ctx.doc.apply({ type: 'removeNode', node: id });
    // §7: confirm-or-undo — name the undo path instead of blocking
    ctx.announce(`Deleted ${title}. Undo with Ctrl+Z.`);
  }

  /** Focus the outline rail (Cmd/Ctrl+Shift+O). */
  focusOutline(): void {
    this.#outline?.focus();
  }

  // ── keyboard parity (§7) ──────────────────────────────────────────────────

  #onFrameKey = (e: KeyboardEvent): void => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    const target = e.target as HTMLElement | null;
    const inField =
      target !== null &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable);
    if (key === 'z' && !inField) {
      e.preventDefault();
      if (e.shiftKey) this.#doRedo();
      else this.#doUndo();
    } else if (key === 'e' && e.shiftKey) {
      e.preventDefault();
      this.cycleMode();
    } else if (key === 'o' && e.shiftKey) {
      e.preventDefault();
      this.focusOutline();
    }
  };

  // ── misc ──────────────────────────────────────────────────────────────────

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }
}

// reducedMotion is imported for parity with the chrome contract (§7: all
// editor motion gates on it); the shell animates nothing today — kept as the
// documented gate for lane CSS that later adds transitions.
export { reducedMotion };

SemElement.register(EDITOR_TAG, SemEditor);

declare global {
  interface HTMLElementTagNameMap {
    'sem-editor': SemEditor;
  }
}
