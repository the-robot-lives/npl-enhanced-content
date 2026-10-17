/**
 * agent-kit/agent-kit-cucumber — the cached Cucumber feature card
 * (contract spec/schema/agent-kit/script-cards.md). See
 * script-shared.ts: the Gherkin source is an authored
 * `<script type="text/plain" data-agent-kit-script>` child or a `file`
 * attribute, displays as authored, never parsed or executed; the Run
 * affordance is deferred.
 */

import { AkitScriptCard, defineScriptCard } from './script-shared.js';

export class AkitCucumber extends AkitScriptCard {
  static override scriptKind = 'cucumber' as const;
}

defineScriptCard('agent-kit-cucumber', AkitCucumber);
