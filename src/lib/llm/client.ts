import { estimateCost } from 'llm-cost';
import { loadConfig } from '../config';
import { TransientError, UsageError } from '../error/types';
import type { LlmProvider, XrayLlmConfig } from '../../types/xray-config';

export type { LlmProvider };

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmCompletionRequest {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompletionResponse {
  text: string;
  toolCalls?: LlmToolCall[];
  usage: LlmUsage;
  costUsd: number;
}

export interface LlmClientOptions {
  provider?: LlmProvider;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  offline?: boolean;
  configPath?: string;
  root?: string;
  timeoutMs?: number;
}

interface ResolvedLlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
};

const DEFAULT_BASE_URLS: Record<LlmProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
};

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_PROMPT_CACHE_BETA = 'prompt-caching-2024-07-31';

function parseProvider(raw: string | undefined): LlmProvider {
  const normalized = (raw ?? 'openai').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'anthropic') {
    return normalized;
  }
  throw new UsageError(
    `Unsupported LLM provider '${raw}'. Expected 'openai' or 'anthropic'.`
  );
}

function resolveLlmConfig(opts: LlmClientOptions): ResolvedLlmConfig {
  if (opts.offline === true) {
    throw new UsageError('LLM features are disabled in --offline mode');
  }

  let fileLlm: XrayLlmConfig | undefined;
  try {
    fileLlm = loadConfig(opts.configPath, opts.root)?.llm;
  } catch {
    // Missing or unreadable optional config falls back to env/explicit options.
    fileLlm = undefined;
  }

  const provider = parseProvider(
    opts.provider ?? process.env.XRAY_LLM_PROVIDER ?? fileLlm?.provider
  );

  const model =
    (opts.model ?? process.env.XRAY_LLM_MODEL ?? fileLlm?.model)?.trim() ||
    DEFAULT_MODELS[provider];

  const apiKey =
    (opts.apiKey ?? process.env.XRAY_LLM_API_KEY ?? fileLlm?.apiKey)?.trim() ?? '';
  if (!apiKey) {
    throw new UsageError(
      'LLM API key is required. Set XRAY_LLM_API_KEY or configure llm.apiKey in .xrayrc.json.'
    );
  }

  const rawBaseUrl =
    (opts.baseUrl ?? process.env.XRAY_LLM_BASE_URL ?? fileLlm?.baseUrl)?.trim() ||
    DEFAULT_BASE_URLS[provider];
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');

  return {
    provider,
    model,
    apiKey,
    baseUrl,
    timeoutMs: opts.timeoutMs ?? 60_000,
  };
}

function safeParseJsonObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

export class LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly offline: boolean;

  constructor(options: LlmClientOptions = {}) {
    this.offline = options.offline === true;
    const resolved = resolveLlmConfig(options);
    this.provider = resolved.provider;
    this.model = resolved.model;
    this.baseUrl = resolved.baseUrl;
    this.apiKey = resolved.apiKey;
    this.timeoutMs = resolved.timeoutMs;
  }

  toJSON(): Record<string, unknown> {
    return {
      provider: this.provider,
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (this.offline) {
      throw new UsageError('LLM features are disabled in --offline mode');
    }

    return this.provider === 'anthropic'
      ? this.completeAnthropic(request)
      : this.completeOpenAi(request);
  }

  private computeCost(usage: LlmUsage): number {
    return (
      estimateCost({
        model: this.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      }) ?? 0
    );
  }

  private async postJson(
    url: string,
    headers: Record<string, string>,
    payload: unknown
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      if (!response.ok) {
        const snippet = bodyText.slice(0, 300).replace(/\s+/g, ' ').trim();
        throw new TransientError(
          `LLM request failed (${response.status} ${response.statusText}): ${snippet || 'empty response'}`
        );
      }

      return JSON.parse(bodyText) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  private async completeOpenAi(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    for (const msg of request.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? 0.2,
    };
    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }

    const data = await this.postJson(
      `${this.baseUrl}/chat/completions`,
      { Authorization: `Bearer ${this.apiKey}` },
      payload
    );

    const choices = Array.isArray(data.choices) ? (data.choices as Array<Record<string, unknown>>) : [];
    const firstMsg = (choices[0]?.message ?? {}) as Record<string, unknown>;
    const text = typeof firstMsg.content === 'string' ? firstMsg.content : '';

    const rawToolCalls = Array.isArray(firstMsg.tool_calls)
      ? (firstMsg.tool_calls as Array<Record<string, unknown>>)
      : [];
    const toolCalls: LlmToolCall[] | undefined =
      rawToolCalls.length > 0
        ? rawToolCalls.map((tc, idx) => {
            const fn = (tc.function ?? {}) as Record<string, unknown>;
            return {
              id: typeof tc.id === 'string' ? tc.id : `call_${idx}`,
              name: typeof fn.name === 'string' ? fn.name : '',
              arguments: safeParseJsonObject(fn.arguments),
            };
          })
        : undefined;

    const rawUsage = (data.usage ?? {}) as Record<string, unknown>;
    const usage: LlmUsage = {
      inputTokens: Number(rawUsage.prompt_tokens ?? 0) || 0,
      outputTokens: Number(rawUsage.completion_tokens ?? 0) || 0,
    };

    return {
      text,
      ...(toolCalls ? { toolCalls } : {}),
      usage,
      costUsd: this.computeCost(usage),
    };
  }

  private async completeAnthropic(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const systemParts = [
      request.system,
      ...request.messages.filter((m) => m.role === 'system').map((m) => m.content),
    ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

    const payload: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.2,
      messages,
    };
    if (systemParts.length > 0) {
      payload.system = [
        {
          type: 'text',
          text: systemParts.join('\n\n'),
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    const data = await this.postJson(
      `${this.baseUrl}/messages`,
      {
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_PROMPT_CACHE_BETA,
      },
      payload
    );

    const blocks = Array.isArray(data.content) ? (data.content as Array<Record<string, unknown>>) : [];
    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');

    const toolBlocks = blocks.filter((b) => b.type === 'tool_use');
    const toolCalls: LlmToolCall[] | undefined =
      toolBlocks.length > 0
        ? toolBlocks.map((b, idx) => ({
            id: typeof b.id === 'string' ? b.id : `tool_${idx}`,
            name: typeof b.name === 'string' ? b.name : '',
            arguments: safeParseJsonObject(b.input),
          }))
        : undefined;

    const rawUsage = (data.usage ?? {}) as Record<string, unknown>;
    const usage: LlmUsage = {
      inputTokens: Number(rawUsage.input_tokens ?? 0) || 0,
      outputTokens: Number(rawUsage.output_tokens ?? 0) || 0,
    };

    return {
      text,
      ...(toolCalls ? { toolCalls } : {}),
      usage,
      costUsd: this.computeCost(usage),
    };
  }
}
