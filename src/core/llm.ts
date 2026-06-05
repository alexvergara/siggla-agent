/**
 * Provider-agnostic LLM layer.
 *
 * The agent depends only on the LlmProvider interface, so the model backend is
 * swappable by config. Z.ai (GLM) is the default; Anthropic is a drop-in.
 */
import OpenAI from 'openai';
import type { Config } from '../config.js';
import type { LlmMessage, LlmProvider, LlmResult } from './types.js';

/** Z.ai / GLM via the OpenAI-compatible chat completions API. */
export class ZaiProvider implements LlmProvider {
  readonly name = 'zai';
  private readonly client: OpenAI;

  constructor(private readonly cfg: Config) {
    if (!cfg.llm.zai.apiKey) {
      throw new Error('ZAI_API_KEY is not set (required when LLM_PROVIDER=zai).');
    }
    this.client = new OpenAI({
      apiKey: cfg.llm.zai.apiKey,
      baseURL: cfg.llm.zai.baseUrl,
    });
  }

  async complete(system: string, messages: LlmMessage[]): Promise<LlmResult> {
    const resp = await this.client.chat.completions.create({
      model: this.cfg.llm.zai.model,
      temperature: this.cfg.llm.temperature,
      max_tokens: this.cfg.llm.maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    });
    return {
      text: resp.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/** Anthropic Claude via the Messages API (plain fetch, no extra dependency). */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';

  constructor(private readonly cfg: Config) {
    if (!cfg.llm.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set (required when LLM_PROVIDER=anthropic).');
    }
  }

  async complete(system: string, messages: LlmMessage[]): Promise<LlmResult> {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.cfg.llm.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.cfg.llm.anthropic.model,
        max_tokens: this.cfg.llm.maxTokens,
        temperature: this.cfg.llm.temperature,
        system,
        messages,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }
}

/** Build the configured provider. */
export function createProvider(cfg: Config): LlmProvider {
  switch (cfg.llm.provider) {
    case 'zai':
      return new ZaiProvider(cfg);
    case 'anthropic':
      return new AnthropicProvider(cfg);
    default:
      throw new Error(`Unknown LLM provider: ${cfg.llm.provider as string}`);
  }
}
