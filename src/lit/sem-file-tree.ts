/**
 * sem-file-tree — file listing container (spec/schema/sem-file-tree.md).
 *
 * Primary authored form: `<sem-file-tree mode="text">` wrapping an
 * indented (box-drawing or whitespace) tree inside a `<pre>` — that pre
 * IS the record; nothing is fabricated. JS-off it renders verbatim.
 * JS-on: the shared TreeHost engine (src/lit/sem-tree.ts) parses the
 * indentation to the same model the structured form uses and builds the
 * collapse/filter/find chrome over generated view rows, gated on
 * `[data-sem-upgraded]`. A structured `<node>` authoring form is also
 * accepted (dispatched on content).
 *
 * Thin registration on purpose: everything it does lives in the shared
 * engine chunk; this file exists so the lazy manifest maps
 * `sem-file-tree` → chunks/sem-file-tree.js.
 */

import { SemElement } from './base.js';
import { TreeHost } from './sem-tree.js';

export class SemFileTree extends TreeHost {}

SemElement.register('sem-file-tree', SemFileTree); // literal: the build's scanner keys on the string
