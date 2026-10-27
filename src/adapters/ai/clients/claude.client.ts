import Anthropic from '@anthropic-ai/sdk';
import type { AiConfig } from '../../../config/ai-config';
import type { LlmClient } from '../llm-resume.adapter';

/** Client for Anthropic's Claude, through the official SDK. */
export class ClaudeClient implements LlmClient {
  readonly label: string;
  private readonly client: Anthropic;

  constructor(private readonly config: AiConfig) {
    this.label = `claude/${config.model}`;
    this.client = new Anthropic({
      // With no AI_API_KEY the SDK finds ANTHROPIC_API_KEY or an `ant auth login` profile itself.
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      timeout: config.timeoutMs,
      maxRetries: 1,
    });
  }

  async complete(system: string, user: string): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: this.config.model,
      max_tokens: 16000,
      // Pulling fields out of a resume is a simple task: low effort keeps it quick and cheap.
      output_config: { effort: 'low' },
      // If a safety classifier wrongly declines, the API reruns the request on a suitable model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') {
      throw new Error(`${this.label} declined the request (${response.stop_details?.category ?? 'no category'})`);
    }
    return response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  }
}
