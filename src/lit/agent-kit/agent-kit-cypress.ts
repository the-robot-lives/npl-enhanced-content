/**
 * agent-kit/agent-kit-cypress — the cached Cypress spec card (contract
 * spec/schema/agent-kit/script-cards.md). See script-shared.ts: the
 * spec source is an authored `<script type="text/plain"
 * data-agent-kit-script>` child or a `file` attribute, displays as
 * authored, never parsed or executed; the Run affordance is deferred.
 */

import { AkitScriptCard, defineScriptCard } from './script-shared.js';

export class AkitCypress extends AkitScriptCard {
  static override scriptKind = 'cypress' as const;
}

defineScriptCard('agent-kit-cypress', AkitCypress);
