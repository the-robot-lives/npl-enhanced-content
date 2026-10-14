/**
 * EditorContext — the shared object the shell owns and every other editor
 * lane consumes (EDITOR.md §1 "owns one EditorContext", §4.2, §11 contracts).
 *
 * The context carries the document of record, the current selection, the
 * schema/descriptor views the shell's chrome is built from, and the
 * `announce()` sink feeding the single aria-live region (§7). It is the
 * *only* thing the controller and the code view are given — lanes never
 * reach into `<sem-editor>` internals.
 *
 * Phase-1 seams: the model implementations, the element schema and the
 * safety-reviewed canvas projector land in other lanes. Until they do, the
 * shell wires them through the module-level setters here — integrate (or the
 * landing lane) calls `setModelFactory` / `setCanvasProjector` once; hosts
 * (and tests) inject schema and descriptors per context. No editor file
 * imports a not-yet-landed module.
 */

import type { EditorDocument, EditorNode, NodeId, Unsubscribe } from '../model/types.js';

// ── Schema & descriptor views (structural — matches elements.json §3.1 and
//    the EDITOR.md §3.3 descriptor, restricted to the fields the shell reads) ──

/** One attribute of an element, as the schema service reports it. */
export interface AttrSpec {
  name: string;
  required?: boolean | null;
  /** `string | boolean | integer | number | url | …` (advisory). */
  type?: string;
  allowedValues?: readonly string[];
  default?: string | null;
  description?: string;
}

/** Schema view for one tag; `null` = unknown tag (Advanced-only modal). */
export interface TagSchema {
  tag: string;
  title?: string;
  summary?: string;
  attrs: readonly AttrSpec[];
}

export interface SchemaProvider {
  schemaFor(tag: string): TagSchema | null;
}

/** The shell's view of an edit descriptor (EDITOR.md §3.3 subset). */
export interface ShellDescriptor {
  tag: string;
  title: string;
  bucket?: string;
  summary?: string;
  itemList?: {
    childSelector: string;
    label: string;
    template: { id: string; label: string; xml: string };
    max?: number;
  };
  jsonItems?: { selector: string; label: string; schemaHint?: string };
}

export interface DescriptorProvider {
  descriptorFor(tag: string): ShellDescriptor | null;
  all(): readonly ShellDescriptor[];
}

// ── Module-level seams (set once by integrate / the landing lane) ────────────

/** source → live document. Wired to the real parser by integrate; a test or
 *  host may wire a stub earlier. `null` = the shell cannot build documents
 *  from authored children and says so in its canvas. */
export type ModelFactory = (source: string) => EditorDocument;

let modelFactory: ModelFactory | null = null;
export function setModelFactory(factory: ModelFactory | null): void {
  modelFactory = factory;
}
export function getModelFactory(): ModelFactory | null {
  return modelFactory;
}

/** Snippet xml → detached node tree with fresh ids (EDITOR.md §3.3: snippets
 *  parse through the model parser, then rebuild through the doc factories so
 *  the adoption rule holds). Wired by integrate. */
export type TemplateCompiler = (xml: string, doc: EditorDocument) => EditorNode | null;

let templateCompiler: TemplateCompiler | null = null;
export function setTemplateCompiler(compiler: TemplateCompiler | null): void {
  templateCompiler = compiler;
}
export function getTemplateCompiler(): TemplateCompiler | null {
  return templateCompiler;
}

/** (doc, container) → author-inert DOM projection of the whole document
 *  (EDITOR.md §8: `renderAuthorInert` is the only source→preview path).
 *  Wired by the controller/integrate; the shell only invokes it on open and
 *  after each change. */
export type CanvasProjector = (doc: EditorDocument, container: HTMLElement) => void;

let canvasProjector: CanvasProjector | null = null;
export function setCanvasProjector(projector: CanvasProjector | null): void {
  canvasProjector = projector;
}
export function getCanvasProjector(): CanvasProjector | null {
  return canvasProjector;
}

// ── The context ───────────────────────────────────────────────────────────────

export type ContextEventMap = {
  selectionchange: NodeId | null;
};

type Listener = (detail: unknown) => void;

export class EditorContext {
  readonly doc: EditorDocument;
  /** Schema service; `null` until the schema lane's loader is wired. */
  schema: SchemaProvider | null = null;
  /** Descriptor registry; `null` until descriptors land. */
  descriptors: DescriptorProvider | null = null;
  /** The element under inspection/edition; `null` = nothing selected. */
  #selectedId: NodeId | null = null;
  #listeners = new Map<keyof ContextEventMap, Set<Listener>>();
  #liveRegion: HTMLElement | null = null;

  constructor(doc: EditorDocument) {
    this.doc = doc;
  }

  get selectedId(): NodeId | null {
    return this.#selectedId;
  }

  /** The id of the document root (the insertion fallback target). */
  get rootId(): NodeId {
    return this.doc.root.id;
  }

  /** Resolve a descriptor, falling back to the tag spelling itself. */
  titleFor(id: NodeId): string {
    const node = this.doc.node(id);
    if (!node) return id;
    const tag = node.kind === 'element' ? node.name.toLowerCase() : node.kind;
    return this.descriptors?.descriptorFor(tag)?.title ?? `<${tag}>`;
  }

  select(id: NodeId | null): void {
    if (this.#selectedId === id) return;
    this.#selectedId = id;
    const set = this.#listeners.get('selectionchange');
    if (set) for (const cb of set) cb(id);
  }

  on<K extends keyof ContextEventMap>(
    event: K,
    cb: (detail: ContextEventMap[K]) => void,
  ): Unsubscribe {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(cb as unknown as Listener);
    return () => set.delete(cb as unknown as Listener);
  }

  /** The shell registers its single polite live region; announce() feeds it.
   *  Text swaps clear-then-set so repeated identical messages re-announce. */
  setLiveRegion(el: HTMLElement | null): void {
    this.#liveRegion = el;
  }

  announce(message: string): void {
    const el = this.#liveRegion;
    if (!el) return;
    el.textContent = '';
    // next frame: the region is non-empty again and ATs re-read it
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(fn, 16);
    raf(() => {
      el.textContent = message;
    });
  }
}

/**
 * Document title per §5.1: the first `<title>` element's text, else
 * "Untitled". Pure model walk — no DOM.
 */
export function documentTitle(doc: EditorDocument): string {
  const find = (nodes: readonly EditorNode[]): string | null => {
    for (const n of nodes) {
      if (n.kind === 'element' && n.name.toLowerCase() === 'title') {
        const t = doc.textOf(n.id).trim();
        if (t) return t;
      }
      // children arrays never contain the document root itself
      if (n.kind === 'element') {
        const deep = find(n.children);
        if (deep !== null) return deep;
      }
    }
    return null;
  };
  return find(doc.root.children) ?? 'Untitled';
}
