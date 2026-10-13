/**
 * sem-browser — registration shim for the lazy chunk build.
 *
 * The build's manifest scanner (scripts/build.mjs, LAZY_TARGETS) reads THIS
 * directory for `SemElement.register('<tag>', …)` calls and turns each one
 * into `dist/chunks/<stem>.js` plus a manifest entry, so sem-browser rides
 * the same lazy surface as the vocabulary elements: the element
 * implementation lives in src/browser/sem-browser.ts (window-chrome + the
 * address bar are browser-lane code, not document vocabulary), and this shim
 * is only the registration the scanner keys on. The full bundle (src/index.ts)
 * gains the same two lines when the lead promotes it — sem-browser ships
 * lazy-first and the core bundle must not grow for it.
 */
import { SemElement } from './base.js';
import { SemBrowser } from '../browser/sem-browser.js';

export { SemBrowser };

/** The registered tag name — single source of truth for hosts and tests. */
export const SEM_BROWSER_TAG = 'sem-browser';

SemElement.register('sem-browser', SemBrowser); // literal: the build's scanner keys on the string
