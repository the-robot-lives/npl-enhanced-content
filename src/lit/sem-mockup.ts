import { SemElement } from './base.js';

/**
 * sem-mockup — text/html mockup container (spec/schema/sem-mockup.md).
 *
 * Family A display stub: mode (text|html) is display-only sugar the CSS
 * reads (preformatted mono block for text mode, normal flow for html);
 * the authored content IS the mockup under every mode. The component
 * only registers and claims `data-sem-upgraded`. Ships in the core
 * bundle via the src/index.ts barrel.
 */
export class SemMockup extends SemElement {}
SemElement.register('sem-mockup', SemMockup);
