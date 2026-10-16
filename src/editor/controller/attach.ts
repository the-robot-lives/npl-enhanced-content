/**
 * controller/attach — entry points the lazy bundle exposes (§4.2, §4.8).
 *
 * `attachEditor(el, ctx)` binds one SemElement to a shared context; the
 * model is built from the element's serialized authored subtree (outerHTML
 * parse — §4.8 shell-less claim). Attach stamps `data-sem-editing` and wires
 * chrome; detach removes chrome + listeners and is NOT an edit.
 */

import type { EditorContext } from './types.js';
import type { EditDescriptor } from '../schema/types.js';
import type { ElementBinding } from './types.js';
import type { SemElement } from '../../lit/base.js';
import type { EditorDocument, EditorNode, NodeId } from '../model/types.js';
import { createDocument, tryParse } from '../model/document.js';
import { getDescriptor } from '../schema/index.js';
import { EditController, installPostRerenderStamp } from './edit-controller.js';
import { createAnnouncer, ensureInjected } from './chrome.js';
import { CONTROLLER_CSS } from './chrome-css.js';

const bindingMap = new WeakMap<Element, ElementBinding>();
const controllerMap = new WeakMap<Element, EditController>();
const contextMap = new WeakMap<Element, EditorContext>();

export interface AttachOptions {
  doc?: EditorDocument;
  source?: string;
  descriptors?: (tag: string) => EditDescriptor | null;
  shell?: EditorContext['shell'];
  announce?: (message: string) => void;
  reducedMotion?: () => boolean;
}

export function createContext(opts: AttachOptions = {}): EditorContext {
  const doc = opts.doc ?? createDocument(opts.source ?? '');
  const ctx: EditorContext = {
    doc,
    descriptors: opts.descriptors ?? ((tag) => getDescriptor(tag)),
    shell: opts.shell ?? null,
    announce: opts.announce ?? createAnnouncer(document),
    reducedMotion: opts.reducedMotion ?? (() => false),
  };
  return ctx;
}

/** Locate the model element for a host element inside `doc`: by `id`
 *  attribute when present, else the k-th same-tag element in document order
 *  (k = the host's index among same-tag precedents in the DOM). */
export function locateModelRoot(doc: EditorDocument, el: Element): EditorNode | null {
  const tag = el.tagName.toLowerCase();
  const idAttr = el.getAttribute('id');
  const sameTag: EditorNode[] = [];
  const walk = (n: EditorNode): void => {
    if (n.kind !== 'element') return;
    if (n.name.toLowerCase() === tag) sameTag.push(n);
    for (const c of n.children) walk(c);
  };
  for (const c of doc.root.children) walk(c);
  if (idAttr !== null) {
    const byId = sameTag.find((n) => n.kind === 'element' && n.attrs.some((a) => a.name === 'id' && a.value === idAttr));
    return byId ?? null;
  }
  let k = 0;
  let p = el.previousElementSibling;
  while (p !== null) {
    if (p.tagName.toLowerCase() === tag) k++;
    p = p.previousElementSibling;
  }
  return sameTag[k] ?? null;
}

/** Bind one element (§4.2). Idempotent. The element's model node is located
 *  inside `ctx.doc`; when the context has no model yet (shell-less claim,
 *  §4.8) the element's serialized authored subtree is parsed into it. */
export function attachEditor(el: SemElement, ctx: EditorContext): EditController | null {
  const existing = controllerMap.get(el);
  if (existing !== undefined) return existing;
  const descriptor = ctx.descriptors(el.tagName.toLowerCase());
  let doc = ctx.doc;
  if (locateModelRoot(doc, el) === null) {
    // NOTE (§4.2): a live DOM only carries the browser's canonical
    // serialization — authored whitespace inside open tags (wrapped
    // attributes) is unrecoverable here, so undo restores canonical bytes.
    // Authored-faithful editing goes through `createContext({ source })`.
    // Lit runtime markers (empty + `?lit$` comments) are chrome, never
    // authored content — strip before the model ever sees them (§2.4), as
    // is SemSource's runtime fence (`template.sem-source-raw`).
    const source = el.outerHTML
      .replace(/<!--(?:\\?lit\$[^>]*)?-->/g, '')
      .replace(/<template[^>]*\\bsem-source-raw\\b[^>]*>[\\s\\S]*?<\/template>/gi, '')
      // Runtime-only attrs (base.ts's claim marker et al.) never export.
      .replace(/\\sdata-sem-upgraded(?:="[^"]*"|='[^']*'|=[^\\s>]*)?(?=[\\s>])/gi, '');
    const parsed = tryParse(source);
    if (!parsed.ok) {
      ctx.announce(`Cannot edit ${el.tagName.toLowerCase()}: failed to parse`);
      return null;
    }
    doc = parsed.doc;
    (ctx as { doc: EditorDocument }).doc = doc;
  }
  const rootChild = locateModelRoot(doc, el);
  if (rootChild === null) return null;
  const binding: ElementBinding = {
    el, rootId: rootChild.id, descriptor, editingSlot: null, controller: null,
  };
  const controller = new EditController(el, ctx, binding);
  binding.controller = controller;
  bindingMap.set(el, binding);
  controllerMap.set(el, controller);
  contextMap.set(el, ctx);
  el.setAttribute('data-sem-editing', '');
  // Plain hosts (zero-JS tags: sem-heading, sem-paragraph…) have no Lit
  // controller registry — the constructor's addController is a no-op and
  // Lit never calls hostConnected for them. Wire DOM + doc listeners NOW
  // (integrate 2026-10: without this, right-click/edit/chrome silently
  // didn't exist on plain hosts — data-sem-editing was set but inert).
  if (typeof (el as { addController?: unknown }).addController !== 'function') {
    controller.hostConnected();
  }
  ensureInjected(el.ownerDocument, CONTROLLER_CSS);
  installPostRerenderStamp(ctx);
  return controller;
}

export function detachEditor(el: SemElement): void {
  const controller = controllerMap.get(el);
  if (controller === undefined) return;
  controller.hostDisconnected();
  el.removeAttribute('data-sem-editing');
  bindingMap.delete(el);
  controllerMap.delete(el);
  contextMap.delete(el);
}

export function bindingFor(el: Element): ElementBinding | undefined {
  return bindingMap.get(el);
}

/** The `SemTextEditor.claim` seam (§4.8): shell-less attach for the lazy
 *  bundle. Headless context, chrome identical, no shell UI. */
export function claim(el: SemElement, _source?: string): { ok: boolean; rootId?: NodeId; reason?: string } {
  if (controllerMap.has(el)) return { ok: true, rootId: bindingMap.get(el)!.rootId };
  const controller = attachEditor(el, createContext());
  if (controller === null) return { ok: false, reason: 'parse failed' };
  return { ok: true, rootId: controller.binding.rootId };
}

/** Observe `edit-mode` (own attribute or a `sem-editor[edit-mode]` ancestor)
 *  and attach/detach (§4.1). Returns a disconnect fn. */
export function watchEditMode(el: SemElement): () => void {
  const sync = (): void => {
    const on = el.hasAttribute('edit-mode') || el.closest('sem-editor[edit-mode]') !== null;
    if (on && !controllerMap.has(el)) void claim(el);
    if (!on && controllerMap.has(el)) detachEditor(el);
  };
  sync();
  const mo = new MutationObserver(sync);
  mo.observe(el, { attributes: true, attributeFilter: ['edit-mode'] });
  window.addEventListener('semtext-editor-mode', sync);
  return () => {
    mo.disconnect();
    window.removeEventListener('semtext-editor-mode', sync);
  };
}
