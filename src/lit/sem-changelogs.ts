import { SemElement } from './base.js';

/**
 * sem-changelogs / sem-changelog — changelog collection + entries
 * (spec/schema/sem-changelogs.md).
 *
 * Family A display stubs, one module per contract file: each entry's
 * date/name/title/impacted attributes head the chrome (CSS ::before);
 * the authored prose and the optional <tags> child ARE the record,
 * rendered as-is. The components only register and claim
 * `data-sem-upgraded`. Ship in the core bundle via the src/index.ts
 * barrel.
 */
export class SemChangelogs extends SemElement {}
SemElement.register('sem-changelogs', SemChangelogs);

export class SemChangelog extends SemElement {}
SemElement.register('sem-changelog', SemChangelog);
