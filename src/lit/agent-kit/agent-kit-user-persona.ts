import { AkitPersona, type AkitPersonaKind } from './persona-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-user-persona — a human user's persona, the generic persona
 * renderer parameterized (spec/schema/agent-kit/personas.md; same record
 * shape and chrome as every persona tag).
 */
export class AkitUserPersona extends AkitPersona {
  static override personaKind = 'user' as AkitPersonaKind;
}

defineAkit('agent-kit-user-persona', AkitUserPersona);
