/**
 * Editor schema service — descriptor registry.
 *
 * Descriptor modules (`src/lit/<tag>.edit.ts`, `src/lit/npl/<tag>.edit.ts`)
 * are SIDE-EFFECT REGISTERING: importing one calls `registerDescriptor`.
 * Lookup falls back to the auto-generated attributes-only descriptor
 * (EDITOR.md §3.2 coverage rule) so every schema tag — plus sem-chat — is
 * editable with zero authored descriptor.
 *
 * Registration is last-wins per tag (a Phase 2 lane may refine a fallback
 * or another hand descriptor while iterating); malformed descriptors are a
 * programmer error and throw at registration time.
 */

import { attributesOnlyDescriptor } from './fallback.js';
import { getTag } from './load-schema.js';
import type { EditBucket, EditDescriptor } from './types.js';

const BUCKETS: readonly EditBucket[] = [
  'document',
  'prose',
  'disclosure',
  'views',
  'data',
  'sequence',
  'definitions',
  'recall',
  'code',
  'npl-a',
  'npl-b',
];

const hand = new Map<string, EditDescriptor>();
const fallbacks = new Map<string, EditDescriptor>();

function check(d: EditDescriptor): void {
  if (typeof d.tag !== 'string' || d.tag === '') {
    throw new TypeError('registerDescriptor: tag is required');
  }
  if (typeof d.title !== 'string' || d.title === '') {
    throw new TypeError(`registerDescriptor(${d.tag}): title is required`);
  }
  if (!BUCKETS.includes(d.bucket)) {
    throw new TypeError(`registerDescriptor(${d.tag}): unknown bucket "${d.bucket as string}"`);
  }
}

/** Register a hand-written descriptor. Re-registering a tag replaces the
 *  previous entry (last wins). Throws on malformed descriptors. */
export function registerDescriptor(d: EditDescriptor): void {
  check(d);
  hand.set(d.tag.toLowerCase(), d);
}

/** The descriptor for a tag reference — hand-written if one registered,
 *  else the cached attributes-only fallback. Accepts the element form,
 *  class alias, or bare sel() name (see canonicalTagName). Returns null
 *  only for names outside the schema entirely. */
export function getDescriptor(raw: string): EditDescriptor | null {
  const spec = getTag(raw);
  if (!spec) return null;
  const key = spec.name.toLowerCase();
  const registered = hand.get(key);
  if (registered) return registered;
  let fallback = fallbacks.get(key);
  if (!fallback) {
    fallback = attributesOnlyDescriptor(spec);
    fallbacks.set(key, fallback);
  }
  return fallback;
}

/** True when a hand-written descriptor is registered for the tag. */
export function hasHandDescriptor(raw: string): boolean {
  const spec = getTag(raw);
  return spec ? hand.has(spec.name.toLowerCase()) : false;
}

/** All hand-registered descriptors (registration order). */
export function handDescriptors(): readonly EditDescriptor[] {
  return [...hand.values()];
}

/** Test isolation: drop every registration and cached fallback. */
export function resetDescriptorsForTests(): void {
  hand.clear();
  fallbacks.clear();
}
