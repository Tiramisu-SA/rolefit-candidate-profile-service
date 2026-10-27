import type { AiConfig } from '../../../config/ai-config';
import type { LlmClient } from '../llm-resume.adapter';

/**
 * Client for the OpenAI-style /chat/completions API, which Gemini, Groq,
 * OpenRouter and Ollama all accept. Only the address, model and key differ,
 * and those come from AiConfig.
 */
export class OpenAiCompatibleClient implements LlmClient {
  readonly label: string;

  constructor(private readonly config: AiConfig) {
    this.label = `${config.provider}/${config.model}`;
  }

  async complete(system: string, user: string): Promise<string> {
    const { baseUrl, apiKey, model, timeoutMs } = this.config;
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          // Asks for valid JSON; the reply is still parsed defensively.
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw new Error(`${this.label} timed out after ${timeoutMs} ms`);
      throw err;
    }
    if (!res.ok) throw new Error(`${this.label} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content === '') throw new Error(`${this.label} sent no message text`);
    return content;
  }
}
