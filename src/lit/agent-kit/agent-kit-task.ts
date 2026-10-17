import { AkitTicket, type AkitTicketType } from './ticket-shared.js';
import { defineAkit } from './shared.js';

/**
 * agent-kit-task — Task ticket, the generic renderer parameterized
 * (spec/schema/agent-kit/tickets.md; one subclass per tag — same record
 * shape, cached body, and chrome as every ticket tag).
 */
export class AkitTask extends AkitTicket {
  static override ticketType = 'task' as AkitTicketType;
}

defineAkit('agent-kit-task', AkitTask);
