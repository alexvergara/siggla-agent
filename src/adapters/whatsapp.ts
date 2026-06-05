/**
 * WhatsApp transport via Baileys.
 *
 * Responsibilities (kept deliberately thin):
 *  - connect & persist the linked-device session (QR on first run),
 *  - normalize inbound messages to InboundMessage and pass them to a handler,
 *  - detect owner control keywords (/stop, /start) typed from the linked number,
 *  - send replies with a human-like typing delay.
 *
 * It knows nothing about the agent, the LLM, or Telegram.
 */
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import type { Config } from '../config.js';
import type { InboundMessage } from '../core/types.js';

export interface WhatsAppHandlers {
  onInbound: (msg: InboundMessage) => Promise<void>;
  onOwnerControl: (contactId: string, command: 'mute' | 'unmute') => void;
}

export class WhatsAppAdapter {
  private sock: WASocket | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  async start(handlers: WhatsAppHandlers): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.cfg.whatsapp.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.log('[whatsapp] scan this QR with WhatsApp → Linked devices:');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        this.log('[whatsapp] connected.');
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.log(`[whatsapp] connection closed (code ${code ?? '?'}).`);
        if (!loggedOut) {
          this.log('[whatsapp] reconnecting…');
          void this.start(handlers);
        } else {
          this.log('[whatsapp] logged out — delete the auth dir and re-link.');
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        try {
          await this.handleRaw(m, handlers);
        } catch (err) {
          this.log(`[whatsapp] handler error: ${(err as Error).message}`);
        }
      }
    });
  }

  private async handleRaw(
    m: import('@whiskeysockets/baileys').proto.IWebMessageInfo,
    handlers: WhatsAppHandlers,
  ): Promise<void> {
    const jid = m.key.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return; // skip groups/status

    const text = (m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '').trim();
    if (!text) return;

    // Messages from the linked number = owner. Only act on control keywords.
    if (m.key.fromMe) {
      if (text === this.cfg.whatsapp.muteKeyword) {
        handlers.onOwnerControl(jid, 'mute');
        this.log(`[whatsapp] muted ${jid}`);
      } else if (text === this.cfg.whatsapp.unmuteKeyword) {
        handlers.onOwnerControl(jid, 'unmute');
        this.log(`[whatsapp] unmuted ${jid}`);
      }
      return;
    }

    const ts = toMs(m.messageTimestamp) ?? Date.now();
    await handlers.onInbound({
      channel: 'whatsapp',
      contactId: jid,
      name: m.pushName ?? '',
      text,
      timestamp: ts,
    });
  }

  /** Send a reply with a brief, human-like typing delay. */
  async send(contactId: string, text: string): Promise<void> {
    const sock = this.sock;
    if (!sock) throw new Error('WhatsApp socket not connected');

    await sock.presenceSubscribe(contactId).catch(() => {});
    await sock.sendPresenceUpdate('composing', contactId).catch(() => {});
    await delay(Math.min(3000, 600 + text.length * 25));
    await sock.sendPresenceUpdate('paused', contactId).catch(() => {});
    await sock.sendMessage(contactId, { text });
  }
}

type Long = { toNumber(): number };

function toMs(ts: number | Long | null | undefined): number | null {
  if (ts == null) return null;
  const n = typeof ts === 'number' ? ts : ts.toNumber();
  return Number.isFinite(n) ? n * 1000 : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
