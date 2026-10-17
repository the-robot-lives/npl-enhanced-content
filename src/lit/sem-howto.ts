import { SemElement } from './base.js';

/**
 * sem-howto — how-to guide container (spec/schema/sem-howto.md).
 *
 * Family A display stub: the authored <name> child is the guide title,
 * the free contents the body, the <tags> child its topic chips — all
 * authored text, all rendered as-is. The component only registers and
 * claims `data-sem-upgraded`; the "how-to" label and the name/tags
 * styling are vocabulary CSS. Ships in the core bundle via the
 * src/index.ts barrel.
 */
export class SemHowto extends SemElement {}
SemElement.register('sem-howto', SemHowto);
