import { AkitTicket, type AkitTicketType } from './ticket-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-user-story — User-story ticket, the generic renderer parameterized
 * (spec/schema/agent-kit/tickets.md; one subclass per tag — same record
 * shape, cached body, and chrome as every ticket tag).
 */
export class AkitUserStory extends AkitTicket {
  static override ticketType = 'user-story' as AkitTicketType;
}

defineAkit('agent-kit-user-story', AkitUserStory);
