import { AkitTicket, type AkitTicketType } from './ticket-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-sub-task — Sub-task ticket, the generic renderer parameterized
 * (spec/schema/agent-kit/tickets.md; one subclass per tag — same record
 * shape, cached body, and chrome as every ticket tag).
 */
export class AkitSubTask extends AkitTicket {
  static override ticketType = 'sub-task' as AkitTicketType;
}

defineAkit('agent-kit-sub-task', AkitSubTask);
