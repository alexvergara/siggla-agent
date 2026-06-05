import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/core/agent.js';
import { SessionStore } from '../src/core/session.js';
import { BUDGET_REPLY, HOLDING_REPLY, detectRedLine, parseModelReply } from '../src/core/guardrails.js';
import type { Config } from '../src/config.js';
import type { InboundMessage, LlmMessage, LlmProvider, LlmResult } from '../src/core/types.js';

const HEADER = '🤖 Siggi · asistente virtual de Sigg.la';

function makeConfig(overrides: Partial<Config['limits']> = {}): Config {
  return {
    llm: {
      provider: 'zai',
      temperature: 0.3,
      maxTokens: 1024,
      zai: { apiKey: 'test', baseUrl: 'http://localhost', model: 'glm-4.6' },
      anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
    },
    bot: { alias: 'Siggi', header: HEADER },
    limits: { maxTokensPerDay: 100_000, maxMessagesPerContactPerHour: 20, ...overrides },
    telegram: { botToken: '', chatId: '' },
    whatsapp: { muteKeyword: '/stop', unmuteKeyword: '/start', authDir: './auth' },
    storage: { dbPath: ':memory:', historyTurns: 12 },
  };
}

/** A provider that returns a scripted response and records calls. */
class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  calls = 0;
  constructor(
    private readonly responder: (system: string, messages: LlmMessage[]) => LlmResult,
  ) {}
  async complete(system: string, messages: LlmMessage[]): Promise<LlmResult> {
    this.calls += 1;
    return this.responder(system, messages);
  }
}

function jsonResult(reply: string, escalate = false, reason = ''): LlmResult {
  return {
    text: JSON.stringify({ reply, escalate, reason }),
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

function inbound(text: string, contactId = '57300@s.whatsapp.net'): InboundMessage {
  return { channel: 'whatsapp', contactId, name: 'Diana', text, timestamp: Date.now() };
}

let session: SessionStore;
beforeEach(() => {
  session = new SessionStore(':memory:');
});

describe('Agent.handle', () => {
  it('returns a normal answer with the identity header', async () => {
    const provider = new FakeProvider(() => jsonResult('PESV es el Plan Estratégico de Seguridad Vial.'));
    const agent = new Agent(provider, session, 'KB', makeConfig());

    const reply = await agent.handle(inbound('¿qué es PESV?'));

    expect(reply).not.toBeNull();
    expect(reply!.escalate).toBe(false);
    expect(reply!.text.startsWith(HEADER)).toBe(true);
    expect(reply!.text).toContain('Plan Estratégico');
  });

  it('escalates when the model decides to, then stays silent on the next message', async () => {
    const provider = new FakeProvider(() => jsonResult('Un asesor lo contactará.', true, 'pidió precio'));
    const agent = new Agent(provider, session, 'KB', makeConfig());
    const msg = inbound('¿cuánto cuesta?');

    const first = await agent.handle(msg);
    expect(first!.escalate).toBe(true);
    expect(first!.reason).toBe('pidió precio');
    expect(session.getStatus(msg.contactId)).toBe('handed_off');

    // Once handed off, the agent must not call the model again.
    const callsBefore = provider.calls;
    const second = await agent.handle(inbound('¿hola?', msg.contactId));
    expect(second).toBeNull();
    expect(provider.calls).toBe(callsBefore);
  });

  it('overrides to escalation when a reply leaks a price (red-line backstop)', async () => {
    const provider = new FakeProvider(() => jsonResult('El plan cuesta $50.000 al mes.', false));
    const agent = new Agent(provider, session, 'KB', makeConfig());

    const reply = await agent.handle(inbound('precio?'));

    expect(reply!.escalate).toBe(true);
    expect(reply!.text).toContain(HOLDING_REPLY);
    expect(reply!.text).not.toContain('50.000');
  });

  it('stays silent when the contact is muted', async () => {
    const provider = new FakeProvider(() => jsonResult('hola'));
    const agent = new Agent(provider, session, 'KB', makeConfig());
    const msg = inbound('hola');
    session.setStatus(msg.contactId, 'muted');

    const reply = await agent.handle(msg);
    expect(reply).toBeNull();
    expect(provider.calls).toBe(0);
  });

  it('hands off with a safe reply when the daily token budget is exhausted', async () => {
    const provider = new FakeProvider(() => jsonResult('no debería llamarse'));
    const agent = new Agent(provider, session, 'KB', makeConfig({ maxTokensPerDay: 10 }));
    const msg = inbound('hola');
    session.addUsage(new Date(msg.timestamp).toISOString().slice(0, 10), 20, 0); // over budget

    const reply = await agent.handle(msg);
    expect(reply!.escalate).toBe(true);
    expect(reply!.text).toContain(BUDGET_REPLY);
    expect(provider.calls).toBe(0);
  });

  it('rate-limits a single contact within the hour', async () => {
    const provider = new FakeProvider(() => jsonResult('ok'));
    const agent = new Agent(provider, session, 'KB', makeConfig({ maxMessagesPerContactPerHour: 3 }));
    const id = '57301@s.whatsapp.net';

    for (let i = 0; i < 3; i++) {
      const r = await agent.handle(inbound(`msg ${i}`, id));
      expect(r).not.toBeNull();
    }
    const blocked = await agent.handle(inbound('over the limit', id));
    expect(blocked).toBeNull();
  });

  it('escalates gracefully when the provider throws', async () => {
    const provider = new FakeProvider(() => {
      throw new Error('network down');
    });
    const agent = new Agent(provider, session, 'KB', makeConfig());

    const reply = await agent.handle(inbound('hola'));
    expect(reply!.escalate).toBe(true);
    expect(reply!.text).toContain(HOLDING_REPLY);
    expect(reply!.reason).toContain('network down');
  });
});

describe('guardrails', () => {
  it('parses JSON wrapped in code fences / prose', () => {
    const parsed = parseModelReply('```json\n{"reply":"hola","escalate":false,"reason":""}\n```');
    expect(parsed.reply).toBe('hola');
    expect(parsed.escalate).toBe(false);
  });

  it('falls back to raw text when output is not JSON', () => {
    const parsed = parseModelReply('hola, soy Siggi');
    expect(parsed.reply).toBe('hola, soy Siggi');
    expect(parsed.escalate).toBe(false);
  });

  it('detects prices and concrete dates', () => {
    expect(detectRedLine('cuesta $1.000').violated).toBe(true);
    expect(detectRedLine('son 50000 COP').violated).toBe(true);
    expect(detectRedLine('lanzamos el 15 de marzo').violated).toBe(true);
    expect(detectRedLine('disponible en marzo de 2026').violated).toBe(true);
    expect(detectRedLine('PESV es un plan de seguridad vial').violated).toBe(false);
  });
});
