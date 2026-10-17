import { AkitTicket, type AkitTicketType } from './ticket-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-issue — Issue ticket, the generic renderer parameterized
 * (spec/schema/agent-kit/tickets.md; one subclass per tag — same record
 * shape, cached body, and chrome as every ticket tag).
 */
export class AkitIssue extends AkitTicket {
  static override ticketType = 'issue' as AkitTicketType;
}

defineAkit('agent-kit-issue', AkitIssue);
