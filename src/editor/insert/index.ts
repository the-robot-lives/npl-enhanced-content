/**
 * insert — the block insertion lane (EDITOR.md §5.5).
 *
 * Roads: `+` between blocks (plus.ts), `/` command (slash.ts), the grouped
 * panel (panel.ts), wizard-driven descriptors (wizard.ts), and the glue
 * (wire.ts). Placement (placement.ts), the catalog (catalog.ts), and
 * snippet compilation (compile.ts) are the pure core; apply.ts performs
 * the single-op insertion.
 */

export * from './types.js';
export * from './placement.js';
export * from './catalog.js';
export * from './compile.js';
export * from './apply.js';
export * from './panel.js';
export * from './wizard.js';
export * from './plus.js';
export * from './slash.js';
export * from './wire.js';
