import { SemElement } from './base.js';

/**
 * sem-philosophy — principles container, spelled with the h
 * (spec/schema/sem-philosophy.md).
 *
 * Family A display stub: the authored inner content IS the philosophy;
 * kind is display-only label-chrome sugar. The component only registers
 * and claims `data-sem-upgraded`; authored children render as-is.
 * Ships in the core bundle via the src/index.ts barrel.
 */
export class SemPhilosophy extends SemElement {}
SemElement.register('sem-philosophy', SemPhilosophy);
