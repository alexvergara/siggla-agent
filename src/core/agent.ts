/**
 * The agent loop — transport- and notifier-agnostic.
 *
 * handle() takes a normalized inbound message and returns either an AgentReply
 * (text + whether to escalate) or null (stay silent — muted / handed off / rate-limited).
 * The caller is responsible for actually sending the text and firing notifications.
 */
import type { Config } from '../config.js';
import {
  BUDGET_REPLY,
  HOLDING_REPLY,
  buildSystemPrompt,
  detectRedLine,
  parseModelReply,
  withHeader,
} from './guardrails.js';
import type { SessionStore } from './session.js';
import type { AgentReply, InboundMessage, LlmMessage, LlmProvider } from './types.js';

export class Agent {
  private readonly systemPrompt: string;

  constructor(
    private readonly provider: LlmProvider,
    private readonly session: SessionStore,
    knowledgeBase: string,
    private readonly cfg: Config,
  ) {
    this.systemPrompt = buildSystemPrompt(knowledgeBase, cfg);
  }

  async handle(msg: InboundMessage): Promise<AgentReply | null> {
    // 1. Respect handoff / mute — stay completely silent.
    const status = this.session.getStatus(msg.contactId);
    if (status === 'muted' || status === 'handed_off') return null;

    // 2. Per-contact rate limit (anti-spam / anti-loop). Drop silently if exceeded.
    const windowStart = msg.timestamp - 3_600_000;
    const recent = this.session.countMessagesSince(msg.contactId, windowStart);
    this.session.logMessage(msg.contactId, msg.timestamp);
    if (recent >= this.cfg.limits.maxMessagesPerContactPerHour) {
      return null;
    }

    // 3. Daily token budget — exhausted means hand to a human, never error at the user.
    const period = periodKey(msg.timestamp);
    if (this.session.getUsageTotal(period) >= this.cfg.limits.maxTokensPerDay) {
      this.session.setStatus(msg.contactId, 'handed_off', msg.name);
      return {
        text: withHeader(BUDGET_REPLY, this.cfg.bot.header),
        escalate: true,
        reason: 'daily token budget exhausted',
      };
    }

    // 4. Build the prompt from history + the new message.
    const history = this.session.getContact(msg.contactId)?.history ?? [];
    const messages: LlmMessage[] = [
      ...history.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: msg.text },
    ];

    // 5. Call the model — any failure escalates gracefully.
    let result;
    try {
      result = await this.provider.complete(this.systemPrompt, messages);
    } catch (err) {
      this.session.setStatus(msg.contactId, 'handed_off', msg.name);
      return {
        text: withHeader(HOLDING_REPLY, this.cfg.bot.header),
        escalate: true,
        reason: `LLM error: ${(err as Error).message}`,
      };
    }
    this.session.addUsage(period, result.usage.inputTokens, result.usage.outputTokens);

    // 6. Parse + apply the red-line backstop.
    const parsed = parseModelReply(result.text);
    let { reply: replyText, escalate, reason } = parsed;

    const redline = detectRedLine(replyText);
    if (redline.violated) {
      escalate = true;
      reason = reason || redline.reason || 'red-line violation';
      replyText = HOLDING_REPLY;
    }
    if (escalate && !replyText.trim()) replyText = HOLDING_REPLY;

    // 7. Persist the turn (stored without the header) + update status.
    this.session.appendTurns(
      msg.contactId,
      msg.name,
      [
        { role: 'user', content: msg.text },
        { role: 'assistant', content: replyText },
      ],
      this.cfg.storage.historyTurns,
    );
    if (escalate) this.session.setStatus(msg.contactId, 'handed_off', msg.name);

    return { text: withHeader(replyText, this.cfg.bot.header), escalate, reason };
  }
}

/** Calendar-day key (UTC) for the usage ledger. */
export function periodKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
