/**
 * Editor schema service — public surface.
 *
 * Consumers (controller/shell lanes) import from here:
 *   loadSchema / getTag / canonicalTagName / editableAttrsOf / companionsOf
 *   registerDescriptor / getDescriptor / hasHandDescriptor
 *   validateElement / validateTree
 *   widgetForAttr / fieldSpecForAttr / attributeForm
 *
 * Descriptor modules themselves import `registerDescriptor` directly (the
 * registration must stay side-effect-shaped even if this barrel is
 * tree-shaken).
 */

export {
  GLOBAL_ATTR_NAMES,
  SEM_CHAT_SPEC,
  canonicalTagName,
  companionsOf,
  editableAttrsOf,
  getTag,
  loadSchema,
} from './load-schema.js';
export { registerDescriptor } from './registry.js';
export { attributesOnlyDescriptor } from './fallback.js';
export { getDescriptor, hasHandDescriptor, handDescriptors, resetDescriptorsForTests } from './registry.js';
export { validateElement, validateTree } from './validator.js';
export { attributeForm, fieldSpecForAttr, widgetForAttr } from './property-form.js';
export type {
  AdvancedAttr,
  AttributeForm,
  EditBucket,
  EditDescriptor,
  ElementSchema,
  FieldSpec,
  FieldWidget,
  ItemListSpec,
  JsonItemsSpec,
  LinkField,
  RegionMap,
  RegionMapEntry,
  SchemaAttrSpec,
  SchemaChildSpec,
  SchemaTagSpec,
  TemplateSnippet,
  TextSlot,
  ValidationIssue,
  WizardField,
  WizardSpec,
  WizardStep,
} from './types.js';
