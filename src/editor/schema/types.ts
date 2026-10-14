/**
 * Editor schema service — types.
 *
 * This module owns the schema-side contract of the editor: the normalized
 * shape of `elements.json` (load-schema.ts) and the edit-descriptor format
 * (EDITOR.md §3.3) that element files register through the registry.
 *
 * Descriptors are DATA: they declare what is editable about a tag (text
 * slots, item lists, link fields, insert templates, wizards) and how the
 * element re-establishes its runtime chrome after a model-driven re-render.
 * They never touch the DOM directly; the controller consumes them.
 */

import type { NodeId } from '../model/types.js';

/** `SemElement` is imported type-only: the schema service stays runtime-free
 *  of Lit, so loading the schema costs nothing for readers (bundle rule). */
export type SemElementLike = import('../../lit/base.js').SemElement;

// ── Normalized schema (elements.json) ────────────────────────────────────────

/** One attribute as the editor edits it — normalized from elements.json
 *  (`required: null` → false, `type: ''` → '', `allowedValues` always an
 *  array). `global` marks catalog attributes (id/kind/tags/audience) that
 *  the loader appended rather than the tag declaring. */
export interface SchemaAttrSpec {
  name: string;
  required: boolean;
  type: string;
  allowedValues: readonly string[];
  default: string | null;
  description: string;
  global: boolean;
}

export interface SchemaChildSpec {
  name: string;
  note: string;
}

/** One tag of the vocabulary, normalized. `optionsIn` names the container
 *  whose item this tag is (companions: sem-fact → sem-facts, …); `null` for
 *  container/standalone tags. */
export interface SchemaTagSpec {
  name: string;
  family: 'sem' | 'npl';
  summary: string;
  description: string;
  attributes: readonly SchemaAttrSpec[];
  children: readonly SchemaChildSpec[];
  example: string;
  optionsIn: string | null;
}

export interface ElementSchema {
  specVersion: string;
  tags: readonly SchemaTagSpec[];
  /** Lowercase canonical name → spec. Class-alias spellings (`.sem-x`)
   *  resolve through `getTag`. */
  byName: ReadonlyMap<string, SchemaTagSpec>;
}

// ── Edit descriptors (EDITOR.md §3.3) ────────────────────────────────────────

/** Reference bucket — inserter grouping and Phase-2 descriptor lanes. */
export type EditBucket =
  | 'document'
  | 'prose'
  | 'disclosure'
  | 'views'
  | 'data'
  | 'code'
  | 'npl-a'
  | 'npl-b';

/** A slot whose text the user edits inline (contenteditable, plaintext).
 *  `selector` matches AUTHORED child parts and MUST start with `:scope >`;
 *  the controller resolves it at runtime against the element's light DOM.
 *  `escape` is pinned to `'entities'` in v1: committed values are written
 *  decoded into the model and re-escaped on emit. */
export interface TextSlot {
  selector: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  escape: 'entities';
}

/** Repeatable children (the +/− glyphs). `childSelector` MUST start with
 *  `:scope >`. `template` is the snippet an insertion rebuilds through the
 *  document factories (fresh ids — the adoption rule, EDITOR.md §2.3). */
export interface ItemListSpec {
  childSelector: string;
  label: string;
  template: TemplateSnippet;
  max?: number;
}

/** A URL-ish edit field: an attribute of the element, or a slot whose text
 *  is a URL. URL values pass the §8 safety rule before any op is written. */
export interface LinkField {
  attr?: string;
  slotSelector?: string;
  label: string;
}

/** sem-chat's `<script type="application/json">` payload. The model parses
 *  script content as ONE raw text node — edits are byte-exact `setText`s. */
export interface JsonItemsSpec {
  selector: string;
  label: string;
  schemaHint: string;
}

/** Insert snippet. `xml` is authoring-form XHTML with TextMate-style stops:
 *  `${1:placeholder}` for text, `${2|a,b|}` for a choice. The controller
 *  turns the first stop into the post-insert caret. */
export interface TemplateSnippet {
  id: string;
  label: string;
  group?: string;
  xml: string;
}

export interface WizardField {
  name: string;
  label: string;
  type: 'text' | 'url' | 'select' | 'textarea' | 'number' | 'boolean';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface WizardStep {
  title: string;
  fields: WizardField[];
  template: TemplateSnippet;
}

/** One rendered-DOM region → model node id. `nodeId` is either a fixed id or
 *  a positional resolver `(el, index)`; the controller evaluates entries in
 *  order against the rendered element, first hit wins. Needed wherever the
 *  element regroups or clones authored content (sem-note's body wrap,
 *  npl-mood's detail panel). */
export interface RegionMapEntry {
  selector: string;
  nodeId: NodeId | ((el: SemElementLike, index: number) => NodeId | null);
}

export type RegionMap = RegionMapEntry[];

/** The per-element edit contract (EDITOR.md §3.3). Registered by
 *  side-effect from `src/lit/<tag>.edit.ts`; every tag not hand-registered
 *  inherits the attributes-only fallback (fallback.ts). */
export interface EditDescriptor {
  tag: string;
  title: string;
  bucket: EditBucket;
  summary?: string;
  textSlots?: TextSlot[];
  itemList?: ItemListSpec;
  linkFields?: LinkField[];
  jsonItems?: JsonItemsSpec;
  templates?: TemplateSnippet[];
  wizard?: WizardSpec;
  regions?(el: SemElementLike): RegionMap | null;
  rerender?(el: SemElementLike): void;
  /** Tag accepted as this element's item container (companion direction). */
  containerOf?: string;
}

// WizardSpec is a named alias so lanes can reference the step list shape.
export interface WizardSpec {
  steps: WizardStep[];
}

// ── Property-modal field specs (attribute-form engine) ───────────────────────

export type FieldWidget = 'text' | 'textarea' | 'number' | 'checkbox' | 'select';

/** One field of the property modal, computed from the schema attribute spec
 *  (type/enum/required/default) plus the node's current authored value. */
export interface FieldSpec {
  /** Canonical attribute name (authoring spelling). */
  attr: string;
  label: string;
  widget: FieldWidget;
  required: boolean;
  /** select only: the enum, plus a `"<value> (custom)"` entry when the node
   *  carries a hand-authored value outside the enum (§5.4 — visible, not
   *  destroyed). */
  options: readonly string[];
  /** The node's current value when it is not in `options`; null otherwise. */
  customValue: string | null;
  /** The node's authored value, decoded; null when the attribute is absent
   *  or authored bare (value null). */
  current: string | null;
  /** The attribute is present on the node (bare booleans: present with a
   *  null value — `collapsed`). */
  present: boolean;
  /** boolean fields: the authored spelling is the bare attribute
   *  (`collapsed`), checked ⇔ present. */
  bare: boolean;
  placeholder: string | null;
  default: string | null;
  description: string;
  /** Global-catalog attribute (id/kind/tags/audience) — modal groups last. */
  global: boolean;
}

/** An attribute present on the node but unknown to the schema — parked in
 *  the modal's Advanced section (visible, removable, never silently
 *  dropped). */
export interface AdvancedAttr {
  name: string;
  value: string | null;
}

export interface AttributeForm {
  tag: string;
  title: string;
  fields: readonly FieldSpec[];
  advanced: readonly AdvancedAttr[];
}

// ── Validation ───────────────────────────────────────────────────────────────

export type ValidationCode =
  | 'unknown-tag'
  | 'unknown-attr'
  | 'missing-required'
  | 'bad-enum-value'
  | 'alias-attr'
  | 'stray-companion';

/** Schema conformance warnings. Validation NEVER blocks an edit: every
 *  issue is advisory (`severity: 'warning'`) and carries the node it
 *  refers to, so the shell can surface it in the outline/modal. */
export interface ValidationIssue {
  code: ValidationCode;
  severity: 'warning';
  tag: string;
  nodeId: NodeId;
  message: string;
  attr?: string;
  hint?: string;
}
