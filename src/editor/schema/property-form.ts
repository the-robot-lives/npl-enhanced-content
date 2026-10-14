/**
 * Editor schema service — the attribute-form (property-modal) engine.
 *
 * Computes one modal field per schema attribute from its spec (type, enum,
 * required, default — EDITOR.md §5.4):
 *   enum (allowedValues)          → select, with a "(custom)" entry when
 *                                   the node carries an off-enum value
 *   type boolean                  → checkbox (bare-attribute spelling)
 *   type integer|number           → number
 *   anything else                 → text
 *
 * Hand-authored attributes the schema does not know land in `advanced`
 * (visible and removable, never silently dropped). The engine is pure:
 * it returns specs; the shell renders them.
 */

import type { AttrNode } from '../model/types.js';
import { humanizeTag } from './fallback.js';
import { editableAttrsOf, getTag, loadSchema } from './load-schema.js';
import type {
  AdvancedAttr,
  AttributeForm,
  ElementSchema,
  FieldSpec,
  FieldWidget,
  SchemaAttrSpec,
} from './types.js';

/** Widget for a schema attribute, by the §5.4 rules. */
export function widgetForAttr(spec: SchemaAttrSpec): FieldWidget {
  if (spec.allowedValues.length > 0) return 'select';
  const type = spec.type.toLowerCase();
  if (type === 'boolean') return 'checkbox';
  if (/^(integer|number|float|numeric)/.test(type)) return 'number';
  return 'text';
}

/** Field spec for one schema attribute against the node's current value. */
export function fieldSpecForAttr(
  spec: SchemaAttrSpec,
  authored?: { present: boolean; value: string | null },
): FieldSpec {
  const widget = widgetForAttr(spec);
  const present = authored?.present ?? false;
  const current = present ? (authored?.value ?? null) : null;

  let options: readonly string[] = [];
  let customValue: string | null = null;
  if (widget === 'select') {
    const list = [...spec.allowedValues];
    if (current !== null && !list.includes(current)) {
      list.push(`${current} (custom)`);
      customValue = current;
    }
    options = list;
  }

  return {
    attr: spec.name,
    label: spec.name,
    widget,
    required: spec.required,
    options,
    customValue,
    current,
    present,
    bare: widget === 'checkbox',
    placeholder: null,
    default: spec.default,
    description: spec.description,
    global: spec.global,
  };
}

/**
 * The full property-modal form for a tag: schema fields in schema order
 * (globals last — the loader appends them), then the advanced section with
 * every authored attribute the schema does not know. `class` is styling,
 * not data — it never appears as an advanced field.
 */
/** The form reads attributes from an element node, or accepts a bare attr
 *  list (callers often have just the attrs in hand). */
type AttrSource = { readonly attrs: readonly AttrNode[] } | readonly AttrNode[];

function attrsOf(node?: AttrSource): readonly AttrNode[] {
  if (!node) return [];
  return 'attrs' in node ? node.attrs : (node as readonly AttrNode[]);
}

export function attributeForm(tag: string, node?: AttrSource, schema: ElementSchema = loadSchema()): AttributeForm {
  const attrs = attrsOf(node);
  const spec = getTag(tag);
  if (!spec) {
    return { tag, title: tag, fields: [], advanced: advancedOf(attrs) };
  }

  const fields: FieldSpec[] = editableAttrsOf(spec).map((attrSpec) => {
    const authored = attrs.find((a) => a.name.toLowerCase() === attrSpec.name.toLowerCase());
    return fieldSpecForAttr(
      attrSpec,
      authored ? { present: true, value: authored.value } : { present: false, value: null },
    );
  });

  return { tag: spec.name, title: humanizeTag(spec.name), fields, advanced: advancedOf(attrs, fields) };
}

function advancedOf(attrs: readonly AttrNode[], fields?: readonly FieldSpec[]): AdvancedAttr[] {
  const known = new Set((fields ?? []).map((f) => f.attr.toLowerCase()));
  const advanced: AdvancedAttr[] = [];
  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    if (known.has(name) || name === 'class') continue;
    advanced.push({ name: attr.name, value: attr.value });
  }
  return advanced;
}
