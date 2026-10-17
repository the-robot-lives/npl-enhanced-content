/**
 * sem-site-tree — structured site map container (spec/schema/sem-site-tree.md).
 *
 * Authored form: bare `<node path label kind>` children, nested. JS-off:
 * a CSS-rendered nested list (guides, counters, attr() labels) — the
 * authored DOM is the record. JS-on: the shared TreeHost engine
 * (src/lit/sem-tree.ts) builds the collapse/filter/find chrome, gated on
 * `[data-sem-upgraded]`.
 *
 * Thin registration on purpose: everything it does lives in the shared
 * engine chunk; this file exists so the lazy manifest maps
 * `sem-site-tree` → chunks/sem-site-tree.js.
 */

import { SemElement } from './base.js';
import { TreeHost } from './sem-tree.js';

export { parseStructuredTree, parseTreeText, parseTreeContainer, flattenTree, filterTree, findInTree, ancestorsOf } from './sem-tree.js';

export class SemSiteTree extends TreeHost {}

SemElement.register('sem-site-tree', SemSiteTree); // literal: the build's scanner keys on the string
