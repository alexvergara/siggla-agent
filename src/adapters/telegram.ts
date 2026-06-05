/**
 * Telegram hot-lead notifier. Sends an alert to the owner when a conversation is
 * escalated, including the contact's name, number, reason, and recent messages.
 *
 * Uses the plain Telegram Bot API over fetch — no SDK dependency.
 */
import type { Turn } from '../core/types.js';

export interface HotLeadAlert {
  name: string;
  /** WhatsApp jid or raw contact id. */
  contactId: string;
  reason: string;
  recentMessages: Turn[];
}

export class TelegramNotifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly log: (msg: string) => void = console.warn,
  ) {}

  enabled(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  async notifyHotLead(alert: HotLeadAlert): Promise<void> {
    if (!this.enabled()) {
      this.log(`[telegram] disabled — would alert hot lead: ${alert.name} (${alert.reason})`);
      return;
    }

    const phone = prettifyContact(alert.contactId);
    const lines = [
      '🔔 <b>Nuevo lead / atención requerida</b>',
      `👤 <b>Nombre:</b> ${escapeHtml(alert.name || '(sin nombre)')}`,
      `📱 <b>Número:</b> ${escapeHtml(phone)}`,
      `📌 <b>Motivo:</b> ${escapeHtml(alert.reason || 'escalado')}`,
      '',
      '<b>Últimos mensajes:</b>',
      ...alert.recentMessages.slice(-6).map((t) => {
        const who = t.role === 'user' ? '🟢' : '🤖';
        return `${who} ${escapeHtml(truncate(t.content, 300))}`;
      }),
    ];

    try {
      const resp = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: lines.join('\n'),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (!resp.ok) {
        this.log(`[telegram] sendMessage failed ${resp.status}: ${await resp.text()}`);
      }
    } catch (err) {
      this.log(`[telegram] error: ${(err as Error).message}`);
    }
  }
}

function prettifyContact(contactId: string): string {
  const bare = contactId.split('@')[0] ?? contactId;
  return bare.startsWith('+') ? bare : `+${bare}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
