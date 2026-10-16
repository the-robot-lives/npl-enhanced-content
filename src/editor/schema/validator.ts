/**
 * Editor schema service — validator.
 *
 * Schema conformance checks over the MODEL tree (never the rendered DOM).
 * Warnings only: validation NEVER blocks an edit (EDITOR.md §3.1) — issues
 * surface in the outline and property modal as advisory chips. Parse-level
 * problems belong to the model's ParseIssues, not here.
 *
 * Both authoring forms validate: the element form (`sem-note`) and the
 * class alias (`<div class="sem-note">`). A data-mirror of a canonical
 * attribute (`data-variant` when `variant` exists) earns an alias-attr
 * hint — the editor authors the canonical spelling, and the element
 * regenerates its own mirrors on re-render.
 */

import type {
  AttrNode,
  DocumentNode,
  EditorNode,
  ElementNode,
  NodeId,
} from '../model/types.js';
import { editableAttrsOf, getTag, loadSchema } from './load-schema.js';
import type {
  ElementSchema,
  SchemaTagSpec,
  ValidationCode,
  ValidationIssue,
} from './types.js';

function warn(
  code: ValidationCode,
  tag: string,
  nodeId: NodeId,
  message: string,
  attr?: string,
  hint?: string,
): ValidationIssue {
  return { code, severity: 'warning', tag, nodeId, message, attr, hint };
}

function attrNamed(el: ElementNode, name: string): AttrNode | undefined {
  return el.attrs.find((a) => a.name.toLowerCase() === name);
}

/** Attributes the validator never flags as unknown. */
function isExemptAttr(name: string): boolean {
  return name === 'class' || name === 'style' || name.startsWith('aria-');
}

const VOCAB_PREFIX = /^(sem|npl)-/;

/** Which vocabulary spec an element renders as, if any: the element form
 *  first, then a class-alias token (a div whose class carries sem-note). */
function resolveSpec(el: ElementNode, schema: ElementSchema): SchemaTagSpec | null {
  const byTagName = schema.byName.get(el.name.toLowerCase());
  if (byTagName) return byTagName;
  const classAttr = attrNamed(el, 'class');
  if (!classAttr || classAttr.value === null) return null;
  for (const token of classAttr.value.split(/\s+/)) {
    if (!token) continue;
    const spec = getTag(token.startsWith('.') ? token : '.' + token);
    if (spec) return spec;
  }
  return null;
}

/** Does the element look like vocabulary at all (sem- or npl- element form,
 *  or such a class token)? Separates "unknown tag" from plain HTML. */
function looksLikeVocabulary(el: ElementNode): boolean {
  if (VOCAB_PREFIX.test(el.name.toLowerCase())) return true;
  const classAttr = attrNamed(el, 'class');
  if (classAttr?.value === undefined || classAttr.value === null) return false;
  return classAttr.value.split(/\s+/).some((t) => VOCAB_PREFIX.test(t));
}

/** Attribute conformance for one element whose spec is known. */
function validateAttrs(el: ElementNode, spec: SchemaTagSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const editable = editableAttrsOf(spec);
  const editableNames = new Set(editable.map((a) => a.name.toLowerCase()));

  for (const attr of el.attrs) {
    const name = attr.name.toLowerCase();
    if (isExemptAttr(name)) continue;
    if (name.startsWith('data-')) {
      // data mirrors: flag only when the canonical spelling exists on the
      // tag AND the canonical attribute itself is not also authored
      const canonical = name.slice(5);
      if (editableNames.has(canonical) && !attrNamed(el, canonical)) {
        issues.push(
          warn(
            'alias-attr',
            spec.name,
            el.id,
            `data mirror "${attr.name}" stands in for "${canonical}"`,
            attr.name,
            `author the canonical spelling: ${canonical}="${attr.value ?? ''}"`,
          ),
        );
      }
      continue; // other data names are author hooks — never flagged
    }
    if (!editableNames.has(name)) {
      issues.push(
        warn('unknown-attr', spec.name, el.id, `unknown attribute "${attr.name}" on ${spec.name}`, attr.name),
      );
    }
  }

  for (const attrSpec of editable) {
    const present = attrNamed(el, attrSpec.name);
    if (attrSpec.required && !present) {
      issues.push(
        warn('missing-required', spec.name, el.id, `${spec.name} requires "${attrSpec.name}"`, attrSpec.name),
      );
      continue;
    }
    if (attrSpec.allowedValues.length > 0 && present) {
      const value = present.value;
      if (value === null || !attrSpec.allowedValues.includes(value)) {
        issues.push(
          warn(
            'bad-enum-value',
            spec.name,
            el.id,
            `value ${value === null ? '(bare)' : `"${value}"`} is not one of ${attrSpec.allowedValues.join(' | ')}`,
            attrSpec.name,
            attrSpec.default ? `default: ${attrSpec.default}` : undefined,
          ),
        );
      }
    }
  }
  return issues;
}

/** Validate one element: tag identity, attribute conformance. Companion
 *  placement needs the parent, so that check only runs in the tree walk
 *  (validateTree). */
export function validateElement(el: ElementNode, schema: ElementSchema = loadSchema()): ValidationIssue[] {
  const spec = resolveSpec(el, schema);
  if (!spec) {
    if (looksLikeVocabulary(el)) {
      return [warn('unknown-tag', el.name.toLowerCase(), el.id, `"${el.name}" is not in the schema`)];
    }
    return [];
  }
  return validateAttrs(el, spec);
}

function walk(node: EditorNode, schema: ElementSchema, parentSpec: SchemaTagSpec | null): ValidationIssue[] {
  if (node.kind !== 'element') return [];
  const el: ElementNode = node;
  const spec = resolveSpec(el, schema);
  const issues: ValidationIssue[] = [];

  if (spec && spec.optionsIn) {
    const parentIsContainer = parentSpec !== null && parentSpec.name.toLowerCase() === spec.optionsIn;
    if (!parentIsContainer) {
      issues.push(
        warn(
          'stray-companion',
          spec.name,
          el.id,
          `${spec.name} belongs inside <${spec.optionsIn}>`,
          undefined,
          `nest it in <${spec.optionsIn}>`,
        ),
      );
    }
  }

  if (spec) issues.push(...validateAttrs(el, spec));
  else if (looksLikeVocabulary(el)) {
    issues.push(warn('unknown-tag', el.name.toLowerCase(), el.id, `"${el.name}" is not in the schema`));
  }

  for (const child of el.children) issues.push(...walk(child, schema, spec));
  return issues;
}

/** Deep-validate a model tree (the document root or any subtree). */
export function validateTree(root: DocumentNode | EditorNode, schema: ElementSchema = loadSchema()): ValidationIssue[] {
  if (root.kind === 'document') {
    const issues: ValidationIssue[] = [];
    for (const child of root.children) issues.push(...walk(child, schema, null));
    return issues;
  }
  return walk(root, schema, null);
}
