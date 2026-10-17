import { AkitReferenceCard, type AkitReferenceKind } from './reference-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-organization — an organization reference card, the generic
 * reference renderer parameterized (spec/schema/agent-kit/
 * reference-cards.md; same record shape and chrome as the project card).
 */
export class AkitOrganization extends AkitReferenceCard {
  static override refKind = 'organization' as AkitReferenceKind;
}

defineAkit('agent-kit-organization', AkitOrganization);
