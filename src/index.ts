/**
 * Entry point — wires the WhatsApp adapter, the agent, the session store,
 * and the Telegram notifier together. This is the only place the pieces meet.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { Agent } from './core/agent.js';
import { createProvider } from './core/llm.js';
import { SessionStore } from './core/session.js';
import { TelegramNotifier } from './adapters/telegram.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';

function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();

  const kbPath = process.env.KB_PATH?.trim() || 'src/kb/knowledge-base.md';
  const knowledgeBase = readFileSync(resolve(process.cwd(), kbPath), 'utf8');

  const provider = createProvider(cfg);
  const session = new SessionStore(cfg.storage.dbPath);
  const agent = new Agent(provider, session, knowledgeBase, cfg);
  const telegram = new TelegramNotifier(cfg.telegram.botToken, cfg.telegram.chatId, log);
  const whatsapp = new WhatsAppAdapter(cfg, log);

  log(`[siggi] starting — provider=${provider.name}, model=${modelName(cfg)}`);
  if (!telegram.enabled()) log('[siggi] Telegram notifier disabled (no token/chat id).');

  // Hourly housekeeping: drop message-log rows older than 2h.
  const prune = setInterval(() => session.pruneMessageLog(Date.now() - 7_200_000), 3_600_000);
  prune.unref?.();

  await whatsapp.start({
    onInbound: async (msg) => {
      const reply = await agent.handle(msg);
      if (!reply) return; // muted / handed off / rate-limited

      await whatsapp.send(msg.contactId, reply.text);

      if (reply.escalate) {
        const contact = session.getContact(msg.contactId);
        await telegram.notifyHotLead({
          name: msg.name || contact?.name || '',
          contactId: msg.contactId,
          reason: reply.reason ?? 'escalado',
          recentMessages: contact?.history ?? [],
        });
      }
    },
    onOwnerControl: (contactId, command) => {
      session.setStatus(contactId, command === 'mute' ? 'muted' : 'active');
    },
  });

  const shutdown = (): void => {
    log('[siggi] shutting down…');
    session.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function modelName(cfg: ReturnType<typeof loadConfig>): string {
  return cfg.llm.provider === 'zai' ? cfg.llm.zai.model : cfg.llm.anthropic.model;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
