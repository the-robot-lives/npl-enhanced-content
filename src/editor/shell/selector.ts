/**
 * selector.ts — model-side matching for descriptor selectors (EDITOR.md
 * §3.3/§5.4). Descriptors speak DOM (`:scope > sem-fact`, `:scope > .sem-fact`,
 * `:scope > script[type="application/json"]`); the property modal matches the
 * same selectors against *model* children, where there is no DOM.
 *
 * Supported grammar (the shapes descriptors use, per EDITOR.md §3.3):
 *
 *   `:scope > tag`            element-form child (`sem-fact`, `tr`, …)
 *   `:scope > .class`         class-alias child (class attribute token)
 *   `:scope > tag[attr="v"]`  with one attribute qualifier
 *   `sel, sel`                any of the alternatives
 *
 * Anything else (descendant combinators, pseudo-classes, sibling selectors)
 * never matches and reports a warning through `selectorSupports` — the modal
 * renders such lists as "not editable here" rather than guessing.
 */

import type { EditorNode, ElementNode } from '../model/types.js';

interface SimpleSelector {
  tag: string | null; // null for the `.class`-only form
  attrName: string | null;
  attrValue: string | null;
  className: string | null;
}

/** Parse one simple selector; `null` when unsupported. */
function parseSimple(raw: string): SimpleSelector | null {
  let s = raw.trim();
  if (!s.startsWith(':scope')) return null;
  s = s.slice(':scope'.length).trim();
  if (!s.startsWith('>')) return null;
  s = s.slice(1).trim();

  const out: SimpleSelector = { tag: null, attrName: null, attrValue: null, className: null };

  // tag (or nothing) …
  const tagMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(s);
  if (tagMatch) {
    out.tag = tagMatch[0].toLowerCase();
    s = s.slice(tagMatch[0].length);
  }
  // … optional .class …
  const classMatch = /^\.([A-Za-z][A-Za-z0-9_-]*)/.exec(s);
  if (classMatch) {
    out.className = classMatch[1];
    s = s.slice(classMatch[0].length);
  }
  // … optional [attr="value"] (or bare [attr]).
  const attrMatch = /^\[([A-Za-z][A-Za-z0-9_-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/.exec(s);
  if (attrMatch) {
    out.attrName = attrMatch[1].toLowerCase();
    out.attrValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? null;
    s = s.slice(attrMatch[0].length);
  }
  return s.trim() === '' ? out : null;
}

/** Expand a top-level `:is(A, B)` group into comma alternatives, carrying
 *  the combinator prefix into each alternative (`sel('fact')` is
 *  `:scope > :is(sem-fact, .sem-fact)`). The DOM side has querySelectorAll
 *  for `:is()`; the model-side matcher only needs the descriptor shapes
 *  (§3.3) and `:is` never nests in the vocabulary. */
function expandIsGroups(selector: string): string {
  const m = /(^|,)\s*([^,]*?):is\(([^()]*)\)/.exec(selector);
  if (m === null) return selector;
  const prefix = m[2].trim();
  const alts = m[3]
    .split(',')
    .map((a) => prefix + a.trim())
    .filter((a) => a !== prefix);
  return selector.slice(0, m.index) + m[1] + alts.join(', ') + selector.slice(m.index + m[0].length);
}

/** Does the selector use only the grammar above? (UI gates on this.) */
export function selectorSupports(selector: string): boolean {
  return expandIsGroups(selector)
    .split(',')
    .every((alt) => alt.trim() === '' || parseSimple(alt) !== null);
}

function classTokens(node: ElementNode): string[] {
  const attr = node.attrs.find((a) => a.name.toLowerCase() === 'class');
  const value = attr?.value ?? '';
  return value ? value.split(/\s+/).filter(Boolean) : [];
}

function matchesSimple(node: EditorNode, sel: SimpleSelector): boolean {
  if (node.kind !== 'element') return false;
  if (sel.tag !== null && node.name.toLowerCase() !== sel.tag) return false;
  if (sel.className !== null && !classTokens(node).includes(sel.className)) return false;
  if (sel.attrName !== null) {
    const attr = node.attrs.find((a) => a.name.toLowerCase() === sel.attrName);
    if (!attr) return false;
    if (sel.attrValue !== null && (attr.value ?? '') !== sel.attrValue) return false;
  }
  return true;
}

/**
 * Match one model child against a descriptor child selector.
 * Unknown grammar matches nothing (call `selectorSupports` first to warn).
 */
export function childMatches(child: EditorNode, selector: string): boolean {
  return expandIsGroups(selector)
    .split(',')
    .map((alt) => parseSimple(alt))
    .some((sel) => sel !== null && matchesSimple(child, sel));
}

/** Filter a children array through a descriptor child selector. */
export function matchChildren(children: readonly EditorNode[], selector: string): ElementNode[] {
  return children.filter((c): c is ElementNode => childMatches(c, selector));
}
