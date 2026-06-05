/**
 * Shared types for the transport- and provider-agnostic core.
 */

/** A normalized inbound message, produced by any channel adapter. */
export interface InboundMessage {
  /** Channel name, e.g. "whatsapp". */
  channel: string;
  /** Stable contact id within the channel (WhatsApp jid / phone). */
  contactId: string;
  /** Human-readable contact name (push name), best-effort. */
  name: string;
  /** Plain text of the message. */
  text: string;
  /** Unix epoch ms. */
  timestamp: number;
}

/** The agent's decision for a single inbound message. */
export interface AgentReply {
  /** Text to send back (header already prepended). */
  text: string;
  /** Whether the conversation should be handed to a human. */
  escalate: boolean;
  /** Short reason for escalation (for the Telegram alert). */
  reason?: string;
}

/** Conversation status for a contact. */
export type ContactStatus = 'active' | 'handed_off' | 'muted';

/** A single chat turn stored in history. */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

// ─── LLM layer ────────────────────────────────────────────────────

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResult {
  /** Raw text returned by the model. */
  text: string;
  usage: LlmUsage;
}

/** A swappable model backend. */
export interface LlmProvider {
  readonly name: string;
  complete(system: string, messages: LlmMessage[]): Promise<LlmResult>;
}
