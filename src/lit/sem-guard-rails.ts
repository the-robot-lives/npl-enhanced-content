import { SemElement } from './base.js';

/**
 * sem-guard-rails / sem-guard-rail — guard-rail collection + entries
 * (spec/schema/sem-guard-rails.md).
 *
 * Family A display stubs, one module per contract file: the collection
 * gets the "guard rails" label chrome; each entry is a card whose left
 * rail color keys on severity (info/warn/block) — all vocabulary CSS.
 * The components only register and claim `data-sem-upgraded`; authored
 * rule text renders as-is. Ship in the core bundle via the src/index.ts
 * barrel.
 */
export class SemGuardRails extends SemElement {}
SemElement.register('sem-guard-rails', SemGuardRails);

export class SemGuardRail extends SemElement {}
SemElement.register('sem-guard-rail', SemGuardRail);
