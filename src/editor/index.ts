/**
 * editor entry — the `semtext-editor.js` bundle (EDITOR.md §9.2).
 *
 * Installs `window.SemTextEditor` (claim / claimPending / version + the
 * document factory hosts use for tests and multi-document pages), wires the
 * model seams into the shell, and side-effect imports EVERY `*.edit.ts`
 * descriptor module — without them the descriptor registry resolves
 * fallbacks and slot editing / item lists / wizards break (§3.3).
 *
 * Shell-aware claim: an element inside a live `<sem-editor>` binds to THAT
 * editor's context (§4.2 — one shared context of record); everything else
 * goes through the shell-less path (§4.8). Chrome and non-model nodes
 * (toolbar, code pane, + zones) are refused — their wiring belongs to
 * `wireDocument`.
 */

import type { SemElement as SemElementLike } from '../lit/base.js';
import type { EditorDocument, ParseResult } from './model/types.js';
import type { SemEditor } from './shell/sem-editor.js';

import { createDocument as modelCreateDocument, tryParse as modelTryParse } from './model/document.js';
import { drainPending } from '../lit/edit-hook.js';

import {
  setModelFactory,
  setTemplateCompiler,
  setCanvasProjector,
  setDescriptorLookup,
  setDefaultSchemaProvider,
  setDefaultDescriptorView,
} from './shell/context.js';

// Editor-owned components (registered nowhere else — the core bundle ships
// the vocabulary; these two ship with the editor).
import './shell/sem-editor.js';
import './code/sem-editor-code.js';

// Model + schema seams.
import { buildFromXml } from './controller/actions.js';
import { attachEditor, claim as claimShellLess } from './controller/attach.js';
import {
  reconcilingProjector,
  wireDocument,
  schemaProviderFromLoader,
  descriptorViewFromRegistry,
} from './wire-document.js';
import { getDescriptor } from './schema/index.js';

// Insert roads + drag & drop + keyboard moves (document-level, wire once).
import { wireDnD } from './dnd/index.js';

// ── descriptor registration (side-effect imports — §3.3, every bucket) ───────

import '../lit/agent.edit.js';
import '../lit/highlight.edit.js';
import '../lit/npl/npl-agent.edit.js';
import '../lit/npl/npl-artifact.edit.js';
import '../lit/npl/npl-cot.edit.js';
import '../lit/npl/npl-critique.edit.js';
import '../lit/npl/npl-declaration.edit.js';
import '../lit/npl/npl-directive.edit.js';
import '../lit/npl/npl-example.edit.js';
import '../lit/npl/npl-flag.edit.js';
import '../lit/npl/npl-flags.edit.js';
import '../lit/npl/npl-hormones.edit.js';
import '../lit/npl/npl-intent.edit.js';
import '../lit/npl/npl-mindread.edit.js';
import '../lit/npl/npl-mode.edit.js';
import '../lit/npl/npl-mood.edit.js';
import '../lit/npl/npl-poa.edit.js';
import '../lit/npl/npl-ref.edit.js';
import '../lit/npl/npl-rubric.edit.js';
import '../lit/npl/npl-section.edit.js';
import '../lit/npl/npl-thought.edit.js';
import '../lit/npl/npl-vos.edit.js';
import '../lit/sem-audiences.edit.js';
import '../lit/sem-browser.edit.js';
import '../lit/sem-chat.edit.js';
import '../lit/sem-chronology.edit.js';
import '../lit/sem-code.edit.js';
import '../lit/sem-data-join.edit.js';
import '../lit/sem-data-query.edit.js';
import '../lit/sem-data-source.edit.js';
import '../lit/sem-data-visualizer.edit.js';
import '../lit/sem-detail.edit.js';
import '../lit/sem-details.edit.js';
import '../lit/sem-enhanced-document.edit.js';
import '../lit/sem-event.edit.js';
import '../lit/sem-fact.edit.js';
import '../lit/sem-facts.edit.js';
import '../lit/sem-md.edit.js';
import '../lit/sem-note.edit.js';
import '../lit/sem-option.edit.js';
import '../lit/sem-procedure.edit.js';
import '../lit/sem-profile.edit.js';
import '../lit/sem-progress.edit.js';
import '../lit/sem-properties.edit.js';
import '../lit/sem-property.edit.js';
import '../lit/sem-question.edit.js';
import '../lit/sem-reader.edit.js';
import '../lit/sem-reference.edit.js';
import '../lit/sem-references.edit.js';
import '../lit/sem-reveal.edit.js';
import '../lit/sem-source.edit.js';
import '../lit/sem-step.edit.js';
import '../lit/sem-table.edit.js';
import '../lit/sem-view.edit.js';
import '../lit/sem-views.edit.js';


// ── seams ──────────────────────────────────────────────────────────────────────

setModelFactory((source) => createDocument(source));
setTemplateCompiler((xml, doc) => buildFromXml(doc, xml));
setCanvasProjector(reconcilingProjector);
setDescriptorLookup((tag) => getDescriptor(tag));
setDefaultSchemaProvider(schemaProviderFromLoader());
setDefaultDescriptorView(descriptorViewFromRegistry());
wireDnD();

// ── the public API (§9.2 + the document factory) ──────────────────────────────

/** Shell-aware claim: bind to the surrounding sem-editor's context when the
 *  element IS a model node of that editor; shell-less otherwise. */
function claimFor(el: SemElementLike): void {
  const host = el.closest?.('sem-editor') as SemEditor | null;
  if (host !== null && host.ctx !== null) {
    const ctx = host.ctx;
    // Runtime chrome (toolbar, outline, code pane, + zones) is never a binding.
    if (el.closest('[data-sem-chrome]') !== null) return;
    const stamp = el.getAttribute('data-sem-edit-node');
    if (stamp === null || ctx.doc.node(stamp) === undefined) return;
    attachEditor(el, ctx);
    return;
  }
  claimShellLess(el);
}

const api = {
  claim: claimFor,
  claimPending(): void {
    for (const el of drainPending()) claimFor(el);
  },
  /** Document factory — hosts and tests open documents through the same
   *  parser the editor itself uses (§9.2's createDocument door). */
  createDocument: (source: string): EditorDocument => modelCreateDocument(source),
  /** Parse verdicts for host-side pre-flight (structured issues, no throw). */
  tryParse: (source: string): ParseResult => modelTryParse(source),
  version: '0.1.0',
};

// Direct assignment covers module consumers (vitest imports this file
// directly). In the BUILT iife, vite re-assigns `SemTextEditor` to the
// export namespace (same keys as `api` — see the exports below), matching
// how the core bundle exposes `SemText`.
(globalThis as { SemTextEditor?: typeof api }).SemTextEditor = api;

// ── per-document re-wiring (§9.2) ─────────────────────────────────────────────
// openDocument builds a NEW EditorContext and emits `sem-edit-open` after the
// first projection; hooks / insert roads / io / the code host / controller
// attaches must re-run against it. One live wiring per editor element.

const wiringMap = new WeakMap<SemEditor, { detach(): void }>();

document.addEventListener(
  'sem-edit-open',
  ((event: Event) => {
    const ed = event.target;
    if (ed === null || typeof ed !== 'object' || !('ctx' in ed)) return;
    const editor = ed as SemEditor;
    const ctx = editor.ctx;
    if (ctx === null) return;
    wiringMap.get(editor)?.detach();
    wiringMap.set(editor, wireDocument(editor, ctx));
  }) as EventListener,
);

// Elements queued before the bundle finished loading (§4.1).
api.claimPending();

const { claim, claimPending, createDocument, tryParse, version } = api;
export { claim, claimPending, createDocument, tryParse, version };
