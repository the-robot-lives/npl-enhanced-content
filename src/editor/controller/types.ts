/**
 * controller — editor context and binding types (EDITOR.md §4).
 *
 * `EditorContext` is the shared per-document state the shell (or the
 * shell-less claim path) creates once and hands to every element binding:
 * the model, the descriptor source, the announce channel, and the optional
 * shell hooks (property modal, pickers) — controller verbs degrade to
 * disabled-with-hint when a hook is absent.
 *
 * `EditDescriptor` / `TextSlot` / `ItemListSpec` / `LinkField` are the
 * schema lane's shapes (`../schema/types.js`); the controller consumes
 * them and never re-declares them.
 */

import type { EditorDocument, NodeId } from '../model/types.js';
import type { SemElement } from '../../lit/base.js';
import type { EditDescriptor } from '../schema/types.js';

export type { EditDescriptor, LinkField, ItemListSpec, TextSlot } from '../schema/types.js';

/** What the shell (when present) offers the controller. Every hook is
 *  optional; context-menu items that need one are disabled with a hint. */
export interface ShellHooks {
  openProperties?(binding: ElementBinding): void;
  openWrapPicker?(binding: ElementBinding): void;
  openConvertPicker?(binding: ElementBinding): void;
  /** The block inserter, scoped to position `where` at the binding. */
  openInserter?(binding: ElementBinding, where: 'before' | 'after'): void;
}

/** One edited element: its host, its model node, its resolved descriptor. */
export interface ElementBinding {
  readonly el: SemElement;
  readonly rootId: NodeId;
  readonly descriptor: EditDescriptor | null;
  /** The text slot of THIS element currently contenteditable, if any —
   *  re-renders defer while it exists (§4.5). */
  editingSlot: Element | null;
  /** The EditController instance (set by attachEditor). */
  controller: SemTextEditorController | null;
}

/** Minimal controller surface other controller modules may call. */
export interface SemTextEditorController {
  /** The context the controller serves (chrome/menu callbacks). */
  readonly ctx: EditorContext;
  startSlotEditing(slotEl: Element): void;
  stopSlotEditing(): void;
}

export interface EditorContextOptions {
  doc: EditorDocument;
  /** Descriptor lookup override; default is the schema registry. */
  descriptors?: (tag: string) => EditDescriptor | null;
  shell?: ShellHooks;
  /** Announce override (tests); default is one aria-live region per context. */
  announce?: (message: string) => void;
  /** Reduced-motion probe override (tests). */
  reducedMotion?: () => boolean;
}

export interface EditorContext {
  readonly doc: EditorDocument;
  descriptors(tag: string): EditDescriptor | null;
  readonly shell: ShellHooks | null;
  announce(message: string): void;
  reducedMotion(): boolean;
}

/** Installed on `globalThis` by the editor entry (§9.2). */
export interface SemTextEditorApi {
  /** Shell-less handoff from the core hook (§4.1/§4.8). */
  claim(el: SemElement, source?: string): void;
  /** Drain the pre-load queue (the entry calls this, §9.2). */
  claimPending(): void;
  version: string;
}
