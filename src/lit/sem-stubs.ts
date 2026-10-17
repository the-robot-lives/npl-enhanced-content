import { SemElement } from './base.js';

/**
 * Claim stubs — the vocabulary tags whose upgrade IS their mark.
 *
 * Round-2 contract: every sem tag has a Lit component. For these tags the
 * rendered behaviour already lives in the theme vocabulary (they are
 * CSS-first blocks: records, steps, events, views, meters, references…)
 * and — where a vanilla handler wires interaction (sem-views tabs,
 * sem-progress meter, sem-facts decks) — in `src/fallback/*`, which runs
 * after the bundle scan and skips nothing it still needs (its guards key
 * on the CONTAINER, and the views/progress handlers have no marker guard
 * to skip through). A stub therefore does exactly one thing: exist as the
 * tag's custom element and claim `data-sem-upgraded` at connect
 * (inherited from SemElement), so:
 *
 *   - `customElements.get(tag)` answers for every vocabulary tag —
 *     hosts that probe before enhancing see a defined element;
 *   - the JS-off renderings gated on `:not([data-sem-upgraded])`
 *     (views' stacked headings, progress' attr caption) hand over to
 *     the wired renderings at the same moment every real component
 *     claims;
 *   - light-DOM children are untouched — no render, no shadow root, no
 *     behaviour change (PRD §4 rule 5).
 *
 * If one of these grows real behaviour, it graduates to its own
 * `sem-<name>.ts` module and out of this file (sem-reveal did exactly
 * that in the same round).
 */

export class SemAudiences extends SemElement {}
SemElement.register('sem-audiences', SemAudiences);

export class SemApiParam extends SemElement {}
SemElement.register('sem-api-param', SemApiParam);

export class SemChronology extends SemElement {}
SemElement.register('sem-chronology', SemChronology);

export class SemDataJoin extends SemElement {}
SemElement.register('sem-data-join', SemDataJoin);

export class SemDataQuery extends SemElement {}
SemElement.register('sem-data-query', SemDataQuery);

export class SemDataSource extends SemElement {}
SemElement.register('sem-data-source', SemDataSource);

export class SemDetail extends SemElement {}
SemElement.register('sem-detail', SemDetail);

export class SemEvent extends SemElement {}
SemElement.register('sem-event', SemEvent);

export class SemFact extends SemElement {}
SemElement.register('sem-fact', SemFact);

export class SemProcedure extends SemElement {}
SemElement.register('sem-procedure', SemProcedure);

export class SemProfile extends SemElement {}
SemElement.register('sem-profile', SemProfile);

export class SemProgress extends SemElement {}
SemElement.register('sem-progress', SemProgress);

export class SemProperty extends SemElement {}
SemElement.register('sem-property', SemProperty);

export class SemReference extends SemElement {}
SemElement.register('sem-reference', SemReference);

export class SemStep extends SemElement {}
SemElement.register('sem-step', SemStep);

export class SemTagAttr extends SemElement {}
SemElement.register('sem-tag-attr', SemTagAttr);

export class SemView extends SemElement {}
SemElement.register('sem-view', SemView);

export class SemViews extends SemElement {}
SemElement.register('sem-views', SemViews);
