/**
 * insert/compile — snippet → model node (EDITOR.md §3.3, §5.5 road 4).
 *
 * Templates are authoring-form XHTML with TextMate-style stops
 * (`${1:placeholder}`, `${2|a,b|}`). Insertion parses them through the
 * MODEL parser and rebuilds through the document factories — never
 * `insertAdjacentHTML` (§8) — so fresh ids come from the document counter
 * and the adoption rule holds.
 *
 * Wizard binding (pinned here; the generic stepper is this lane's):
 * a wizard FIELD binds to the stop whose PLACEHOLDER TEXT equals the field
 * name (`${1:caption}` ← field `caption`). Select and boolean fields use a
 * text stop too — their validation comes from `WizardField.options` /
 * `required`. Stops without a matching field keep their placeholder text.
 * Choice stops (`${n|a,b|}`) are display-only in v1 and fall back to their
 * first option at compile, matching the controller's strip rule.
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
import { buildFromXml } from '../controller/actions.js';

/** One combined scan so substituted values are never re-parsed as stops. */
const STOP_SCAN = /\$\{\d+:([^}]*)\}|\$\{\d+\|([^|}]*)\|[^}]*\}|\$\{\d+\}/g;

const SENTINEL_SCAN = /\u0000(\d+)\u0000/g;

/**
 * Substitute wizard field values into a template's named stops.
 * Unmatched named stops keep their placeholder; choice/bare stops fall to
 * their first option / nothing (compiled away later).
 */
export function interpolateTemplate(xml: string, values: Readonly<Record<string, string>>): string {
  const payloads: string[] = [];
  const marked = xml.replace(STOP_SCAN, (_whole, named?: string, choice?: string) => {
    if (named !== undefined) {
      const value = values[named];
      if (value !== undefined) {
        payloads.push(value);
        return `\u0000${payloads.length - 1}\u0000`;
      }
      return named; // unbound stop keeps its placeholder text
    }
    if (choice !== undefined && choice !== '') return choice.split(',')[0] ?? '';
    return '';
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
 * stops (controller semantics), parses through the model, rebuilds through
 * the doc factories, then re-clones with collision-free ids.
 */
export function compileSnippet(xml: string, doc: EditorDocument): EditorNode | null {
  const seam = getTemplateCompiler();
  const built = seam !== null ? seam(xml, doc) : buildFromXml(doc, xml);
  if (built === null) return null;
  return cloneFresh(doc, built, { v: currentIdCounter() });
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

/** Serialized preview of a template with values applied. */
export function previewSource(xml: string, values: Readonly<Record<string, string>>): string {
  return serializePreview(interpolateTemplate(xml, values));
}
