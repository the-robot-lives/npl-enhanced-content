import { AkitTicket, type AkitTicketType } from './ticket-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-epic — Epic ticket, the generic renderer parameterized
 * (spec/schema/agent-kit/tickets.md; one subclass per tag — same record
 * shape, cached body, and chrome as every ticket tag).
 */
export class AkitEpic extends AkitTicket {
  static override ticketType = 'epic' as AkitTicketType;
}

defineAkit('agent-kit-epic', AkitEpic);
