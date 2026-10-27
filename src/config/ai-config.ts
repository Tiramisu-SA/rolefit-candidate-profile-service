/**
 * Which AI provider parses resumes, read from AI_* environment variables.
 *
 * Every provider except Claude is reached through the OpenAI-style
 * /chat/completions API, so a preset only needs an address. Leaving
 * AI_PROVIDER empty (or "none") turns AI off: resumes then go through the
 * basic library parser only.
 */

export const AI_PROVIDERS = ['gemini', 'groq', 'openrouter', 'ollama', 'claude', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiConfig {
  provider: AiProvider;
  model: string;
  /** Empty when the provider needs none (Ollama), or for Claude when the Anthropic SDK finds its own credentials. */
  apiKey: string;
  /** No trailing slash. Empty for Claude unless overridden (the SDK knows its address). */
  baseUrl: string;
  timeoutMs: number;
}

const PRESETS: Record<AiProvider, { baseUrl: string; needsKey: boolean; defaultModel?: string }> = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  ollama: { baseUrl: 'http://localhost:11434/v1', needsKey: false },
  claude: { baseUrl: '', needsKey: false, defaultModel: 'claude-opus-5-5' },
  'openai-compatible': { baseUrl: '', needsKey: false },
};

const DEFAULT_TIMEOUT_MS = 60_000;

export function readAiConfig(vars: Record<string, string | undefined>): { config: AiConfig | null; errors: string[] } {
  const errors: string[] = [];
  const read = (name: string) => vars[name]?.trim() ?? '';

  const name = read('AI_PROVIDER').toLowerCase();
  if (name === '' || name === 'none') return { config: null, errors };
  if (!(AI_PROVIDERS as readonly string[]).includes(name)) {
    errors.push(`AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')}, none (got "${read('AI_PROVIDER')}")`);
    return { config: null, errors };
  }
  const provider = name as AiProvider;
  const preset = PRESETS[provider];

  const model = read('AI_MODEL') || preset.defaultModel || '';
  if (model === '') errors.push(`AI_MODEL is required for AI_PROVIDER=${provider} (a model id from the provider's model list)`);

  const baseUrl = (read('AI_BASE_URL') || preset.baseUrl).replace(/\/+$/, '');
  if (baseUrl === '' && provider !== 'claude') errors.push(`AI_BASE_URL is required for AI_PROVIDER=${provider}`);
  else if (baseUrl !== '' && !/^https?:\/\/[^/]/.test(baseUrl)) errors.push(`AI_BASE_URL must be an http or https URL (got "${read('AI_BASE_URL')}")`);

  const apiKey = read('AI_API_KEY');
  if (preset.needsKey && apiKey === '') errors.push(`AI_API_KEY is required for AI_PROVIDER=${provider}`);

  const rawTimeout = read('AI_TIMEOUT_MS');
  const timeoutMs = rawTimeout === '' ? DEFAULT_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    errors.push(`AI_TIMEOUT_MS must be a whole number of milliseconds above 0 (got "${rawTimeout}")`);
  }

  return { config: errors.length > 0 ? null : { provider, model, apiKey, baseUrl, timeoutMs }, errors };
}
