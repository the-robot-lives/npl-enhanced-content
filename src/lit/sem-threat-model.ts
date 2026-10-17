import { SemElement } from './base.js';

/**
 * sem-threat-model — threat-model container
 * (spec/schema/sem-threat-model.md).
 *
 * Family A display stub: assets/threats/mitigations are authored inside
 * as inner sem-sections or lists; the component only registers and
 * claims `data-sem-upgraded`. The "threat model" label (with kind/scope
 * qualifiers) is vocabulary CSS ::before chrome, outside textContent.
 * Ships in the core bundle via the src/index.ts barrel.
 */
export class SemThreatModel extends SemElement {}
SemElement.register('sem-threat-model', SemThreatModel);
