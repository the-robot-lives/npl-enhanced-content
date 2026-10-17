import { AkitReferenceCard, type AkitReferenceKind } from './reference-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-project — a project reference card, the generic reference
 * renderer parameterized (spec/schema/agent-kit/reference-cards.md;
 * same record shape and chrome as the organization card).
 */
export class AkitProject extends AkitReferenceCard {
  static override refKind = 'project' as AkitReferenceKind;
}

defineAkit('agent-kit-project', AkitProject);
