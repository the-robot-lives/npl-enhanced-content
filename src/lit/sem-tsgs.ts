import { SemElement } from './base.js';

/**
 * sem-tsgs / sem-tsg — troubleshooting-guide collection + entries
 * (spec/schema/sem-tsgs.md).
 *
 * Family A display stubs, one module per contract file: each entry's
 * authored children (<name>, <title>, <description>, <tags>, <when>)
 * plus the solution prose ARE the record, rendered as-is. The
 * components only register and claim `data-sem-upgraded`; the collection
 * label and entry-card styling are vocabulary CSS. Ship in the core
 * bundle via the src/index.ts barrel.
 */
export class SemTsgs extends SemElement {}
SemElement.register('sem-tsgs', SemTsgs);

export class SemTsg extends SemElement {}
SemElement.register('sem-tsg', SemTsg);
