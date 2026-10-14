/**
 * insert/compile — snippet → model node (EDITOR.md §3.3, §5.5 road 4).
 *
 * Templates are authoring-form XHTML with TextMate-style stops
 * (`${1:placeholder}`, `${2|a,b|}`). Insertion parses them through the
 * MODEL parser and rebuilds through the document factories — never
 * `insertAdjacentHTML` (§8) — so fresh ids come from the document counter
 * and the adoption rule holds.
 *
 * Wizard binding — POSITIONAL BY ORDINAL, per the desc-lane convention
 * (npl-a + recall ship it; this lane adopted it): stop `${i}` of the FINAL
 * step's template binds to the i-th FIELD of the wizard (steps
 * concatenated in order). Placeholder text is a human label, not a key.
 * Choice stops (`${n|a,b|}`) take the bound field's value (validated
 * against `options` at the step); an UNBOUND choice stop falls to its
 * first option. A stop with no field keeps its placeholder text. An empty
 * non-required field substitutes an empty string (`attr=""` stays; the
 * property modal/validator warns, never blocks).
 *
 * Escaping is stop-position aware: a stop inside an attribute value
 * (`attr="${1:field}"`) escapes with `escapeAttr`, a stop in text content
 * with `escapeText`. Substitution is single-pass over sentinel markers — a
 * typed value containing `${…}` is never re-scanned as grammar.
 */

import type { EditorDocument, EditorNode, NodeId } from '../model/types.js';
import { escapeAttr, escapeText } from '../model/entities.js';
import { parse } from '../model/document.js';
import { currentIdCounter } from '../model/parse.js';
import { rebuildSubtree } from '../safety/sanitize.js';
import { getTemplateCompiler } from '../shell/context.js';
import { STOP_SCAN, stripStops } from '../templates/stops.js';
import type { WizardField } from '../schema/types.js';

const SENTINEL_SCAN = /\u0000(\d+)\u0000/g;

/**
 * Substitute wizard field values into a template's stops by ORDINAL:
 * stop `${i}` ↔ fields[i-1] (steps concatenated in order). `values` is
 * keyed by field name. Ordinal binding (not source order) so templates may
 * place a later field's stop before an earlier one; the shipped
 * descriptors number 1..n sequentially, where the two coincide.
 */
export function interpolateTemplate(
  xml: string,
  fields: readonly WizardField[],
  values: Readonly<Record<string, string>>,
): string {
  const payloads: string[] = [];
  const marked = xml.replace(STOP_SCAN, (whole: string, ...rest: unknown[]) => {
    const groups = (rest[rest.length - 1] ?? {}) as Record<string, string | undefined>;
    const ordinal = Number(groups.n ?? groups.c ?? groups.b ?? 0);
    const field = fields[ordinal - 1] ?? null;
    const value = field !== null ? values[field.name] : undefined;
    let payload: string;
    if (groups.options !== undefined) {
      // choice stop: bound non-empty value wins; unbound falls to first option
      payload =
        value !== undefined && value !== '' ? value : (groups.options.split(',')[0] ?? '');
    } else if (groups.n !== undefined && field === null) {
      return groups.text ?? whole; // no field for this stop — placeholder stays
    } else {
      payload = value ?? '';
    }
    payloads.push(payload);
    return `\u0000${payloads.length - 1}\u0000`;
  });
  return marked.replace(SENTINEL_SCAN, (whole, index: string) => {
    const before = marked.slice(0, marked.indexOf(whole));
    const tail = before.slice(-2);
    const value = payloads[Number(index)] ?? '';
    // attribute-value stops escape quotes (with the authored quote char);
    // text stops do not
    if (tail.endsWith('="')) return escapeAttr(value, '"');
    if (tail.endsWith("='")) return escapeAttr(value, "'");
    return escapeText(value);
  });
}

/**
 * Boolean wizard fields follow the bare-attribute convention (types.ts:
 * `collapsed`): a template authors `attr="${1:field}"`; a CHECKED field
 * becomes the bare attribute, an UNCHECKED one removes the attribute.
 * Fields not bound to a stop are unaffected (validation only).
 */
export function applyBooleanFields(
  xml: string,
  values: Readonly<Record<string, string>>,
  booleanNames: readonly string[],
): string {
  let out = xml;
  for (const name of booleanNames) {
    if (!(name in values)) continue;
    const on = values[name] !== '' && values[name] !== 'false';
    const drop = new RegExp(`\\s${name}="[^"]*"`, 'g');
    const bare = new RegExp(`\\s${name}=""`, 'g');
    if (on) {
      out = out.replace(bare, ` ${name}`); // explicit empty → bare attribute
      out = out.replace(new RegExp(`\\s${name}="true"`, 'g'), ` ${name}`);
    } else {
      out = out.replace(drop, '');
      out = out.replace(new RegExp(`\\s${name}(?=[\\s/>])`, 'g'), '');
    }
  }
  return out;
}

/**
 * Build a detached node from a RAW template (stops still in). Strips the
 * stops via the same positional scan (fields=[], so choice stops fall to
 * their first option and named stops keep placeholder text), parses through
 * the model, rebuilds through the doc factories, then re-clones with
 * collision-free ids. The seam wins when integrate wires one.
 *
 * NOTE: deliberately NOT `buildFromXml`/`stripTemplateStops` — the
 * controller's stripper mangles choice stops (desc-npl-b report); the
 * controller lane is fixing it. This path is self-contained.
 */
export function compileSnippet(xml: string, doc: EditorDocument): EditorNode | null {
  const seam = getTemplateCompiler();
  if (seam !== null) {
    const built = seam(xml, doc);
    return built === null ? null : cloneFresh(doc, built, { v: currentIdCounter() });
  }
  return compileRendered(interpolateTemplate(xml, [], {}), doc);
}

/**
 * Build a detached node from ALREADY-INTERPOLATED source (wizard Finish).
 * No stop-stripping here: a field VALUE may legitimately contain `${…}`
 * text, and a second scan would corrupt it. Ids still collision-proofed.
 */
export function compileRendered(renderedXml: string, doc: EditorDocument): EditorNode | null {
  const parsed = parse(renderedXml);
  const first = parsed.root.children.find((c) => c.kind === 'element');
  if (first === undefined) return null;
  const rebuilt = rebuildSubtree(doc, first);
  return cloneFresh(doc, rebuilt, { v: currentIdCounter() });
}

/** An id no node of `doc` (not even the root) answers to. */
function freshId(doc: EditorDocument, floor: { v: number }): NodeId {
  for (;;) {
    const id = `n${++floor.v}` as NodeId;
    if (id === doc.root.id) continue;
    if (doc.node(id) === undefined) return id;
  }
}

function cloneFresh(doc: EditorDocument, node: EditorNode, floor: { v: number }): EditorNode {
  const id = freshId(doc, floor);
  if (node.kind !== 'element') {
    return { ...node, id, parentId: null, range: { start: 0, end: 0 } };
  }
  const children = node.children.map((child) => {
    const clone = cloneFresh(doc, child, floor);
    clone.parentId = id;
    return clone;
  });
  return {
    ...node,
    id,
    parentId: null,
    children,
    attrs: node.attrs.map((a) => ({ ...a, range: { start: 0, end: 0 } })),
    range: { start: 0, end: 0 },
  };
}

/** Parse + serialize already-rendered source (best effort; malformed input
 *  serializes whatever the recovery parser produced). */
export function serializePreview(source: string): string {
  return parse(source).serialize();
}

/** Serialized preview of a template with field values applied. */
export function previewSource(
  xml: string,
  fields: readonly WizardField[],
  values: Readonly<Record<string, string>>,
): string {
  return serializePreview(interpolateTemplate(xml, fields, values));
}
