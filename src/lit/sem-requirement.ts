import { SemElement } from './base.js';

/**
 * sem-requirement — requirement statement container
 * (spec/schema/sem-requirement.md).
 *
 * Family A display stub: the authored inner content IS the statement;
 * kind/status/priority are display-only sugar read by the CSS chrome
 * (label + status chip, both pseudo-elements outside textContent). The
 * component only registers and claims `data-sem-upgraded`. Ships in the
 * core bundle via the src/index.ts barrel.
 */
export class SemRequirement extends SemElement {}
SemElement.register('sem-requirement', SemRequirement);
