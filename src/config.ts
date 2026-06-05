/**
 * Typed configuration loaded from environment variables.
 * Call loadConfig() once at startup.
 */
import 'dotenv/config';

export interface Config {
  llm: {
    provider: 'zai' | 'anthropic';
    temperature: number;
    maxTokens: number;
    zai: { apiKey: string; baseUrl: string; model: string };
    anthropic: { apiKey: string; model: string };
  };
  bot: { alias: string; header: string };
  limits: { maxTokensPerDay: number; maxMessagesPerContactPerHour: number };
  telegram: { botToken: string; chatId: string };
  whatsapp: { muteKeyword: string; unmuteKeyword: string; authDir: string };
  storage: { dbPath: string; historyTurns: number };
}

function str(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
  const provider = str('LLM_PROVIDER', 'zai');
  if (provider !== 'zai' && provider !== 'anthropic') {
    throw new Error(`LLM_PROVIDER must be "zai" or "anthropic", got "${provider}"`);
  }

  return {
    llm: {
      provider,
      temperature: num('LLM_TEMPERATURE', 0.3),
      maxTokens: num('LLM_MAX_TOKENS', 1024),
      zai: {
        apiKey: str('ZAI_API_KEY'),
        baseUrl: str('ZAI_BASE_URL', 'https://api.z.ai/api/paas/v4/'),
        model: str('ZAI_MODEL', 'glm-4.6'),
      },
      anthropic: {
        apiKey: str('ANTHROPIC_API_KEY'),
        model: str('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
      },
    },
    bot: {
      alias: str('BOT_ALIAS', 'Siggi'),
      header: str('BOT_HEADER', '🤖 Siggi · asistente virtual de Sigg.la'),
    },
    limits: {
      maxTokensPerDay: num('MAX_TOKENS_PER_DAY', 100_000),
      maxMessagesPerContactPerHour: num('MAX_MESSAGES_PER_CONTACT_PER_HOUR', 20),
    },
    telegram: {
      botToken: str('TELEGRAM_BOT_TOKEN'),
      chatId: str('TELEGRAM_CHAT_ID'),
    },
    whatsapp: {
      muteKeyword: str('WA_MUTE_KEYWORD', '/stop'),
      unmuteKeyword: str('WA_UNMUTE_KEYWORD', '/start'),
      authDir: str('WA_AUTH_DIR', './auth_state'),
    },
    storage: {
      dbPath: str('DB_PATH', './data/siggla-agent.sqlite'),
      historyTurns: num('HISTORY_TURNS', 12),
    },
  };
}
