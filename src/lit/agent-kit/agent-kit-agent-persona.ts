import { AkitPersona, type AkitPersonaKind } from './persona-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-agent-persona — a non-human agent's persona, the generic
 * persona renderer parameterized (spec/schema/agent-kit/personas.md;
 * same record shape and chrome as every persona tag).
 */
export class AkitAgentPersona extends AkitPersona {
  static override personaKind = 'agent' as AkitPersonaKind;
}

defineAkit('agent-kit-agent-persona', AkitAgentPersona);
