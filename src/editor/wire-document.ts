/**
 * editor/wire-document — integrate-lane glue (EDITOR.md §9.2).
 *
 * Two pieces:
 *
 *  1. `reconcilingProjector` — the `setCanvasProjector` seam. It keeps,
 *     reorders, inserts and removes the canvas TOP-LEVEL children to match
 *     the model root, keyed on `data-sem-edit-node` (a move must reorder,
 *     not rebuild — controllers, focus and media survive). New subtrees
 *     render through `renderAuthorInert` (the only source→preview path, §8)
 *     and receive full-depth stamps. Anything INSIDE a bound host belongs to
 *     the controller re-render protocol (§4.4) — the projector never touches
 *     it.
 *
 *  2. `wireDocument(editor, ctx)` — per-document wiring, re-run on every
 *     `sem-edit-open` (openDocument builds a NEW EditorContext): shell hooks
 *     (inserter + properties), insert roads, io, the code-view host, and a
 *     controller attach for every top-level host. Returns one detach.
 */

import type { EditorDocument, EditorNode, ElementNode, NodeId } from './model/types.js';
import { tryParse } from './model/document.js';
import { renderAuthorInert } from './safety/inert.js';
import { isChromeNode } from './controller/map.js';
import { attachEditor } from './controller/attach.js';
import type { EditorContext as ControllerEditorContext, ShellHooks as ControllerShellHooks } from './controller/types.js';
import type { SemEditor } from './shell/sem-editor.js';
import type { EditorContext, SchemaProvider, DescriptorProvider, ShellDescriptor } from './shell/context.js';
import { openPropertiesModal } from './shell/property-modal.js';
import { createInsertShellHooks, wireInsert } from './insert/wire.js';
import { wireIo } from './io/index.js';
import type { SemEditorCode } from './code/sem-editor-code.js';
import { documentTitle } from './shell/context.js';
import type { SemElement } from '../lit/base.js';
import type { EditDescriptor } from './schema/types.js';
import { getDescriptor, handDescriptors } from './schema/index.js';
import { getTag } from './schema/load-schema.js';

// ── 1. the canvas projector ───────────────────────────────────────────────────

/** The document the canvas currently mirrors; a NEW document object means a
 *  full render (openDocument / code adopt), the same one means reconcile. */
let projected: EditorDocument | null = null;

/** Attr names the projector last wrote per kept host. A reconcile removes
 *  only names the MODEL projected — never attrs a descriptor added at
 *  runtime (class/data additions survive model-driven attr edits). */
const projectedAttrs = new Map<NodeId, string[]>();

/** Keep-prefix: stamps and chrome markers are runtime-owned, not model-owned. */
const ATTR_KEEP_PREFIX = 'data-sem-';

function syncHostAttrs(id: NodeId, el: Element, mk: ElementNode): void {
  const names = new Set(mk.attrs.map((a) => a.name));
  const prev = projectedAttrs.get(id);
  if (prev !== undefined) {
    for (const n of prev) {
      if (!names.has(n) && !n.startsWith(ATTR_KEEP_PREFIX)) el.removeAttribute(n);
    }
  }
  for (const a of mk.attrs) {
    const v = a.value ?? ''; // valueless attr (`<button disabled>`) reads as ''
    if (el.getAttribute(a.name) !== v) el.setAttribute(a.name, v);
  }
  projectedAttrs.set(id, mk.attrs.map((a) => a.name));
}

function elementChildren(doc: EditorDocument, id: NodeId): ElementNode[] {
  return doc.childrenOf(id).filter((n): n is ElementNode => n.kind === 'element');
}

/** Project one subtree author-inert and stamp the model↔DOM pairing at full
 *  depth (1:1 by node count — renderAuthorInert preserves counts, swapping
 *  scripts for inert templates positionally). */
function renderSubtree(doc: EditorDocument, id: NodeId): Element {
  const frag = renderAuthorInert(doc.serializeSubtree(id));
  const el = frag.firstElementChild;
  const host = el ?? document.createElement('div');
  stampDepth(doc, id, host);
  return host;
}

function stampDepth(doc: EditorDocument, nodeId: NodeId, dom: Element): void {
  if (dom.getAttribute('data-sem-edit-node') !== nodeId) dom.setAttribute('data-sem-edit-node', nodeId);
  const modelKids = elementChildren(doc, nodeId);
  const domKids = Array.from(dom.children).filter((c) => !isChromeNode(c));
  let k = 0;
  for (const mk of modelKids) {
    const dk = domKids[k++];
    if (dk === undefined) break;
    stampDepth(doc, mk.id, dk);
  }
}

function firstNonChromeChild(container: HTMLElement): Element | null {
  for (const n of Array.from(container.children)) {
    if (!isChromeNode(n)) return n;
  }
  return null;
}

function nextNonChromeSibling(node: Element | null): Element | null {
  let e = node === null ? null : (node.nextElementSibling);
  while (e !== null && isChromeNode(e)) e = e.nextElementSibling;
  return e;
}

/**
 * The reconciling projector (§8 via `setCanvasProjector`). Top level only;
 * keyed on the data-sem-edit-node stamp so a move reorders in place.
 */
export function reconcilingProjector(doc: EditorDocument, canvas: HTMLElement): void {
  const rootId = doc.root.id;
  const modelKids = elementChildren(doc, rootId);

  if (projected !== doc) {
    projected = doc;
    canvas.textContent = '';
    projectedAttrs.clear();
    for (const mk of modelKids) {
      const el = renderSubtree(doc, mk.id);
      canvas.appendChild(el);
      projectedAttrs.set(mk.id, mk.attrs.map((a) => a.name));
    }
    return;
  }

  const modelIds = new Set<NodeId>(modelKids.map((n) => n.id));
  const domKids = Array.from(canvas.children).filter(
    (el): el is HTMLElement => !isChromeNode(el) && el.hasAttribute('data-sem-edit-node'),
  );
  const byStamp = new Map<NodeId, Element>(
    domKids.map((el) => [el.getAttribute('data-sem-edit-node') as NodeId, el]),
  );

  // Removals: stamped DOM nodes the model no longer has.
  for (const el of domKids) {
    const sid = el.getAttribute('data-sem-edit-node') as NodeId;
    if (!modelIds.has(sid)) {
      projectedAttrs.delete(sid);
      el.remove();
    }
  }
  // Fresh renders for model children with no DOM counterpart yet.
  const fresh = new Map<NodeId, Element>();
  for (const mk of modelKids) {
    if (!byStamp.has(mk.id) && !fresh.has(mk.id)) {
      const el = renderSubtree(doc, mk.id);
      fresh.set(mk.id, el);
      projectedAttrs.set(mk.id, mk.attrs.map((a) => a.name));
    }
  }
  // Order pass — the same sweep the controller rerender uses; chrome nodes
  // (+ zones, indicator) keep their relative spots.
  let ref = firstNonChromeChild(canvas);
  for (const mk of modelKids) {
    const node = byStamp.get(mk.id) ?? fresh.get(mk.id);
    if (node === undefined) continue;
    if (mk.kind === 'element' && byStamp.has(mk.id)) {
      // Kept host: its authored children belong to the controller protocol,
      // but the HOST's own attrs are model-owned (§4.4 deviation — the
      // property modal and raw applies both flow through here).
      syncHostAttrs(mk.id, node, mk);
    }
    if (node === ref) {
      ref = nextNonChromeSibling(ref);
      continue;
    }
    canvas.insertBefore(node, ref);
  }
}

/** Reset the projector's mirror state (document swapped under the same
 *  canvas in tests). The entry never calls this. */
export function resetProjectorState(): void {
  projected = null;
  projectedAttrs.clear();
}

// ── 2. per-document wiring ────────────────────────────────────────────────────

export interface DocumentWiring {
  detach(): void;
}

/** Wire ONE open document: hooks, insert roads, io, code host, controllers.
 *  Called again on every sem-edit-open (new EditorContext each time). */
export function wireDocument(editor: SemEditor, ctx: EditorContext): DocumentWiring {
  const ctrlCtx = ctx as unknown as ControllerEditorContext;
  const detach: Array<() => void> = [];

  // ── shell hooks (§4.2): the context menu's live items ──
  const hooks: ControllerShellHooks = {
    ...createInsertShellHooks({ ctx }),
    openProperties(binding) {
      ctx.select(binding.rootId);
      openPropertiesModal(ctx);
    },
  };
  ctx.shell = hooks;

  // ── insert roads: + zones, slash, toolbar request (surface = document) ──
  const canvas = editor.querySelector('.sem-ed-canvas');
  detach.push(
    wireInsert({
      ctx,
      canvas: canvas instanceof HTMLElement ? canvas : null,
      getSelectedId: () => ctx.selectedId,
    }),
  );

  // ── io: export/copy/open requests + the one Cmd/Ctrl+S binder ──
  // surface = the editor element, NOT document: N editors on one page stay
  // isolated (a document-default would stack N export handlers that outlive
  // removed editors), and requests always target the shell itself (§9.2).
  const title = documentTitle(ctx.doc);
  const io = wireIo({
    ctx,
    surface: editor,
    draftsKey: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'document',
    getMode: () => editor.mode,
  });
  detach.push(io.detach);

  // ── code view host (if the host page slotted one) ──
  const codeEl = editor.querySelector('sem-editor-code') as SemEditorCode | null;
  if (codeEl !== null) {
    codeEl.host = {
      tryParse: (source) => tryParse(source),
      adopt: (next) => {
        if (next !== editor.doc) editor.openDocument(next);
      },
      offsetToPos: (offset) => ctx.doc.offsetToPos(offset),
      announce: (message) => ctx.announce(message),
    };
    codeEl.source = ctx.doc.serialize();
  }

  // ── controllers for every top-level host (idempotent) ──
  const attachTopLevel = (): void => {
    if (canvas === null || !(canvas instanceof HTMLElement)) return;
    for (const el of Array.from(canvas.children)) {
      if (isChromeNode(el)) continue;
      const stamp = el.getAttribute('data-sem-edit-node');
      if (stamp === null || ctx.doc.node(stamp) === undefined) continue;
      attachEditor(el as unknown as SemElement, ctrlCtx);
    }
  };
  attachTopLevel();

  // Structural changes at top level (insert at root, undo of a removal) add
  // hosts the projector rendered — attach them once the render settles.
  let scheduled = false;
  detach.push(
    ctx.doc.on('change', () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        attachTopLevel();
        if (codeEl !== null && editor.doc === ctx.doc) codeEl.source = ctx.doc.serialize();
      });
    }),
  );

  return {
    detach() {
      for (const off of detach) off();
      if (codeEl !== null) codeEl.host = null;
    },
  };
}

// ── 3. default schema / descriptor views (entry-installed) ────────────────────

/** Shell schema view derived from the bundled elements.json loader. */
export function schemaProviderFromLoader(): SchemaProvider {
  return {
    schemaFor(tag: string) {
      const spec = getTag(tag);
      if (spec === undefined) return null;
      return {
        tag: spec.name,
        summary: spec.summary,
        attrs: spec.attributes.map((a) => ({
          name: a.name,
          required: a.required,
          type: a.type,
          allowedValues: a.allowedValues,
          default: a.default,
          description: a.description,
        })),
      };
    },
  };
}

/** Shell descriptor view: full registry descriptors narrowed to the fields
 *  the shell reads; unknown tags fall back to the schema spec, then null. */
export function descriptorViewFromRegistry(): DescriptorProvider {
  const toShell = (d: EditDescriptor): ShellDescriptor => ({
    tag: d.tag,
    title: d.title,
    bucket: d.bucket,
    summary: d.summary,
    itemList:
      d.itemList === undefined
        ? undefined
        : {
            childSelector: d.itemList.childSelector,
            label: d.itemList.label,
            template: { ...d.itemList.template },
            max: d.itemList.max,
          },
    jsonItems:
      d.jsonItems === undefined
        ? undefined
        : {
            selector: d.jsonItems.selector,
            label: d.jsonItems.label,
            schemaHint: d.jsonItems.schemaHint,
          },
  });
  return {
    descriptorFor(tag: string): ShellDescriptor | null {
      const d = getDescriptor(tag);
      if (d !== null) return toShell(d);
      const spec = getTag(tag);
      if (spec === undefined) return null;
      return { tag: spec.name, title: spec.name, summary: spec.summary };
    },
    all() {
      const out: ShellDescriptor[] = [];
      for (const d of handDescriptors()) out.push(toShell(d));
      return out;
    },
  };
}
