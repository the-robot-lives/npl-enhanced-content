/**
 * sem-editor — the editor shell element (EDITOR.md §5, Instrument shell).
 *
 * A `SemElement` that owns its children at the sem-browser altitude: it
 * builds the IDE-style frame — a compact top bar (editable document name +
 * dirty dot, the Visual|Code|Split segmented control, grouped icon actions
 * with visible shortcuts), a semantic outline rail (resizable, collapsible),
 * the WYSIWYG | Code | Split panes, a docked right-hand properties inspector
 * and a status bar (mode · word/element counts · parse problems · saved
 * state) — and moves the document into the canvas. The document of record is
 * the model (`EditorDocument`); the DOM is a projection, re-drawn through the
 * injected canvas projector (EDITOR.md §8: `renderAuthorInert` is the only
 * source→preview path; the shell never innerHTMLs model content — the only
 * innerHTML in this file is the static icon markup below).
 *
 * Seams:
 *  - `setModelFactory` (context.js): source → document. Without it the shell
 *    still opens an injected document and shows an empty-state canvas.
 *  - `setCanvasProjector` (context.js): the author-inert projection.
 *  - code pane: a named slot (`code-view`) for the code lane's
 *    `<sem-editor-code>`; selection syncs both ways with it (§2.6).
 *  - `ctx.schema` / `ctx.descriptorView`: the schema and descriptor views
 *    the inspector, modal and outline read.
 *
 * Mode is reflected as `data-mode` (§5.2); edit-mode is stamped on the host
 * when a document opens so the base.ts lazy hook (§4.1) queues the edited
 * elements. `sem-edit-change` / `sem-edit-mode` / `sem-edit-selection` are
 * optional DOM mirrors — the intra-editor contract is `doc.on` (§2.4).
 *
 * Dirty/saved (Instrument): the shell tracks `doc.version` against the last
 * `markSaved()` (export / autosave flush call it through wireDocument), shows
 * the amber dot + "Unsaved changes" in the status bar, and guards
 * `beforeunload` while dirty. `readonly` (reflected) disables the editing
 * verbs for host-presented read-only views.
 */

import { SemElement } from '../../lit/base.js';
import { reducedMotion } from '../../shared/window-chrome.js';
import {
  EditorContext,
  documentTitle,
  getCanvasProjector,
  getDefaultDescriptorView,
  getDefaultSchemaProvider,
  getModelFactory,
} from './context.js';
import type { EditorDocument, ElementNode, NodeId, ParseIssue } from '../model/types.js';
import { OutlineList } from './outline.js';
import { InspectorPanel } from './inspector.js';
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

/** Narrow-container cut (sheets instead of docked rails) — matches the CSS
 *  container query in shell-css.ts. */
const NARROW_PX = 700;
const OUTLINE_KEY = 'semtext-editor:outline-width';

/** Static icon markup (trusted constants — never model content). */
const ICONS: Record<string, string> = {
  undo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3 2.5 6.5 6 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 6.5H9.5a4 4 0 0 1 0 8H7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  redo: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3l3.5 3.5L10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 6.5H6.5a4 4 0 0 0 0 8h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  visual: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  code: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 1 8l4.5 4.5M10.5 3.5 15 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  split: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5v11" stroke="currentColor" stroke-width="1.5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  export: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 11v1.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  open: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 2H13A1.5 1.5 0 0 1 14.5 6v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  outline: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4h9M5.5 8h9M5.5 12h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="2.2" cy="4" r="1" fill="currentColor"/><circle cx="2.2" cy="8" r="1" fill="currentColor"/><circle cx="2.2" cy="12" r="1" fill="currentColor"/></svg>',
  properties: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5h11M2.5 11h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10.5" cy="11" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};

export class SemEditor extends SemElement {
  static properties = {
    /** View mode; reflected as `data-mode` on the host (§5.2). */
    mode: { type: String },
    /** The open document (injected — never authored). */
    doc: { attribute: false },
    /** Read-only presentation: editing verbs disabled, no beforeunload. */
    readonly: { type: Boolean, reflect: true },
  };

  declare mode: EditorMode;
  declare doc: EditorDocument | null;
  declare readonly: boolean;

  #wired = false;
  #ctx: EditorContext | null = null;
  #unsubs: Array<() => void> = [];
  #pendingSource: string | null = null;

  #frame: HTMLElement | null = null;
  #toolbar: HTMLElement | null = null;
  #undoBtn: HTMLButtonElement | null = null;
  #redoBtn: HTMLButtonElement | null = null;
  #modeGroup: HTMLElement | null = null;
  #outlineBtn: HTMLButtonElement | null = null;
  #inspectorBtn: HTMLButtonElement | null = null;
  #docNameInput: HTMLInputElement | null = null;
  #dirtyDot: HTMLElement | null = null;
  #crumbs: HTMLElement | null = null;
  #outline: OutlineList | null = null;
  #outlineHost: HTMLElement | null = null;
  #outlineResizer: HTMLElement | null = null;
  #inspector: InspectorPanel | null = null;
  #inspectorHost: HTMLElement | null = null;
  #canvas: HTMLElement | null = null;
  #codeSlot: HTMLSlotElement | null = null;
  #codeFallback: HTMLElement | null = null;
  #problemsPanel: HTMLElement | null = null;
  #problemsList: HTMLElement | null = null;
  #problemsBtn: HTMLButtonElement | null = null;
  #statusMode: HTMLElement | null = null;
  #statusCounts: HTMLElement | null = null;
  #statusSaved: HTMLElement | null = null;
  #statusReadonly: HTMLElement | null = null;
  #live: HTMLElement | null = null;

  #docName = 'Untitled';
  #dirty = false;
  #savedVersion: number | null = null;
  #savedAt: Date | null = null;
  #issues: ParseIssue[] = [];
  #issuesFailed = false;
  #outlineOpen = true;
  #inspectorOpen = false;

  constructor() {
    super();
    this.mode = 'wysiwyg';
    this.doc = null;
    this.readonly = false;
  }

  /** The live context once a document is open; null before that. */
  get ctx(): EditorContext | null {
    return this.#ctx;
  }

  /** Current document name (shell-level; a real <title> node is edited
   *  through it). Hosts (export filename) read this. */
  get docName(): string {
    return this.#docName;
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
    this.#unbindBeforeUnload();
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
      this.#syncStatus();
    }
    if (changed.has('readonly')) {
      this.#syncReadonly();
    }
  }

  /** Open (or replace) the document of record. */
  openDocument(doc: EditorDocument): void {
    this.#ensureWired();
    for (const off of this.#unsubs) off();
    this.#unsubs = [];

    const ctx = new EditorContext(doc);
    ctx.schema = this.#schemaBridge ?? getDefaultSchemaProvider();
    ctx.descriptorView = this.#descriptorBridge ?? getDefaultDescriptorView();
    this.#ctx = ctx;
    this.doc = doc;
    // §4.1 signal: elements in this subtree (and this frame) queue for edit
    this.setAttribute('edit-mode', '');

    this.#pendingSource = null;
    this.#syncModeGroup();

    this.#docName = documentTitle(doc);
    if (this.#docNameInput !== null) this.#docNameInput.value = this.#docName;
    this.#savedVersion = doc.version;
    this.#savedAt = new Date();
    this.#setDirty(false);
    this.#reportIssues([...doc.issues], false);

    this.#unsubs.push(
      doc.on('change', () => this.#renderFromModel()),
      doc.on('history', () => this.#syncHistoryButtons()),
    );

    ctx.setLiveRegion(this.#live);
    ctx.on('selectionchange', (id) => this.#onSelectionChange(id));
    this.#ensureOutline(ctx).refresh();
    this.#ensureInspector(ctx).refresh();
    this.#renderCrumbs();
    this.#renderFromModel();
    this.#syncHistoryButtons();
    this.#syncReadonly();
    // Per-document re-wire hook (integrate): openDocument builds a NEW
    // EditorContext, so insert/io/code wiring must re-run against it. Fired
    // AFTER the first projection so listeners see a rendered canvas.
    this.#emit('sem-edit-open', { ctx });
  }

  /** Cycle wysiwyg → code → split → wysiwyg (Cmd/Ctrl+Shift+E, §7). */
  cycleMode(): void {
    const next = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.mode = next;
  }

  /** Clear the dirty state (export / autosave call this via wireDocument). */
  markSaved(): void {
    if (this.#ctx === null) return;
    this.#savedVersion = this.#ctx.doc.version;
    this.#savedAt = new Date();
    this.#setDirty(false);
  }

  /** Parse issues from the code lane (or open) — status bar + problems list. */
  reportIssues(issues: ParseIssue[], failed: boolean): void {
    this.#reportIssues(issues, failed);
  }

  #reportIssues(issues: ParseIssue[], failed: boolean): void {
    this.#issues = issues;
    this.#issuesFailed = failed;
    const btn = this.#problemsBtn;
    if (btn !== null) {
      btn.textContent =
        issues.length === 0 ? (failed ? 'parse failed' : 'parsed OK') : `${issues.length} problem${issues.length === 1 ? '' : 's'}`;
      btn.className = `sem-ed-status-problems${issues.length > 0 || failed ? ' has-problems' : ''}`;
      btn.disabled = this.#ctx === null;
    }
    this.#renderProblems();
    this.#syncStatus();
  }

  #renderProblems(): void {
    const list = this.#problemsList;
    const panel = this.#problemsPanel;
    if (list === null || panel === null) return;
    list.textContent = '';
    if (this.#issues.length === 0) {
      panel.hidden = true;
      return;
    }
    const doc = list.ownerDocument;
    if (doc === null) return;
    for (const issue of this.#issues) {
      const li = doc.createElement('li');
      const jump = doc.createElement('button');
      jump.type = 'button';
      jump.className = 'sem-ed-problem-jump';
      jump.textContent = issue.message;
      const at = issue.range.start;
      jump.addEventListener('click', () => this.#jumpToOffset(at));
      li.appendChild(jump);
      list.appendChild(li);
    }
  }

  #jumpToOffset(offset: number): void {
    if (this.mode !== 'code' && this.mode !== 'split') this.mode = 'split';
    const code = this.#codeElement();
    if (code !== null) {
      code.reparseNow();
      code.setSelectionByOffset(offset);
      const ta = code.querySelector('textarea');
      if (ta !== null) ta.focus();
    }
  }

  #codeElement(): import('../code/sem-editor-code.js').SemEditorCode | null {
    return this.querySelector('sem-editor-code') as import('../code/sem-editor-code.js').SemEditorCode | null;
  }

  #setDirty(dirty: boolean): void {
    if (this.#dirty === dirty) {
      this.#syncStatus();
      return;
    }
    this.#dirty = dirty;
    this.#dirtyDot?.toggleAttribute('data-on', dirty);
    if (dirty) this.#bindBeforeUnload();
    else this.#unbindBeforeUnload();
    this.#syncStatus();
  }

  #beforeUnload = (e: BeforeUnloadEvent): void => {
    if (!this.#dirty || this.readonly) return;
    e.preventDefault();
    e.returnValue = '';
  };

  #bindBeforeUnload(): void {
    this.ownerDocument?.defaultView?.addEventListener('beforeunload', this.#beforeUnload);
  }

  #unbindBeforeUnload(): void {
    this.ownerDocument?.defaultView?.removeEventListener('beforeunload', this.#beforeUnload);
  }

  #syncStatus(): void {
    if (this.#statusMode !== null) this.#statusMode.textContent = MODE_LABELS[this.mode];
    if (this.#statusSaved !== null) {
      if (this.readonly) this.#statusSaved.textContent = 'Read-only';
      else if (this.#ctx === null || this.#savedAt === null) this.#statusSaved.textContent = '';
      else if (this.#dirty) this.#statusSaved.textContent = 'Unsaved changes';
      else {
        this.#statusSaved.textContent = `Saved ${this.#savedAt.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
      }
    }
    if (this.#statusReadonly !== null) this.#statusReadonly.hidden = !this.readonly;
  }

  // ── schema / descriptor bridges (hosts and tests may override per element) ──

  /** Hosts set richer bridges; the defaults read the context of THIS editor
   *  only — tests inject directly onto `el.ctx.schema`. */
  #schemaBridge: EditorContext['schema'] = null;
  #descriptorBridge: EditorContext['descriptorView'] = null;

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
    // wired — §5.2 move-on-connect; the model preserves the bytes, not the
    // DOM). Named-slot chrome (the code pane) is NOT document content — it
    // is lifted out of the capture and re-attached after the frame renders,
    // so its real custom element survives for wireDocument to host.
    let keptPanes: Element[] = [];
    if (this.childNodes.length > 0) {
      keptPanes = Array.from(this.querySelectorAll(':scope > [slot]'));
      for (const pane of keptPanes) pane.remove();
      this.#pendingSource = this.innerHTML;
      this.textContent = '';
    }

    const narrow = (this.clientWidth || 800) < NARROW_PX;
    this.#outlineOpen = !narrow;
    this.#inspectorOpen = !narrow;

    const frame = doc.createElement('div');
    frame.className = 'sem-ed-frame';
    this.#frame = frame;

    frame.appendChild(this.#buildToolbar(doc));
    frame.appendChild(this.#buildCrumbs(doc));
    frame.appendChild(this.#buildBody(doc));
    frame.appendChild(this.#buildProblems(doc));
    frame.appendChild(this.#buildStatusBar(doc));

    const live = doc.createElement('div');
    live.className = 'sem-ed-live';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    this.#live = live;
    frame.appendChild(live);

    this.appendChild(frame);
    for (const pane of keptPanes) this.appendChild(pane);
    frame.addEventListener('keydown', this.#onFrameKey);
    this.setAttribute('data-mode', this.mode);
    this.#syncModeGroup();
    this.#applyPanelState();

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

  // ── top bar (role=toolbar: one rover over its buttons) ────────────────────

  #buildToolbar(doc: Document): HTMLElement {
    const bar = doc.createElement('div');
    bar.className = 'sem-ed-topbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Editor toolbar');
    bar.addEventListener('keydown', (e) => this.#onToolbarKey(e));
    this.#toolbar = bar;

    const iconSpan = (name: string): HTMLElement => {
      const span = doc.createElement('span');
      span.className = 'sem-ed-ico';
      span.setAttribute('aria-hidden', 'true');
      span.innerHTML = ICONS[name] ?? ''; // static trusted markup only
      return span;
    };
    const tool = (opts: {
      icon: string;
      label: string;
      onClick: () => void;
      hint?: string;
      shortcuts?: string;
    }): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sem-ed-btn';
      b.tabIndex = -1;
      b.appendChild(iconSpan(opts.icon));
      const text = doc.createElement('span');
      text.className = 'sem-ed-btn-label';
      text.textContent = opts.label;
      b.appendChild(text);
      b.title = opts.hint ? `${opts.label} (${opts.hint})` : opts.label;
      if (opts.shortcuts) b.setAttribute('aria-keyshortcuts', opts.shortcuts);
      b.setAttribute('aria-label', opts.label);
      b.addEventListener('click', () => opts.onClick());
      bar.appendChild(b);
      return b;
    };
    const sep = (): void => {
      const s = doc.createElement('span');
      s.className = 'sem-ed-sep';
      s.setAttribute('aria-hidden', 'true');
      bar.appendChild(s);
    };

    // left: dirty dot + editable document name
    const docGroup = doc.createElement('div');
    docGroup.className = 'sem-ed-doc';
    const dot = doc.createElement('span');
    dot.className = 'sem-ed-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.title = 'Unsaved changes';
    this.#dirtyDot = dot;
    docGroup.appendChild(dot);
    const name = doc.createElement('input');
    name.type = 'text';
    name.className = 'sem-ed-doc-name';
    name.value = this.#docName;
    name.setAttribute('aria-label', 'Document name');
    name.spellcheck = false;
    name.addEventListener('change', () => this.#renameTo(name.value));
    this.#docNameInput = name;
    docGroup.appendChild(name);
    bar.appendChild(docGroup);
    sep();

    // center: mode segmented control
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
    const MODE_ICONS: Record<EditorMode, string> = { wysiwyg: 'visual', code: 'code', split: 'split' };
    for (const mode of MODES) {
      const radio = doc.createElement('button');
      radio.type = 'button';
      radio.className = 'sem-ed-mode';
      radio.setAttribute('role', 'radio');
      radio.dataset.modeValue = mode;
      radio.tabIndex = -1;
      radio.setAttribute('aria-label', MODE_LABELS[mode]);
      radio.title = `${MODE_LABELS[mode]} view (Ctrl+Shift+E)`;
      radio.appendChild(iconSpan(MODE_ICONS[mode]));
      const text = doc.createElement('span');
      text.className = 'sem-ed-btn-label';
      text.textContent = MODE_LABELS[mode];
      radio.appendChild(text);
      radio.addEventListener('click', () => {
        this.mode = mode;
      });
      group.appendChild(radio);
    }
    this.#modeGroup = group;
    bar.appendChild(group);
    sep();

    // right: actions
    this.#undoBtn = tool({
      icon: 'undo',
      label: 'Undo',
      onClick: () => this.#doUndo(),
      hint: 'Ctrl+Z',
      shortcuts: 'Control+Z Meta+Z',
    });
    this.#redoBtn = tool({
      icon: 'redo',
      label: 'Redo',
      onClick: () => this.#doRedo(),
      hint: 'Ctrl+Shift+Z',
      shortcuts: 'Control+Shift+Z Meta+Shift+Z',
    });
    sep();
    this.#outlineBtn = tool({ icon: 'outline', label: 'Outline', onClick: () => this.#toggleOutline() });
    this.#outlineBtn.setAttribute('aria-expanded', String(this.#outlineOpen));

    const insert = tool({ icon: 'plus', label: 'Insert', onClick: () => this.#requestInsert() });
    insert.disabled = this.doc === null;
    this.#insertBtn = insert;

    this.#inspectorBtn = tool({
      icon: 'properties',
      label: 'Properties',
      onClick: () => this.#toggleInspector(),
    });

    const exporter = tool({
      icon: 'export',
      label: 'Export',
      onClick: () => this.#emit('sem-edit-export-request', {}),
      hint: 'Ctrl+S',
      shortcuts: 'Control+S Meta+S',
    });
    exporter.disabled = this.doc === null;
    this.#exportBtn = exporter;

    const open = tool({ icon: 'open', label: 'Open', onClick: () => this.#emit('sem-edit-open-request', {}) });
    this.#openBtn = open;

    // the roving tab stop: first enabled tool button
    const first = bar.querySelector<HTMLButtonElement>('button:not([disabled])');
    if (first !== null) first.tabIndex = 0;
    return bar;
  }

  #insertBtn: HTMLButtonElement | null = null;
  #exportBtn: HTMLButtonElement | null = null;
  #openBtn: HTMLButtonElement | null = null;

  #requestInsert(): void {
    const ctx = this.#ctx;
    const parent = ctx?.selectedId ?? ctx?.rootId ?? null;
    this.#emit('sem-edit-insert-request', { parent, index: null });
  }

  #renameTo(value: string): void {
    const ctx = this.#ctx;
    const next = value.trim() === '' ? 'Untitled' : value.trim();
    this.#docName = next;
    if (this.#docNameInput !== null) this.#docNameInput.value = next;
    if (ctx === null) return;
    // write through to a real <title> node when one exists
    const findTitle = (children: readonly import('../model/types.js').EditorNode[]): ElementNode | null => {
      for (const node of children) {
        if (node.kind !== 'element') continue;
        const el = node as ElementNode;
        if (el.name.toLowerCase() === 'title') return el;
      }
      return null;
    };
    const titleNode = findTitle(ctx.doc.root.children);
    if (titleNode !== null) {
      const textChild = ctx.doc.childrenOf(titleNode.id).find((n) => n.kind === 'text');
      if (textChild !== undefined) {
        ctx.doc.apply({ type: 'setText', node: textChild.id, value: next });
        ctx.announce(`Document renamed to ${next}.`);
        return;
      }
    }
    ctx.announce(`Document name set to ${next}.`);
  }

  #onToolbarKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const bar = this.#toolbar;
    if (bar === null) return;
    const stops = Array.from(bar.querySelectorAll<HTMLButtonElement>('button')).filter(
      (el) => el.tabIndex >= 0 && !el.disabled,
    );
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLButtonElement);
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

  // ── panels (outline rail + inspector) ─────────────────────────────────────

  #toggleOutline(): void {
    this.#outlineOpen = !this.#outlineOpen;
    this.#applyPanelState();
  }

  #toggleInspector(): void {
    this.#inspectorOpen = !this.#inspectorOpen;
    this.#applyPanelState();
    if (this.#inspectorOpen) this.#inspector?.refresh();
  }

  #applyPanelState(): void {
    const frame = this.#frame;
    if (frame === null) return;
    frame.dataset.outlineOpen = String(this.#outlineOpen);
    frame.dataset.inspectorOpen = String(this.#inspectorOpen);
    if (this.#outlineBtn !== null) this.#outlineBtn.setAttribute('aria-expanded', String(this.#outlineOpen));
    if (this.#inspectorBtn !== null) this.#inspectorBtn.setAttribute('aria-expanded', String(this.#inspectorOpen));
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

  #ensureInspector(ctx: EditorContext): InspectorPanel {
    if (this.#inspector === null) {
      this.#inspector = new InspectorPanel({
        onAllProperties: () => this.#openProperties(),
      });
      this.#inspectorHost?.appendChild(this.#inspector.root);
    }
    this.#inspector.setContext(ctx);
    return this.#inspector;
  }

  /** Restore (or default) the outline rail width; pointer-drag resizes. */
  #bindOutlineResizer(): void {
    const resizer = this.#outlineResizer;
    const host = this.#outlineHost;
    const doc = resizer?.ownerDocument ?? null;
    if (resizer === null || host === null || doc === null) return;
    const stored = doc.defaultView?.localStorage?.getItem(OUTLINE_KEY) ?? null;
    if (stored !== null) {
      const px = Number.parseInt(stored, 10);
      if (Number.isFinite(px) && px >= 180 && px <= 400) host.style.width = `${px}px`;
    }
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-label', 'Resize outline');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.tabIndex = 0;
    let startX = 0;
    let startW = 0;
    const onMove = (e: PointerEvent): void => {
      const w = Math.min(400, Math.max(180, startW + (e.clientX - startX)));
      host.style.width = `${w}px`;
    };
    const onUp = (): void => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      const px = Number.parseInt(host.style.width, 10);
      if (Number.isFinite(px)) doc.defaultView?.localStorage?.setItem(OUTLINE_KEY, String(px));
    };
    resizer.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startW = host.getBoundingClientRect().width;
      doc.addEventListener('pointermove', onMove);
      doc.addEventListener('pointerup', onUp);
      e.preventDefault();
    });
    resizer.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const current = host.getBoundingClientRect().width;
        const w = Math.min(400, Math.max(180, current + (e.key === 'ArrowRight' ? 16 : -16)));
        host.style.width = `${w}px`;
        doc.defaultView?.localStorage?.setItem(OUTLINE_KEY, String(Math.round(w)));
      },
    );
  }

  // ── crumbs, body, panes, status ───────────────────────────────────────────

  #buildCrumbs(doc: Document): HTMLElement {
    const nav = doc.createElement('nav');
    nav.className = 'sem-ed-crumbs';
    nav.setAttribute('aria-label', 'Breadcrumb');
    this.#crumbs = nav;
    return nav;
  }

  #buildBody(doc: Document): HTMLElement {
    const body = doc.createElement('div');
    body.className = 'sem-ed-main';

    const outlineHost = doc.createElement('div');
    outlineHost.className = 'sem-ed-outline-host';
    outlineHost.id = 'sem-ed-outline-host';
    this.#outlineHost = outlineHost;
    body.appendChild(outlineHost);

    const resizer = doc.createElement('div');
    resizer.className = 'sem-ed-outline-resizer';
    this.#outlineResizer = resizer;
    body.appendChild(resizer);
    this.#bindOutlineResizer();

    const viewport = doc.createElement('div');
    viewport.className = 'sem-ed-panes';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Document canvas');

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

    viewport.append(wysiwyg, codePane);
    body.appendChild(viewport);

    const inspectorHost = doc.createElement('div');
    inspectorHost.className = 'sem-ed-inspector-host';
    inspectorHost.id = 'sem-ed-inspector-host';
    this.#inspectorHost = inspectorHost;
    body.appendChild(inspectorHost);
    return body;
  }

  #buildProblems(doc: Document): HTMLElement {
    const panel = doc.createElement('div');
    panel.className = 'sem-ed-problems';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Problems');
    panel.hidden = true;
    const head = doc.createElement('p');
    head.className = 'sem-ed-problems-head';
    head.textContent = 'Problems';
    panel.appendChild(head);
    const list = doc.createElement('ul');
    this.#problemsList = list;
    panel.appendChild(list);
    this.#problemsPanel = panel;
    return panel;
  }

  #buildStatusBar(doc: Document): HTMLElement {
    const bar = doc.createElement('div');
    bar.className = 'sem-ed-statusbar';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', 'Editor status');

    const mode = doc.createElement('span');
    mode.className = 'sem-ed-status-mode';
    mode.textContent = MODE_LABELS[this.mode];
    this.#statusMode = mode;
    bar.appendChild(mode);

    const counts = doc.createElement('span');
    counts.className = 'sem-ed-status-counts';
    this.#statusCounts = counts;
    bar.appendChild(counts);

    const problems = doc.createElement('button');
    problems.type = 'button';
    problems.className = 'sem-ed-status-problems';
    problems.textContent = 'parsed OK';
    problems.disabled = true;
    problems.addEventListener('click', () => {
      const panel = this.#problemsPanel;
      if (panel === null) return;
      panel.hidden = !panel.hidden;
    });
    this.#problemsBtn = problems;
    bar.appendChild(problems);

    const spacer = doc.createElement('span');
    spacer.className = 'sem-ed-status-spacer';
    bar.appendChild(spacer);

    const roChip = doc.createElement('span');
    roChip.className = 'sem-ed-status-ro';
    roChip.textContent = 'Read-only';
    roChip.hidden = true;
    this.#statusReadonly = roChip;
    bar.appendChild(roChip);

    const saved = doc.createElement('span');
    saved.className = 'sem-ed-status-saved';
    this.#statusSaved = saved;
    bar.appendChild(saved);
    return bar;
  }

  #syncCodeFallback(): void {
    const slot = this.#codeSlot;
    const fallback = this.#codeFallback;
    if (slot === null || fallback === null) return;
    fallback.hidden = slot.assignedElements().length > 0;
  }

  #showEmpty(message: string): void {
    const canvas = this.#canvas;
    const doc = this.ownerDocument;
    if (canvas === null || doc === null) return;
    canvas.textContent = '';
    const note = doc.createElement('div');
    note.className = 'sem-ed-empty';
    const p = doc.createElement('p');
    p.textContent = message;
    note.appendChild(p);
    const hint = doc.createElement('p');
    hint.className = 'sem-ed-empty-hint';
    hint.textContent = 'Use Add block between existing blocks, or Insert in the toolbar, to add the first one.';
    note.appendChild(hint);
    canvas.appendChild(note);
  }

  // ── model rendering ───────────────────────────────────────────────────────

  #renderFromModel(): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    this.#outline?.refresh();
    this.#renderCrumbs();
    const projector = getCanvasProjector();
    const canvas = this.#canvas;
    if (projector === null) {
      this.#showEmpty('The visual projection is wired in Phase 3 (renderAuthorInert).');
    } else if (canvas !== null) {
      // NOTE: the canvas is NOT wiped here — the projector owns reconciliation
      // (keep/reorder/insert/remove keyed on data-sem-edit-node), so an
      // in-place re-render preserves controllers, focus and scroll anchors.
      try {
        projector(ctx.doc, canvas);
      } catch (err) {
        this.#showEmpty(`Projection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (this.#insertBtn !== null) this.#insertBtn.disabled = this.readonly;
    if (this.#exportBtn !== null) this.#exportBtn.disabled = false;
    this.#syncHistoryButtons();
    if (this.#savedVersion !== null && this.#savedVersion !== ctx.doc.version) this.#setDirty(true);
    this.#syncCounts();
    this.#emit('sem-edit-change', { version: ctx.doc.version });
  }

  #syncCounts(): void {
    const ctx = this.#ctx;
    const counts = this.#statusCounts;
    if (ctx === null || counts === null) return;
    let elements = 0;
    const walk = (children: readonly import('../model/types.js').EditorNode[]): void => {
      for (const node of children) {
        if (node.kind === 'element') {
          elements += 1;
          walk((node as ElementNode).children);
        }
      }
    };
    walk(ctx.doc.root.children);
    const words = ctx.doc.textOf(ctx.doc.root.id).trim().split(/\s+/).filter(Boolean).length;
    counts.textContent = `${words} word${words === 1 ? '' : 's'} · ${elements} element${elements === 1 ? '' : 's'}`;
  }

  #onSelectionChange(id: NodeId | null): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    this.#outline?.syncSelection(id);
    this.#renderCrumbs();
    this.#inspector?.refresh();
    this.#emit('sem-edit-selection', { id });
    // visual → code selection sync (§2.6; deferred while the code pane drives)
    if (id !== null) {
      const code = this.#codeElement();
      const range = ctx.doc.rangeOf(id);
      if (code !== null && range !== undefined) code.setSelectionByOffset(range.start, range.end);
    }
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
      const title = ctx.descriptorView?.descriptorFor(tag)?.title ?? tag;
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
    if (ctx === null || this.readonly || !ctx.doc.canUndo()) return;
    ctx.doc.undo();
    ctx.announce('Undid last change.');
  }

  #doRedo(): void {
    const ctx = this.#ctx;
    if (ctx === null || this.readonly || !ctx.doc.canRedo()) return;
    ctx.doc.redo();
    ctx.announce('Redid change.');
  }

  #syncHistoryButtons(): void {
    const ctx = this.#ctx;
    if (ctx === null) return;
    this.#undoBtn?.toggleAttribute('disabled', this.readonly || !ctx.doc.canUndo());
    this.#redoBtn?.toggleAttribute('disabled', this.readonly || !ctx.doc.canRedo());
  }

  #syncReadonly(): void {
    const ro = this.readonly;
    if (this.#insertBtn !== null) this.#insertBtn.disabled = ro || this.doc === null;
    if (this.#undoBtn !== null) this.#undoBtn.disabled = ro || (this.#ctx !== null && !this.#ctx.doc.canUndo());
    if (this.#redoBtn !== null) this.#redoBtn.disabled = ro || (this.#ctx !== null && !this.#ctx.doc.canRedo());
    this.#outline?.root.toggleAttribute('data-readonly', ro);
    this.#frame?.toggleAttribute('data-readonly', ro);
    this.#syncStatus();
  }

  #openProperties(): void {
    const ctx = this.#ctx;
    if (ctx === null || ctx.selectedId === null) return;
    openPropertiesModal(ctx, {});
  }

  #deleteNode(id: NodeId): void {
    const ctx = this.#ctx;
    if (ctx === null || this.readonly) return;
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

  /** Focus the outline rail (Cmd/Ctrl+Shift+O); opens it when collapsed. */
  focusOutline(): void {
    if (!this.#outlineOpen) this.#toggleOutline();
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
