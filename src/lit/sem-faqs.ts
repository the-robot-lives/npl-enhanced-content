import { SemElement } from './base.js';

/**
 * sem-faqs / sem-faq — FAQ collection + entries
 * (spec/schema/sem-faqs.md).
 *
 * Family A display stubs, one module per contract file: every question
 * and every answer stays visible in every tier — a FAQ is not a
 * disclosure. The authored <question>/<answer> children ARE the record;
 * the components only register and claim `data-sem-upgraded`; the
 * collection label and entry cards are vocabulary CSS. Ship in the core
 * bundle via the src/index.ts barrel.
 */
export class SemFaqs extends SemElement {}
SemElement.register('sem-faqs', SemFaqs);

export class SemFaq extends SemElement {}
SemElement.register('sem-faq', SemFaq);
