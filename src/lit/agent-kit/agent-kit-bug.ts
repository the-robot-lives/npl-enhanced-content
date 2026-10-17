import { AkitTicket, type AkitTicketType } from './ticket-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-bug — Bug ticket, the generic renderer parameterized
 * (spec/schema/agent-kit/tickets.md; one subclass per tag — same record
 * shape, cached body, and chrome as every ticket tag).
 */
export class AkitBug extends AkitTicket {
  static override ticketType = 'bug' as AkitTicketType;
}

defineAkit('agent-kit-bug', AkitBug);
